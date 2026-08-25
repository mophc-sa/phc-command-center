-- =========================================================
-- FIX — the agent-ingest guard used the wrong discriminator.
--
-- WHAT BROKE
-- ----------
-- Phase 12 gated automated lead ingestion on `auth.uid() IS NULL`, reasoning
-- that cron and the orchestrator connect without a JWT. That premise is wrong.
-- A NULL auth.uid() does not mean "an agent did this" — it means there is no
-- JWT on this connection, which is equally true of database seeds, migrations,
-- the pgTAP suite, and any backend path acting on behalf of a named person.
--
-- The pgTAP security suite caught it: rls_role_matrix.test.sql inserts a
-- fixture lead with an explicit created_by and no source. leads.source defaults
-- to 'manual', which is not in source_registry, so a hand-authored lead with a
-- named human author was refused as unsanctioned automated ingestion, and all
-- 30 subtests failed before they ran.
--
-- Worth stating plainly: this suite runs in CI and NOT in the local
-- behavioural harness, which is why 669/669 passed locally while CI failed.
--
-- THE RIGHT DISCRIMINATOR
-- -----------------------
-- Not who is connecting — what the row claims about itself. An automated
-- ingest names no human author. A lead that carries created_by has a person
-- standing behind it, whatever connection it arrived on, and their judgement
-- is what the registry exemption was always meant to respect.
--
--   created_by IS NOT NULL  -> a person is accountable. Any source.
--   created_by IS NULL      -> nobody is. Cite an approved source.
--
-- This is stricter than before in one useful way: an authenticated user who
-- inserts a lead is now stamped as its author by the same trigger, so the
-- "nobody is accountable" branch really does mean nobody.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

CREATE OR REPLACE FUNCTION public.lead_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Leads are archived or rejected, not deleted — a discarded lead is evidence the source was searched. | تُؤرشف العملاء المحتملون ولا يُحذفون.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Stamp the author first, so the accountability test below sees it.
    NEW.created_by := coalesce(NEW.created_by, _uid);

    -- Nobody is named as the author: this is machine ingestion however it
    -- arrived, and it must cite a sanctioned source.
    IF NEW.created_by IS NULL
       AND NOT public.source_is_approved_for_agents(NEW.source) THEN
      RAISE EXCEPTION 'Unattributed ingestion refused: % is not approved_for_agent_use in source_registry. | المصدر غير معتمد للاستخدام الآلي.',
        coalesce(NEW.source, '(no source)') USING ERRCODE = 'insufficient_privilege';
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- ---- conversion ----
  IF NEW.converted_opportunity_id IS NOT NULL
     AND OLD.converted_opportunity_id IS NULL THEN

    IF NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL THEN
      RAISE EXCEPTION 'A lead must be reviewed by a person before it becomes an opportunity. | يجب مراجعة العميل المحتمل قبل تحويله.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Converting a known duplicate is how the same tender enters the pipeline
    -- twice under two owners. Both kinds of duplicate bar it: one says the
    -- pipeline already has this, the other says another lead does.
    IF NEW.duplicate_of IS NOT NULL OR NEW.duplicate_of_lead_id IS NOT NULL THEN
      RAISE EXCEPTION 'This lead is marked a duplicate — convert the original instead. | هذا العميل مكرر.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Conversion is one-way. Re-pointing it at a different opportunity after the
  -- fact would rewrite where a deal came from.
  IF OLD.converted_opportunity_id IS NOT NULL
     AND NEW.converted_opportunity_id IS DISTINCT FROM OLD.converted_opportunity_id THEN
    RAISE EXCEPTION 'A converted lead cannot be re-pointed at another opportunity. | لا يُعاد توجيه عميل محوّل.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A lead cannot be its own duplicate; that makes the chain unwalkable.
  IF NEW.duplicate_of_lead_id = NEW.id THEN
    RAISE EXCEPTION 'A lead cannot be a duplicate of itself.' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.reviewed_by IS NOT NULL AND OLD.reviewed_by IS NULL THEN
    NEW.reviewed_at := coalesce(NEW.reviewed_at, now());
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END; $$;

COMMENT ON FUNCTION public.lead_guard IS
  'Lead lifecycle guard. Automated ingestion is identified by the ABSENCE of a named author, not by an unauthenticated connection — seeds, migrations and the pgTAP suite all connect without a JWT and are not agents.';
