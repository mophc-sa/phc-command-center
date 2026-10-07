-- =============================================================================
-- Stage playbook (phase 2 of the sales-engineer playbook, 2026-10-07).
-- Design: docs/superpowers/specs/2026-10-07-stage-playbook-design.md
--
--   * opportunities.buyer_type — who buys the signage package.
--   * companies.prequalification_* — vendor registration / PQ status lives on
--     the account, so every deal of that client sees it.
--   * opportunity_checklist — the MANUAL "evidence of done" items a rep ticks
--     for the current stage (auto items are computed from data, never stored).
--     Written only through set_checklist_item; read by whoever reads the deal.
--   * approve_ai_daily_task gains a 'checklist' source: one open task per deal
--     listing the stage's missing items, still approved by a person.
-- =============================================================================

-- ============ 1. Buyer type on the deal ============
ALTER TABLE public.opportunities ADD COLUMN IF NOT EXISTS buyer_type TEXT;
ALTER TABLE public.opportunities DROP CONSTRAINT IF EXISTS opportunities_buyer_type_check;
ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_buyer_type_check
  CHECK (buyer_type IS NULL OR buyer_type IN ('main_contractor','developer_owner','consultant','hotel_operator','existing_client'));
COMMENT ON COLUMN public.opportunities.buyer_type IS
  'Who buys the signage package on this deal: main_contractor, developer_owner, consultant, hotel_operator, existing_client. Decides which people the rep must reach (playbook 2026-10-07).';

-- ============ 2. Prequalification on the account ============
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS prequalification_status TEXT NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS prequalification_note TEXT CHECK (length(prequalification_note) <= 1000),
  ADD COLUMN IF NOT EXISTS prequalification_updated_at TIMESTAMPTZ;
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_prequalification_status_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_prequalification_status_check
  CHECK (prequalification_status IN ('not_started','submitted','under_review','approved','needs_completion'));

CREATE OR REPLACE FUNCTION public.stamp_prequalification()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.prequalification_status IS DISTINCT FROM OLD.prequalification_status
     OR NEW.prequalification_note IS DISTINCT FROM OLD.prequalification_note THEN
    NEW.prequalification_updated_at := now();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_companies_prequalification ON public.companies;
CREATE TRIGGER trg_companies_prequalification BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.stamp_prequalification();

-- ============ 3. Manual checklist items ============
CREATE TABLE IF NOT EXISTS public.opportunity_checklist (
  opportunity_id UUID NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  item_key       TEXT NOT NULL CHECK (item_key ~ '^[a-z_]{1,40}$'),
  done           BOOLEAN NOT NULL DEFAULT false,
  note           TEXT CHECK (length(note) <= 500),
  done_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  done_at        TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (opportunity_id, item_key)
);
COMMENT ON TABLE public.opportunity_checklist IS
  'Manual "evidence of done" items per deal (stage-checklist.ts). Auto items are computed from data and never stored here. Written only through set_checklist_item.';

ALTER TABLE public.opportunity_checklist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.opportunity_checklist FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.opportunity_checklist TO authenticated;
GRANT ALL ON public.opportunity_checklist TO service_role;

DROP POLICY IF EXISTS "Checklist readable by the deal's people" ON public.opportunity_checklist;
CREATE POLICY "Checklist readable by the deal's people" ON public.opportunity_checklist
  FOR SELECT TO authenticated USING (public.can_read_boq(opportunity_id, (SELECT auth.uid())));

