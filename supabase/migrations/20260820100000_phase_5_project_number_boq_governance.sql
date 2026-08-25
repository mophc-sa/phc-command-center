-- =========================================================
-- Phase 5 — NO BOQ, NO PROJECT NUMBER.
--
-- WHAT THE SYSTEM LOOKS LIKE TODAY (audited before writing this)
-- --------------------------------------------------------------
-- There are two different "project numbers", and only one of them is the
-- official one:
--
--   inbox_items.project_number   'INT-YYYY-NNNN'  auto-stamped on every intake.
--                                20260803130000 states outright that "an intake
--                                capture isn't a confirmed project yet, so it
--                                shouldn't borrow that numbering space". It is a
--                                capture reference, not a project number, and
--                                this migration deliberately leaves it alone —
--                                the PRD explicitly allows intake without a
--                                project number.
--
--   projects.project_number      'PRJ-YYYY-NNNN'  the official one. Auto-stamped
--                                by generate_project_number() on EVERY insert.
--
-- The `projects` table is a market/asset registry: owner company, contractor,
-- consultant, sector, expected BOQ date. Rows arrive through market research and
-- imports. Today all 36 rows carry a PRJ- number, **none** has an opportunity
-- attached, and **none** has a BOQ. The number is therefore currently stamped on
-- everything and means nothing.
--
-- THE RULE
-- --------
-- A project gets its official number only when a real BOQ exists for it. The
-- chain is projects <- opportunities.project_id <- boqs.related_opportunity_id;
-- there is no direct projects->boqs link, so the join goes through the
-- opportunity, which is also the only place a BOQ is ever attached.
--
-- "Real BOQ" means a boqs row whose status is 'verified' or
-- 'partially_verified'. 'missing' is the absence of a BOQ by definition, and
-- 'estimated_scope' is our own guess at the scope rather than a document the
-- client sent — neither is evidence that a BOQ exists. A `has_boq` checkbox on
-- the intake form is a claim, not evidence, and is deliberately NOT accepted
-- here (PRD §21).
--
-- WHAT THIS CHANGES, AND THE ONE THING TO WEIGH
-- ---------------------------------------------
--   * The 36 existing numbers are untouched. No backfill, no renumbering.
--   * Auto-stamping becomes conditional: a new project gets a number at insert
--     only if a qualifying BOQ already exists. Otherwise project_number stays
--     NULL until someone issues it.
--   * issue_project_number(uuid) is the explicit issuance path, and enforces the
--     rule server-side.
--   * A trigger blocks any other write that puts a number on a project, so the
--     protection is not UI-only and not RPC-only.
--
-- ⚠️ CONSEQUENCE TO CONFIRM BEFORE APPLYING: because production currently holds
-- zero BOQs and zero project<-opportunity links, every project created after
-- this migration will have project_number = NULL until a BOQ is registered.
-- That is the rule working as specified, but it is a visible behaviour change
-- for market-registry rows, which is why it is called out here rather than
-- discovered later. Building BOQ capture is Phase 7 (Commercial & Finance);
-- this migration deliberately does not build it.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. What counts as a real BOQ ============
CREATE OR REPLACE FUNCTION public.project_has_valid_boq(_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.opportunities o
      JOIN public.boqs b ON b.related_opportunity_id = o.id
     WHERE o.project_id = _project_id
       -- 'missing' is the absence of a BOQ; 'estimated_scope' is our estimate,
       -- not a document received. Neither issues a project number.
       AND b.status IN ('verified', 'partially_verified')
  );
$$;

COMMENT ON FUNCTION public.project_has_valid_boq IS
  'True when a project has at least one verified or partially_verified BOQ, joined through opportunities.project_id. A has_boq checkbox is a claim and is deliberately not consulted.';

-- ============ 2. Bilingual refusal ============
-- The message is raised from the database, so it must carry both languages —
-- the client cannot re-translate an exception it did not generate.
CREATE OR REPLACE FUNCTION public.project_number_denied_message()
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'Project number cannot be issued until a BOQ is attached or registered. '
      || '| لا يمكن إصدار رقم المشروع قبل إرفاق أو تسجيل جدول الكميات (BOQ).';
$$;

