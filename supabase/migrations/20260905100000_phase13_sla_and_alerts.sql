-- =========================================================
-- PHASE 13 — SLA, escalation and automation health.
--
-- WHAT ALREADY EXISTED
-- --------------------
-- notifications (properly scoped to its recipient, with a dedupe_key),
-- automation_runs, opportunity_flags with a full status lifecycle, and a live
-- pg_cron job `run-automations-daily` at 04:00. The alerting machinery works.
--
-- WHAT WAS MISSING
-- ----------------
-- 1. EVERY THRESHOLD WAS A LITERAL. "Stalled" was 14 days hardcoded into a
--    Phase 10 view; follow-up cadence lives in an enum; review lateness was
--    nowhere. Changing what "late" means required a migration, so in practice
--    it never changed and the number stopped matching the business.
--
-- 2. NOTHING WATCHED THE WATCHER. automation_runs records each run, and no
--    query asked whether a run had happened at all. A cron job that silently
--    stops produces exactly the same thing as a quiet week — no alerts — and
--    the failure mode of an alerting system is indistinguishable from success
--    unless something checks.
--
-- 3. BREACHES WERE SCATTERED. Overdue commitments, stalled deals, prices
--    waiting on a reviewer and unreviewed leads each had their own shape.
--    Phases 8 to 12 deliberately exposed days_waiting / days_overdue so this
--    phase could read lateness rather than re-derive it; this is where that
--    gets collected.
--
-- 4. opportunity_flags was SELECT USING (is_active_user()) — the ninth blanket
--    read found in this project — and deletable by any sales contributor. The
--    frontend was checked first: nothing deletes a flag, it dismisses one.
--
-- WHY THE FLOOR IS CONFIGURABLE AND THE ALERT IS NOT AUTOMATIC
-- ------------------------------------------------------------
-- sla_policies sets the thresholds. Nothing here sends anything: the views
-- report what has breached, and the existing automation writes notifications
-- through its existing path. Adding a second notification writer would give
-- the system two places that decide who gets told, which is how people end up
-- muting all of it.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

DO $$ BEGIN
  CREATE TYPE public.sla_subject AS ENUM (
    'stalled_deal', 'follow_up', 'commitment', 'price_review', 'lead_review', 'quotation_validity');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ 1. What "late" means, and since when ============
CREATE TABLE IF NOT EXISTS public.sla_policies (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject        public.sla_subject NOT NULL,
  threshold_days INTEGER NOT NULL,
  -- Who hears about it when this breaches. NULL means the record's owner,
  -- which is the sane default and the one that needs no configuration.
  escalate_to_role public.app_role,
  rationale      TEXT,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to   TIMESTAMPTZ,
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sla_threshold_sane CHECK (threshold_days >= 0 AND threshold_days <= 365),
  CONSTRAINT sla_range_sane     CHECK (effective_to IS NULL OR effective_to > effective_from)
);

-- One policy per subject at a time; two answers to "how late is late" is worse
-- than none, because both sides can cite one.
ALTER TABLE public.sla_policies DROP CONSTRAINT IF EXISTS sla_policies_no_overlap;
ALTER TABLE public.sla_policies ADD CONSTRAINT sla_policies_no_overlap
  EXCLUDE USING gist (subject WITH =, tstzrange(effective_from, effective_to) WITH &&);

COMMENT ON TABLE public.sla_policies IS
  'Configurable lateness thresholds per subject, superseded over time rather than edited. Phase 10''s hardcoded 14-day stall is the fallback when no policy is set.';

CREATE OR REPLACE FUNCTION public.current_sla_days(_subject public.sla_subject)
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.threshold_days FROM public.sla_policies p
   WHERE p.subject = _subject
     AND now() >= p.effective_from
     AND (p.effective_to IS NULL OR now() < p.effective_to)
   ORDER BY p.effective_from DESC LIMIT 1;
$$;

COMMENT ON FUNCTION public.current_sla_days IS
  'The threshold in force for one subject, or NULL when none is set. Callers supply their own fallback so an unset policy never means "everything is breaching".';

ALTER TABLE public.sla_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SLA policies readable by active users" ON public.sla_policies;
CREATE POLICY "SLA policies readable by active users"
  ON public.sla_policies FOR SELECT TO authenticated
  USING (public.is_active_user((SELECT auth.uid())));

