-- =============================================================================
-- Where a deal's or a company's facts came from, whether anyone has checked
-- them, and who changed which field.
--
-- 1. opportunities and companies gain the same verification vocabulary
--    contacts already have: source, source_date, last_verified_at,
--    verification_status (the existing verification_status enum) and
--    verified_by. companies.source already exists and is kept as it is.
--    Every existing row starts 'pending_verification' — nothing has been
--    verified under this column yet, and saying otherwise would be invented.
-- 2. audit_row_changes(): one generic AFTER UPDATE trigger on opportunities,
--    companies and contacts. It writes ONE audit_log row per update holding
--    only the columns that changed (before_value / after_value), skipping
--    bookkeeping columns that change on their own (updated_at, activity and
--    scoring stamps, extra_data). actor_type is
--      'data_sync' while the master-list sync is applying or undoing
--                  (phc.data_sync = 'on', set by data_sync_apply/undo),
--      'system'    when there is no signed-in user (cron, service role),
--      'user'      otherwise, with actor_id = auth.uid().
--    data_sync_apply (20261116150300) reads these rows to avoid overwriting a
--    value a person changed after the master list was last updated.
-- =============================================================================

-- 1. Verification columns.
ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS source              text,
  ADD COLUMN IF NOT EXISTS source_date         date,
  ADD COLUMN IF NOT EXISTS last_verified_at    timestamptz,
  ADD COLUMN IF NOT EXISTS verification_status public.verification_status NOT NULL DEFAULT 'pending_verification',
  ADD COLUMN IF NOT EXISTS verified_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS source              text,
  ADD COLUMN IF NOT EXISTS source_date         date,
  ADD COLUMN IF NOT EXISTS last_verified_at    timestamptz,
  ADD COLUMN IF NOT EXISTS verification_status public.verification_status NOT NULL DEFAULT 'pending_verification',
  ADD COLUMN IF NOT EXISTS verified_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Field-level audit.
CREATE OR REPLACE FUNCTION public.audit_row_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _old jsonb := to_jsonb(OLD);
  _new jsonb := to_jsonb(NEW);
  _before jsonb := '{}'::jsonb;
  _after  jsonb := '{}'::jsonb;
  _k text;
  _uid uuid := auth.uid();
BEGIN
  FOR _k IN SELECT jsonb_object_keys(_new) LOOP
    CONTINUE WHEN _k = ANY (ARRAY['updated_at', 'last_activity_at', 'last_contact_at', 'extra_data',
      'score', 'score_tier', 'score_confidence', 'score_missing_data', 'score_reasons', 'score_risk_flags',
      'score_recommended_action', 'scored_at', 'scored_by', 'evidence_count', 'completion_pct']);
    IF _old->_k IS DISTINCT FROM _new->_k THEN
      _before := _before || jsonb_build_object(_k, _old->_k);
      _after  := _after  || jsonb_build_object(_k, _new->_k);
    END IF;
  END LOOP;
  IF _after = '{}'::jsonb THEN RETURN NULL; END IF;

  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, before_value, after_value)
  VALUES (_uid,
          CASE WHEN coalesce(current_setting('phc.data_sync', true), '') = 'on' THEN 'data_sync'
               WHEN _uid IS NULL THEN 'system' ELSE 'user' END,
          TG_ARGV[0] || '.fields_changed', TG_ARGV[0], NEW.id, _before, _after);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.audit_row_changes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit_opportunity_changes ON public.opportunities;
CREATE TRIGGER trg_audit_opportunity_changes AFTER UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_changes('opportunity');
DROP TRIGGER IF EXISTS trg_audit_company_changes ON public.companies;
CREATE TRIGGER trg_audit_company_changes AFTER UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_changes('company');
DROP TRIGGER IF EXISTS trg_audit_contact_changes ON public.contacts;
CREATE TRIGGER trg_audit_contact_changes AFTER UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_changes('contact');