-- ============ 3. Conditional auto-generation ============
-- Replaces the unconditional stamp from 20260803100000.
CREATE OR REPLACE FUNCTION public.generate_project_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A caller that supplied a number explicitly is validated by the guard
  -- trigger below, not here.
  IF NEW.project_number IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- On INSERT the row does not exist yet, so no opportunity can point at it and
  -- no BOQ can exist for it. A brand-new project therefore never auto-numbers;
  -- the number is issued later via issue_project_number() once a BOQ arrives.
  -- The check is still written out rather than hard-coded to NULL so the
  -- behaviour stays correct if a future flow inserts a project that already has
  -- its lineage attached.
  IF TG_OP = 'UPDATE' AND public.project_has_valid_boq(NEW.id) THEN
    NEW.project_number := 'PRJ-' || to_char(now(), 'YYYY') || '-' ||
                          lpad(nextval('public.project_number_seq')::text, 4, '0');
  END IF;

  RETURN NEW;
END;
$$;

-- ============ 4. The guard ============
-- Enforcement lives here, not in the RPC, so no write path can bypass it:
-- direct table update, a future server action, an import, or PostgREST.
CREATE OR REPLACE FUNCTION public.protect_project_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Unchanged number: nothing to police.
  IF TG_OP = 'UPDATE' AND NEW.project_number IS NOT DISTINCT FROM OLD.project_number THEN
    RETURN NEW;
  END IF;

  IF NEW.project_number IS NULL THEN
    RETURN NEW;                      -- clearing a number is not issuance
  END IF;

  -- Re-issuing over an existing number would break every reference to it.
  IF TG_OP = 'UPDATE' AND OLD.project_number IS NOT NULL THEN
    RAISE EXCEPTION 'A project number has already been issued for this project and cannot be changed. | تم إصدار رقم لهذا المشروع مسبقًا ولا يمكن تغييره.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The rule itself.
  IF NOT public.project_has_valid_boq(NEW.id) THEN
    RAISE EXCEPTION '%', public.project_number_denied_message()
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_project_number ON public.projects;
CREATE TRIGGER trg_protect_project_number
  BEFORE INSERT OR UPDATE OF project_number ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.protect_project_number();

-- Ordering matters: generate_project_number may set NEW.project_number, and the
-- guard must then validate what it set. Postgres fires same-event BEFORE
-- triggers in name order, and 'trg_generate_project_number' sorts before
-- 'trg_protect_project_number', so generation runs first. Recreated here so the
-- dependency is explicit rather than incidental.
DROP TRIGGER IF EXISTS trg_generate_project_number ON public.projects;
CREATE TRIGGER trg_generate_project_number
  BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.generate_project_number();

-- ============ 5. Explicit issuance ============
CREATE OR REPLACE FUNCTION public.issue_project_number(_project_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing TEXT;
  _number   TEXT;
BEGIN
  -- Issuing a project number is a commercial act, so it needs commercial
  -- authority. is_commercial_manager excludes system_admin by Phase 1 design —
  -- an administrator who legitimately issues numbers holds a business role and
  -- passes on that, not on being an administrator.
  IF auth.uid() IS NOT NULL AND NOT public.is_commercial_manager(auth.uid()) THEN
    RAISE EXCEPTION 'Only a commercial manager may issue a project number. | إصدار رقم المشروع يقتصر على مدير تجاري.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT project_number INTO _existing FROM public.projects WHERE id = _project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found. | المشروع غير موجود.' USING ERRCODE = 'no_data_found';
  END IF;
  IF _existing IS NOT NULL THEN
    RETURN _existing;                -- idempotent: already issued
  END IF;

  IF NOT public.project_has_valid_boq(_project_id) THEN
    RAISE EXCEPTION '%', public.project_number_denied_message()
      USING ERRCODE = 'check_violation';
  END IF;

  _number := 'PRJ-' || to_char(now(), 'YYYY') || '-' ||
             lpad(nextval('public.project_number_seq')::text, 4, '0');

  -- The guard trigger re-checks this write; passing the rule twice is
  -- intentional, so the RPC is a convenience rather than the only defence.
  UPDATE public.projects SET project_number = _number WHERE id = _project_id;

  RETURN _number;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_project_number(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_project_number(UUID) TO authenticated;

COMMENT ON FUNCTION public.issue_project_number IS
  'Issues the official PRJ- number for a project, only when a verified or partially_verified BOQ exists and the caller holds commercial authority. Idempotent. The projects trigger enforces the same rule, so no write path can bypass it.';

-- ============ 6. Uniqueness ============
-- projects_project_number_key already exists as a UNIQUE constraint; asserted
-- here so a future migration that drops it fails this one's behavioural test
-- rather than silently allowing duplicates.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'projects'
       AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%project_number%'
  ) THEN
    CREATE UNIQUE INDEX projects_project_number_unique
        ON public.projects (project_number)
     WHERE project_number IS NOT NULL;
  END IF;
END $$;
