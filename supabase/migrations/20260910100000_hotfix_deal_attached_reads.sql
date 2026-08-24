-- =========================================================
-- SECURITY HOTFIX — the blanket reads that have an obvious owner.
--
-- Of the 28 tables still carrying `SELECT USING (is_active_user(auth.uid()))`,
-- six point directly at an opportunity. Those need no business decision: a
-- record attached to a deal is read by the deal's people, which is the rule
-- every other deal-attached table in this schema already uses. The remaining
-- 22 — companies, contacts, projects, the AI internals, the import scaffolding
-- — each need their own call and are deliberately untouched.
--
-- SWEPT BY PREDICATE, NOT BY NAME AND NOT BY COMMAND
-- --------------------------------------------------
-- Phase 13 taught that dropping a policy by guessed name silently leaves the
-- blanket one in place, ORing itself back in. The open-table hotfix then
-- taught that sweeping by command is not enough either, because a FOR ALL
-- policy's USING clause governs SELECT.
--
-- This one adds the third lesson: boq_extractions ALREADY has a correct,
-- deal-scoped read policy — and a blanket `boq_extractions_readable` sitting
-- beside it, ORing the scope away. Somebody wrote the right rule and it has
-- never once taken effect. A command-level sweep would have dropped both and
-- thrown the good one away, so this matches on the PREDICATE and removes only
-- the blanket policy.
--
-- evidence_sources additionally carries a FOR ALL policy whose USING clause
-- grants reads to bd_manager and friends. That is legitimate as a write rule
-- and is not touched; a RESTRICTIVE SELECT policy caps the read instead, which
-- ANDs with the permissive union rather than ORing into it.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. One rule for a record attached to a deal ============
CREATE OR REPLACE FUNCTION public.can_read_opportunity_record(_opportunity_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT _user_id IS NOT NULL
     AND public.is_active_user(_user_id)
     AND CASE
           WHEN _opportunity_id IS NOT NULL
             THEN public.can_read_boq(_opportunity_id, _user_id)
           -- Attached to no deal: infrastructure rather than deal information,
           -- so it reaches the pipeline and nobody else. Same call made for
           -- unattached AI advice in Phase 11.
           ELSE public.is_pipeline_operator(_user_id)
         END;
$$;

COMMENT ON FUNCTION public.can_read_opportunity_record IS
  'Read rule for any record hanging off an opportunity: the deal''s people, or the pipeline when it hangs off nothing. Reuses can_read_boq rather than inventing a second answer.';

-- ============ 2. Approvals need a wider rule than the deal alone ============
-- related_opportunity_id is nullable, and an approval also concerns two people
-- the deal boundary does not know about: whoever asked, and whoever must
-- decide. Gating on the opportunity alone would hide an approval from the very
-- person it is waiting on.
CREATE OR REPLACE FUNCTION public.can_read_approval(
  _related_opportunity_id UUID, _requested_by UUID, _assigned_approver UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT _user_id IS NOT NULL
     AND public.is_active_user(_user_id)
     AND (
       _requested_by      = _user_id
       OR _assigned_approver = _user_id
       OR (_related_opportunity_id IS NOT NULL
           AND public.can_read_boq(_related_opportunity_id, _user_id))
       OR public.is_pipeline_operator(_user_id)
     );
$$;

COMMENT ON FUNCTION public.can_read_approval IS
  'Who may read one approval: the requester, the assigned approver, the deal''s people, or the pipeline. Note this narrows the READ only — payload contents are separately kept free of money by the Phase 7C trigger, because approvals remain visible to more people than any single deal.';

-- ============ 3. Drop the blanket policies, by predicate ============
DO $$
DECLARE _p RECORD; _n INT := 0;
BEGIN
  FOR _p IN
    SELECT tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND cmd = 'SELECT'
       AND tablename IN ('stakeholders','operations_handovers','artifacts',
                         'boq_extractions','approvals','evidence_sources')
       AND btrim(regexp_replace(coalesce(qual, 'x'), E'[\n ]+', ' ', 'g'))
           IN ('is_active_user(( SELECT auth.uid() AS uid))', 'is_active_user(auth.uid())')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', _p.policyname, _p.tablename);
    _n := _n + 1;
    RAISE NOTICE 'dropped blanket read %.%', _p.tablename, _p.policyname;
  END LOOP;
  RAISE NOTICE 'blanket read policies dropped: %', _n;
END $$;

-- ============ 4. Scoped reads ============
-- boq_extractions is absent on purpose: its correct policy already exists and
-- was only ever being defeated by the blanket one dropped above.
CREATE POLICY "Stakeholders readable with the deal"
  ON public.stakeholders FOR SELECT TO authenticated
  USING (public.can_read_opportunity_record(opportunity_id, (SELECT auth.uid())));

CREATE POLICY "Handovers readable with the deal"
  ON public.operations_handovers FOR SELECT TO authenticated
  USING (
    public.can_read_opportunity_record(opportunity_id, (SELECT auth.uid()))
    -- The two people named on the handover see it wherever the deal sits.
    OR commercial_owner_id = (SELECT auth.uid())
    OR operations_owner_id = (SELECT auth.uid())
  );

CREATE POLICY "Artifacts readable with the deal"
  ON public.artifacts FOR SELECT TO authenticated
  USING (public.can_read_opportunity_record(related_opportunity_id, (SELECT auth.uid())));

CREATE POLICY "Evidence readable with the deal"
  ON public.evidence_sources FOR SELECT TO authenticated
  USING (public.can_read_opportunity_record(related_opportunity_id, (SELECT auth.uid())));

CREATE POLICY "Approvals readable by their people"
  ON public.approvals FOR SELECT TO authenticated
  USING (public.can_read_approval(
           related_opportunity_id, requested_by, assigned_approver, (SELECT auth.uid())));

-- ============ 5. Cap the FOR ALL policy on evidence_sources ============
-- Its write rule grants bd_manager and friends FOR ALL, and a FOR ALL USING
-- governs SELECT — so without this the scoped policy above would be ORed
-- straight back open. Restrictive ANDs instead.
CREATE POLICY "Evidence read is capped to the deal"
  ON public.evidence_sources AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.can_read_opportunity_record(related_opportunity_id, (SELECT auth.uid())));
