-- =========================================================
-- PHASE 9 — sales follow-up and communication.
--
-- WHAT ALREADY EXISTED, AND IS NOT REBUILT
-- ----------------------------------------
-- Most of this phase's surface is already in the schema and works:
--
--   activities             call / visit / meeting / email_draft /
--                          whatsapp_draft / note, with occurred_at and sender
--   follow_ups             due_date, cadence_tier, channel,
--                          scheduled/due/overdue/completed/cancelled
--   tasks                  title, due_date, priority, owner, status
--   account_interactions   company-level contact history with an outcome
--   communication_templates
--
-- None of it is touched. Rebuilding a working activity log to add two concepts
-- would be a much larger blast radius than the concepts are worth.
--
-- WHAT WAS ACTUALLY MISSING
-- -------------------------
-- 1. COMMITMENTS. Nothing modelled a promise. "We'll have the revised drawing
--    to you Thursday" and "they'll confirm the mounting height by the 5th" are
--    the two things a deal actually dies on, and both lived in the free text of
--    a note. account_interactions.next_action is close but it is one free-text
--    field per interaction, with no direction, no owner and no outcome — you
--    cannot ask it "what have we promised that is now late".
--
-- 2. A SINGLE NEXT ACTION. Three tables carry a due date. Asking "what is next
--    on this deal" meant reading all three and comparing by hand, which means
--    in practice nobody asked.
--
-- 3. A UNIFIED LOG. activities is opportunity-shaped, account_interactions is
--    company-shaped, and there was no way to read one thread of contact.
--
-- DIRECTION IS THE POINT
-- ----------------------
-- A commitment records who owes whom. A missed promise of ours is a different
-- management problem from a client who has gone quiet, and collapsing them into
-- one "next action" field is why neither gets chased.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

DO $$ BEGIN
  CREATE TYPE public.commitment_direction AS ENUM ('we_owe_client', 'client_owes_us');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.commitment_status AS ENUM ('open', 'met', 'missed', 'waived', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ 1. Commitments ============
CREATE TABLE IF NOT EXISTS public.commitments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  company_id     UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  contact_id     UUID REFERENCES public.contacts(id) ON DELETE SET NULL,

  direction      public.commitment_direction NOT NULL,
  description    TEXT NOT NULL,
  due_date       DATE NOT NULL,

  -- Who chases it internally. Even a client-owed commitment has one of ours.
  owner_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status         public.commitment_status NOT NULL DEFAULT 'open',

  -- Which conversation it came out of, when it came out of one.
  source_activity_id UUID REFERENCES public.activities(id) ON DELETE SET NULL,

  closed_at      TIMESTAMPTZ,
  closed_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  outcome_note   TEXT,

  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT cm_description_present CHECK (btrim(description) <> ''),
  -- A closed commitment with no record of how it closed is the same as no
  -- record at all — you cannot tell a met promise from an abandoned one.
  CONSTRAINT cm_closed_is_stamped CHECK (
    status = 'open'
    OR (closed_at IS NOT NULL AND closed_by IS NOT NULL)),
  CONSTRAINT cm_waived_has_reason CHECK (
    status <> 'waived' OR btrim(coalesce(outcome_note, '')) <> ''),
  CONSTRAINT cm_open_is_not_stamped CHECK (
    status <> 'open' OR (closed_at IS NULL AND closed_by IS NULL))
);

CREATE INDEX IF NOT EXISTS commitments_opportunity ON public.commitments (opportunity_id);
CREATE INDEX IF NOT EXISTS commitments_owner       ON public.commitments (owner_id);
-- The query this table exists to answer: what is open and late.
CREATE INDEX IF NOT EXISTS commitments_open_due    ON public.commitments (due_date)
  WHERE status = 'open';

COMMENT ON TABLE public.commitments IS
  'Promises, in both directions, with a due date and an outcome. Kept separate from tasks because a promise to a client is not an internal to-do: it has a counterparty, and missing it costs something tasks do not model.';
COMMENT ON COLUMN public.commitments.direction IS
  'we_owe_client or client_owes_us. A promise we broke and a client who has gone quiet are different management problems; collapsing them is why neither gets chased.';

-- ============ 2. Guard ============
CREATE OR REPLACE FUNCTION public.commitment_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Commitments are cancelled, not deleted — the promise was still made. | الالتزامات تُلغى ولا تُحذف.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := coalesce(NEW.created_by, _uid);
    NEW.owner_id   := coalesce(NEW.owner_id, _uid);
    IF NEW.status <> 'open' THEN
      RAISE EXCEPTION 'A commitment starts open. | يبدأ الالتزام مفتوحًا.'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- What was promised, to whom, and by when does not change. Rewriting the
  -- promise after the fact is how a missed commitment becomes a met one.
  IF NEW.description    IS DISTINCT FROM OLD.description
     OR NEW.direction   IS DISTINCT FROM OLD.direction
     OR NEW.due_date    IS DISTINCT FROM OLD.due_date
     OR NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id THEN
    RAISE EXCEPTION 'A commitment''s terms are fixed once made — cancel it and record a new one. | لا تُعدّل شروط الالتزام.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Closed is closed.
  IF OLD.status <> 'open' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'A closed commitment cannot be reopened. | لا يُعاد فتح التزام مغلق.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status <> 'open' AND OLD.status = 'open' THEN
    NEW.closed_at := coalesce(NEW.closed_at, now());
    NEW.closed_by := coalesce(NEW.closed_by, _uid);
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS commitments_guard ON public.commitments;
CREATE TRIGGER commitments_guard BEFORE INSERT OR UPDATE ON public.commitments
  FOR EACH ROW EXECUTE FUNCTION public.commitment_guard();
