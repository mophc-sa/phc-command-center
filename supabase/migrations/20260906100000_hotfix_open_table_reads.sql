-- =========================================================
-- SECURITY HOTFIX — the tables with no read predicate at all.
--
-- A systematic sweep of every SELECT policy in the schema found 33 that are
-- effectively blanket. The nine closed across Phases 9 to 13 were the ones
-- that happened to sit in the path of a feature; nobody had ever asked the
-- question across the whole schema at once.
--
-- This closes the worst class: FIVE tables whose read predicate is literally
-- `true`. Not "every active user" — no predicate whatsoever.
--
--   project_budget_items    project cost lines
--   project_jobs            the delivery board
--   project_job_stages      its columns
--   opportunity_milestones  deal milestones
--   vendors                 the supplier directory, open since before 7B
--
-- WHY THESE FIVE AND NOT ALL 33
-- ------------------------------
-- The remaining 28 are `is_active_user()`, and most are either empty
-- scaffolding or legitimately shared: companies and contacts are the CRM
-- directory the whole team works from, communication_templates and
-- source_registry are reference data, and sla_policies is deliberately
-- readable because a rule people are measured against and cannot see is a
-- trap. Narrowing those needs a per-table decision and a frontend check each,
-- which is a campaign, not a hotfix.
--
-- `true` is different. There is no reading of it that was ever intended.
--
-- WHAT EACH ONE BECOMES, AND WHY
-- ------------------------------
-- There is NO operations role in app_role — projects are run by the same
-- sales and commercial roles as everything else. So project access resolves
-- the way the document registry already resolves it: through an opportunity
-- sitting on the project, or the pipeline. That is not a new rule; it is the
-- rule Phase 6 already uses for documents attached to a project.
--
-- Budget lines are money, so they follow the commercial gate rather than the
-- project stake. All four project/milestone tables were checked against the
-- frontend first (ProjectBudget.tsx, ProjectKanban.tsx, opportunities.$id).
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. Reach into a project ============
CREATE OR REPLACE FUNCTION public.can_read_project(_project_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT _user_id IS NOT NULL
     AND public.is_active_user(_user_id)
     AND _project_id IS NOT NULL
     AND (
       -- A project has no owner column of its own; the stake comes through the
       -- opportunity sitting on it. Same resolution document_entity_grants()
       -- has used for project documents since Phase 6.
       EXISTS (SELECT 1 FROM public.opportunities o
                WHERE o.project_id = _project_id AND o.owner_id = _user_id)
       OR public.is_pipeline_operator(_user_id)
     );
$$;

COMMENT ON FUNCTION public.can_read_project IS
  'Whether a user may reach one project: a deal of theirs sits on it, or they run the pipeline. Mirrors the project branch of document_entity_grants() rather than inventing a second answer.';

-- ============ 2. Swept by command, never by name ============
-- Permissive policies OR together, so a surviving blanket policy silently
-- defeats a new scoped one and every isolation check still passes. Phase 13
-- learned this the hard way: the policy was called "Flags readable", which no
-- reasonable guess would have produced.
DO $$
DECLARE _p RECORD;
BEGIN
  FOR _p IN
    SELECT c.relname AS tbl, p.polname AS pol
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relname IN ('project_budget_items','project_jobs','project_job_stages',
                         'opportunity_milestones','vendors')
       AND p.polcmd = 'r'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', _p.pol, _p.tbl);
    RAISE NOTICE 'dropped blanket SELECT policy %.%', _p.tbl, _p.pol;
  END LOOP;
END $$;

-- ============ 3. The delivery board ============
CREATE POLICY "Project jobs readable by the project's people"
  ON public.project_jobs FOR SELECT TO authenticated
  USING (public.can_read_project(project_id, (SELECT auth.uid())));

CREATE POLICY "Project job stages readable by the project's people"
  ON public.project_job_stages FOR SELECT TO authenticated
  USING (public.can_read_project(project_id, (SELECT auth.uid())));

-- ============ 4. Budget lines are money ============
-- The commercial gate, not the project stake: a budget line is cost, and cost
-- has been behind can_read_commercial_cost() since 7A. The pipeline is included
-- because it runs delivery and would otherwise be unable to see the budget of a
-- project it is accountable for.
--
-- Purely role-based, with NO project-stake component. An earlier draft ANDed
-- this with can_read_project() and thereby locked finance out entirely:
-- finance holds no deal on any project, so the stake test is false for them on
-- every row. Cost visibility in this system has always been a property of the
-- role, not of proximity to the record.
CREATE POLICY "Project budget readable by cost holders and the pipeline"
  ON public.project_budget_items FOR SELECT TO authenticated
  USING (public.can_read_commercial_cost((SELECT auth.uid()))
         OR public.is_pipeline_operator((SELECT auth.uid())));

-- ============ 5. Deal milestones ============
CREATE POLICY "Opportunity milestones readable with the deal"
  ON public.opportunity_milestones FOR SELECT TO authenticated
  USING (public.can_read_boq(opportunity_id, (SELECT auth.uid())));

-- ============ 6. The supplier directory ============
-- Open since before Phase 7B, where it was reported and deliberately left for
-- its own decision rather than folded into a feature phase. This is that
-- decision. The directory carries contact names, phone numbers, emails and
-- portal URLs — supplier relationships, not public reference data.
--
-- Kept wide enough to work: estimation raises the RFQs, the pipeline runs
-- procurement, finance pays them. It excludes viewer, system_admin and
-- salespeople, none of whom transact with suppliers.
CREATE POLICY "Vendors readable by those who transact with them"
  ON public.vendors FOR SELECT TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'estimation_manager'::public.app_role)
    OR public.is_pipeline_operator((SELECT auth.uid()))
    OR public.can_read_commercial_cost((SELECT auth.uid()))
  );

-- ============ 7. The part a SELECT-only sweep misses ============
-- Four of these tables also carry a `FOR ALL` policy holding their write
-- rules, and a FOR ALL policy's USING clause governs SELECT as well. Dropping
-- the blanket read therefore changed nothing on its own: the FOR ALL policy
-- kept granting reads to anyone who could write, which for project_jobs meant
-- every sales contributor.
--
-- The write rules are legitimate and are NOT touched. Instead a RESTRICTIVE
-- SELECT policy is added, which ANDs with the permissive union rather than
-- ORing into it — so the read is capped no matter how many permissive policies
-- exist now or are added later. Same predicate as the permissive one above, so
-- the effective rule is exactly what section 3-5 says it is.
CREATE POLICY "Project jobs read is capped to the project's people"
  ON public.project_jobs AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.can_read_project(project_id, (SELECT auth.uid())));

CREATE POLICY "Project job stages read is capped to the project's people"
  ON public.project_job_stages AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.can_read_project(project_id, (SELECT auth.uid())));

CREATE POLICY "Project budget read is capped to cost holders and the pipeline"
  ON public.project_budget_items AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.can_read_commercial_cost((SELECT auth.uid()))
         OR public.is_pipeline_operator((SELECT auth.uid())));

CREATE POLICY "Opportunity milestone read is capped to the deal"
  ON public.opportunity_milestones AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.can_read_boq(opportunity_id, (SELECT auth.uid())));

COMMENT ON TABLE public.vendors IS
  'Supplier directory. Read is limited to the roles that transact with suppliers — estimation, the pipeline, and finance. It was USING (true) from creation until this hotfix; the exposure was reported during Phase 7B and deliberately deferred so it could be decided on its own rather than inside a feature phase.';