CREATE OR REPLACE FUNCTION public.set_checklist_item(_opportunity_id uuid, _item_key text, _done boolean, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := (SELECT auth.uid()); row public.opportunity_checklist;
BEGIN
  IF u IS NULL OR NOT public.is_sales_contributor(u) OR NOT public.can_read_boq(_opportunity_id, u) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF _item_key !~ '^[a-z_]{1,40}$' THEN RAISE EXCEPTION 'bad item' USING ERRCODE = '23514'; END IF;
  INSERT INTO public.opportunity_checklist (opportunity_id, item_key, done, note, done_by, done_at, updated_at)
  VALUES (_opportunity_id, _item_key, coalesce(_done, false), nullif(btrim(coalesce(_note, '')), ''),
          CASE WHEN _done THEN u END, CASE WHEN _done THEN now() END, now())
  ON CONFLICT (opportunity_id, item_key) DO UPDATE
    SET done = EXCLUDED.done, note = EXCLUDED.note, done_by = EXCLUDED.done_by, done_at = EXCLUDED.done_at, updated_at = now()
  RETURNING * INTO row;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'opportunity.checklist_set', 'opportunity', _opportunity_id,
          jsonb_build_object('item', _item_key, 'done', row.done));
  RETURN to_jsonb(row);
END $$;
REVOKE ALL ON FUNCTION public.set_checklist_item(uuid, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_checklist_item(uuid, text, boolean, text) TO authenticated;

-- ============ 4. The daily assistant may propose the missing items ============
CREATE OR REPLACE FUNCTION public.approve_ai_daily_task(_source_type text,_source_id uuid,_source_updated_at timestamptz,_title text,_due date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE u uuid:=auth.uid(); linked uuid; version timestamptz; source_key text; t public.tasks; BEGIN
 IF NOT public.has_app_access(u) OR NOT public.is_sales_contributor(u) THEN RAISE EXCEPTION 'Task creation authority required' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(_title,''))) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Task title must be 1–500 characters'; END IF;
 CASE _source_type
 WHEN 'opportunity', 'checklist' THEN
   SELECT id,updated_at INTO linked,version FROM public.opportunities WHERE id=_source_id
     AND stage<>'archived' AND (owner_id=u OR public.is_pipeline_operator(u)) FOR UPDATE;
 WHEN 'follow_up' THEN
   SELECT opportunity_id,updated_at INTO linked,version FROM public.follow_ups WHERE id=_source_id
     AND status NOT IN ('completed','cancelled') AND owner_id=u FOR UPDATE;
 WHEN 'rfq' THEN
   SELECT opportunity_id,updated_at INTO linked,version FROM public.rfqs WHERE id=_source_id
     AND archived_at IS NULL AND status IN ('open','on_hold') AND (sales_owner_id=u OR assigned_to=u OR public.is_pipeline_operator(u)) FOR UPDATE;
 WHEN 'boq' THEN
   SELECT related_opportunity_id,updated_at INTO linked,version FROM public.boqs WHERE id=_source_id
     AND public.can_read_boq(related_opportunity_id,u) FOR UPDATE;
 ELSE RAISE EXCEPTION 'Unsupported task source'; END CASE;
 IF version IS NULL OR (linked IS NOT NULL AND NOT public.can_read_boq(linked,u)) THEN RAISE EXCEPTION 'Task source unavailable' USING ERRCODE='42501'; END IF;
 IF version IS DISTINCT FROM _source_updated_at THEN RAISE EXCEPTION 'Source changed; refresh and review the task'; END IF;
 source_key:='ai_daily:'||_source_type||':'||_source_id;
 SELECT * INTO t FROM public.tasks WHERE owner_id=u AND source=source_key AND status='open';
 IF FOUND THEN RETURN jsonb_build_object('ok',true,'task',to_jsonb(t),'replayed',true); END IF;
 INSERT INTO public.tasks(title,related_opportunity_id,owner_id,created_by,due_date,source)
   VALUES(btrim(_title),linked,u,u,_due,source_key) RETURNING * INTO t;
 INSERT INTO public.audit_log(actor_id,actor_type,action,entity_type,entity_id,after_value)
   VALUES(u,'user','ai_daily.task_approved','task',t.id,jsonb_build_object('source',source_key,'source_updated_at',version));
 RETURN jsonb_build_object('ok',true,'task',to_jsonb(t),'replayed',false);
END $$;