-- Deliberately readable by everyone active: a rule people are measured against
-- that they cannot see is not a rule, it is a trap. Setting it is management's.
DROP POLICY IF EXISTS "SLA policies settable by the pipeline leadership" ON public.sla_policies;
CREATE POLICY "SLA policies settable by the pipeline leadership"
  ON public.sla_policies FOR INSERT TO authenticated
  WITH CHECK (public.is_pipeline_operator((SELECT auth.uid()))
              AND created_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "SLA policies closable by the pipeline leadership" ON public.sla_policies;
CREATE POLICY "SLA policies closable by the pipeline leadership"
  ON public.sla_policies FOR UPDATE TO authenticated
  USING (public.is_pipeline_operator((SELECT auth.uid())))
  WITH CHECK (public.is_pipeline_operator((SELECT auth.uid())));

DROP TRIGGER IF EXISTS sla_policies_no_delete ON public.sla_policies;
CREATE TRIGGER sla_policies_no_delete BEFORE DELETE ON public.sla_policies
  FOR EACH ROW EXECUTE FUNCTION public.refuse_delete();

REVOKE ALL ON public.sla_policies FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.sla_policies TO authenticated;

-- ============ 2. Is the automation actually running? ============
CREATE OR REPLACE VIEW public.automation_health AS
  SELECT r.trigger,
         max(r.finished_at)                                       AS last_finished_at,
         max(r.started_at)                                        AS last_started_at,
         round(extract(epoch FROM now() - max(r.finished_at)) / 3600, 1) AS hours_since_last,
         count(*) FILTER (WHERE r.error IS NOT NULL)              AS runs_with_errors,
         (SELECT rr.error FROM public.automation_runs rr
           WHERE rr.trigger = r.trigger ORDER BY rr.started_at DESC LIMIT 1) AS last_error,
         -- The daily job should never be more than a day and a bit stale. A
         -- quiet week and a dead cron look identical from the outside; this is
         -- the only thing that tells them apart.
         (max(r.finished_at) IS NULL
          OR max(r.finished_at) < now() - interval '30 hours')    AS looks_stalled
    FROM public.automation_runs r
   GROUP BY r.trigger;

COMMENT ON VIEW public.automation_health IS
  'Whether the scheduled automation is alive. A cron that silently stops produces no alerts, which is indistinguishable from a quiet week unless something checks — this is that check.';
GRANT SELECT ON public.automation_health TO authenticated;

-- ============ 3. One breach list ============
-- Reads the lateness each earlier phase already computes rather than
-- re-deriving it, so a fix to one definition does not need finding in two
-- places. Each branch carries its own scope; nothing here widens a read.
CREATE OR REPLACE VIEW public.sla_breaches AS
  -- Commitments past their date (Phase 9)
  SELECT 'commitment'::public.sla_subject AS subject,
         c.id            AS record_id,
         c.opportunity_id,
         c.owner_id,
         c.description   AS detail,
         c.days_overdue,
         coalesce(public.current_sla_days('commitment'), 0) AS threshold_days
    FROM public.overdue_commitments c
   WHERE c.days_overdue > coalesce(public.current_sla_days('commitment'), 0)

  UNION ALL
  -- Prices waiting on a reviewer (Phase 8)
  SELECT 'price_review',
         q.internal_price_id,
         q.related_opportunity_id,
         NULL::uuid,
         'Awaiting ' || coalesce(q.awaiting, 'review'),
         floor(q.days_waiting)::int,
         coalesce(public.current_sla_days('price_review'), 3)
    FROM public.commercial_review_queue q
   WHERE q.days_waiting > coalesce(public.current_sla_days('price_review'), 3)

  UNION ALL
  -- Leads nobody has looked at (Phase 12)
  SELECT 'lead_review',
         l.id,
         NULL::uuid,
         l.owner_id,
         coalesce(l.project_name, 'Unnamed lead'),
         floor(l.days_waiting)::int,
         coalesce(public.current_sla_days('lead_review'), 7)
    FROM public.lead_review_queue l
   WHERE NOT l.reviewed
     AND l.days_waiting > coalesce(public.current_sla_days('lead_review'), 7)

  UNION ALL
  -- Follow-ups already marked overdue by their own lifecycle
  SELECT 'follow_up',
         f.id,
         f.opportunity_id,
         f.owner_id,
         coalesce(nullif(btrim(f.notes), ''), 'Follow up'),
         greatest((current_date - f.due_date::date), 0),
         coalesce(public.current_sla_days('follow_up'), 0)
    FROM public.follow_ups f
   WHERE f.status IN ('due','overdue')
     AND f.due_date IS NOT NULL
     AND (current_date - f.due_date::date) > coalesce(public.current_sla_days('follow_up'), 0)
     AND public.can_read_boq(f.opportunity_id, (SELECT auth.uid()))

  UNION ALL
  -- Deals nobody has touched (Phase 10's definition, now configurable)
  SELECT 'stalled_deal',
         o.id,
         o.id,
         o.owner_id,
         o.project_name,
         coalesce((current_date - o.last_activity_at::date), 9999),
         coalesce(public.current_sla_days('stalled_deal'), 14)
    FROM public.analytics_scope_opportunities o
   WHERE o.sales_stage NOT IN ('won','lost')
     AND (o.last_activity_at IS NULL
          OR o.last_activity_at < now()
             - make_interval(days => coalesce(public.current_sla_days('stalled_deal'), 14)));

COMMENT ON VIEW public.sla_breaches IS
  'Everything currently past its threshold, in one shape. Reads the lateness each phase already computes rather than re-deriving it. Reports only — sending remains the existing automation''s job, because two writers deciding who gets told is how people end up muting all of it.';
GRANT SELECT ON public.sla_breaches TO authenticated;

-- ============ 4. Close the ninth blanket read ============
-- Flags name the deal and the reason it is in trouble. Scoped to the linked
-- record, with the pipeline seeing the board. The frontend dismisses flags
-- via status and never deletes one, so the DELETE policy is capability
-- without a caller.
CREATE OR REPLACE FUNCTION public.can_read_opportunity_flag(
  _linked_record_type TEXT, _linked_record_id UUID, _action_owner_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF _user_id IS NULL OR NOT public.is_active_user(_user_id) THEN
    RETURN FALSE;
  END IF;
  IF _action_owner_id = _user_id OR public.is_pipeline_operator(_user_id) THEN
    RETURN TRUE;
  END IF;
  IF _linked_record_id IS NULL THEN
    RETURN FALSE;
  END IF;

  CASE lower(coalesce(_linked_record_type, ''))
    WHEN 'opportunity' THEN RETURN public.can_read_boq(_linked_record_id, _user_id);
    WHEN 'quotation'   THEN RETURN public.can_read_quotation(_linked_record_id, _user_id);
    WHEN 'rfq' THEN
      RETURN EXISTS (SELECT 1 FROM public.rfqs r WHERE r.id = _linked_record_id
                       AND (r.sales_owner_id = _user_id OR r.assigned_to = _user_id));
    WHEN 'tender' THEN
      RETURN EXISTS (SELECT 1 FROM public.tenders t WHERE t.id = _linked_record_id
                       AND t.tender_owner_id = _user_id);
    ELSE RETURN FALSE;
  END CASE;
END; $$;

COMMENT ON FUNCTION public.can_read_opportunity_flag IS
  'Whether a user may see one flag: the person who owes the action, the pipeline, or someone with a stake in the linked record. Unrecognised link types return FALSE.';

-- Swept by COMMAND, not by name. Permissive policies OR together, so a
-- surviving blanket policy silently defeats the new one and every isolation
-- check still passes for the wrong reason. Guessing the old name is exactly
-- how that happens — the policy here was called "Flags readable", which is not
-- what a reasonable guess would have produced.
DO $$
DECLARE _p RECORD;
BEGIN
  FOR _p IN SELECT p.polname AS pol FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
             WHERE c.relname = 'opportunity_flags' AND p.polcmd IN ('r','d')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.opportunity_flags', _p.pol);
  END LOOP;
END $$;

CREATE POLICY "Opportunity flags readable by the record's people"
  ON public.opportunity_flags FOR SELECT TO authenticated
  USING (public.can_read_opportunity_flag(
           linked_record_type, linked_record_id, action_owner_id, (SELECT auth.uid())));

DROP TRIGGER IF EXISTS opportunity_flags_no_delete ON public.opportunity_flags;
CREATE TRIGGER opportunity_flags_no_delete BEFORE DELETE ON public.opportunity_flags
  FOR EACH ROW EXECUTE FUNCTION public.refuse_delete();