DROP TRIGGER IF EXISTS commitments_no_delete ON public.commitments;
CREATE TRIGGER commitments_no_delete BEFORE DELETE ON public.commitments
  FOR EACH ROW EXECUTE FUNCTION public.commitment_guard();

-- ============ 3. RLS ============
-- Reuses can_read_boq, which despite the name is the opportunity-scoped
-- predicate the rest of the deal's records already use: the owner, the
-- pipeline, and management. Not a new access rule.
ALTER TABLE public.commitments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Commitments readable by the deal's people" ON public.commitments;
CREATE POLICY "Commitments readable by the deal's people"
  ON public.commitments FOR SELECT TO authenticated
  USING (public.can_read_boq(opportunity_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "Commitments creatable by the deal's people" ON public.commitments;
CREATE POLICY "Commitments creatable by the deal's people"
  ON public.commitments FOR INSERT TO authenticated
  WITH CHECK (public.can_read_boq(opportunity_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "Commitments closable by the deal's people" ON public.commitments;
CREATE POLICY "Commitments closable by the deal's people"
  ON public.commitments FOR UPDATE TO authenticated
  USING (public.can_read_boq(opportunity_id, (SELECT auth.uid())))
  WITH CHECK (public.can_read_boq(opportunity_id, (SELECT auth.uid())));

-- No DELETE policy; the trigger refuses the service role too.
REVOKE ALL ON public.commitments FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.commitments TO authenticated;

-- ============ 4. One next action per deal ============
-- follow_ups, tasks and commitments all carry a due date. This picks the
-- earliest thing still open on each opportunity, so "what is next" is one
-- question with one answer instead of three lists to reconcile by eye.
CREATE OR REPLACE VIEW public.opportunity_next_action AS
WITH due AS (
  SELECT f.opportunity_id, 'follow_up'::text AS source, f.id AS source_id,
         f.due_date::date AS due_date, f.owner_id,
         coalesce(nullif(btrim(f.notes), ''), 'Follow up') AS description
    FROM public.follow_ups f
   WHERE f.status IN ('scheduled', 'due', 'overdue')

  UNION ALL
  SELECT t.related_opportunity_id, 'task', t.id, t.due_date::date, t.owner_id, t.title
    FROM public.tasks t
   WHERE t.related_opportunity_id IS NOT NULL
     AND t.status <> 'completed'
     AND t.due_date IS NOT NULL

  UNION ALL
  SELECT c.opportunity_id, 'commitment', c.id, c.due_date, c.owner_id, c.description
    FROM public.commitments c
   WHERE c.status = 'open'
)
SELECT DISTINCT ON (d.opportunity_id)
       d.opportunity_id, d.source, d.source_id, d.due_date, d.owner_id, d.description,
       (d.due_date < current_date) AS is_overdue,
       (d.due_date - current_date) AS days_until_due
  FROM due d
 WHERE public.can_read_boq(d.opportunity_id, (SELECT auth.uid()))
 ORDER BY d.opportunity_id, d.due_date ASC, d.source;

COMMENT ON VIEW public.opportunity_next_action IS
  'The single earliest open item per opportunity across follow-ups, tasks and commitments. Ties break by due date then source name so the answer is stable between reads.';
GRANT SELECT ON public.opportunity_next_action TO authenticated;

-- ============ 5. One thread of contact ============
-- activities is opportunity-shaped and account_interactions is company-shaped.
-- This reads them as one history.
--
-- Note the gates differ per branch and are deliberately NARROWER than the
-- underlying tables: activities is currently readable by every active user,
-- which is its own finding, and this view does not inherit that.
CREATE OR REPLACE VIEW public.communication_log AS
  SELECT a.id,
         'activity'::text        AS source,
         a.related_opportunity_id AS opportunity_id,
         a.company_id,
         a.contact_id,
         a.activity_type::text   AS kind,
         a.status::text          AS state,
         a.occurred_at,
         a.summary,
         a.owner_id,
         a.created_by,
         a.created_at
    FROM public.activities a
   WHERE a.related_opportunity_id IS NOT NULL
     AND public.can_read_boq(a.related_opportunity_id, (SELECT auth.uid()))

  UNION ALL

  SELECT i.id,
         'account_interaction',
         NULL::uuid,
         i.company_id,
         i.contact_id,
         i.interaction_type::text,
         coalesce(i.outcome, 'logged'),
         i.interaction_date::timestamptz,
         i.summary,
         NULL::uuid,
         i.created_by,
         i.created_at
    FROM public.account_interactions i
   WHERE public.is_sales_contributor((SELECT auth.uid()));

COMMENT ON VIEW public.communication_log IS
  'Opportunity activities and company-level interactions as one thread. draft_content is deliberately absent — an unsent draft is not contact history, and it is the field most likely to carry commercial detail.';
GRANT SELECT ON public.communication_log TO authenticated;

-- ============ 6. What is late ============
CREATE OR REPLACE VIEW public.overdue_commitments AS
  SELECT c.id, c.opportunity_id, c.company_id, c.direction, c.description,
         c.due_date, c.owner_id,
         (current_date - c.due_date) AS days_overdue
    FROM public.commitments c
   WHERE c.status = 'open'
     AND c.due_date < current_date
     AND public.can_read_boq(c.opportunity_id, (SELECT auth.uid()));

COMMENT ON VIEW public.overdue_commitments IS
  'Open commitments past their date, both directions. Phase 13''s escalation rules read this rather than re-deriving lateness.';
GRANT SELECT ON public.overdue_commitments TO authenticated;
