-- Reconcile the old spreadsheet import with governed historical promotions.
-- Source rows and financial outcomes remain intact; duplicate CRM copies are
-- archived only after proving identity and absence of independent work.

CREATE OR REPLACE FUNCTION public.historical_identity_text(_value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public AS $$
  SELECT lower(btrim(regexp_replace(
    replace(replace(coalesce(_value,''), '_x000D_', chr(13)), chr(150), '–'),
    '[[:space:]]+', ' ', 'g')));
$$;

CREATE OR REPLACE FUNCTION public.historical_opportunity_identity(
  _code text, _client text, _project text, _amount numeric, _currency text
) RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public AS $$
  SELECT jsonb_build_array(public.historical_identity_text(_code),
    public.historical_identity_text(_client),public.historical_identity_text(_project),
    _amount,upper(btrim(coalesce(_currency,'SAR'))));
$$;

CREATE INDEX IF NOT EXISTS opportunity_legacy_identity_lookup
ON public.opportunities(public.historical_opportunity_identity(
  extra_data->>'sales_code',client,project_name,quotation_value,currency))
WHERE extra_data->>'source'='PHC Quotation List 2022-2026' AND stage<>'archived';

CREATE TABLE public.historical_legacy_reconciliations (
  legacy_id uuid PRIMARY KEY REFERENCES public.opportunities(id) ON DELETE RESTRICT,
  canonical_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE RESTRICT,
  row_id uuid NOT NULL REFERENCES public.historical_sales_rows(id) ON DELETE RESTRICT,
  reconciled_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reconciled_at timestamptz NOT NULL DEFAULT now(),
  before_legacy jsonb NOT NULL,
  flags_before jsonb NOT NULL DEFAULT '[]'::jsonb,
  CHECK (legacy_id<>canonical_id)
);
ALTER TABLE public.historical_legacy_reconciliations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.historical_legacy_reconciliations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.historical_legacy_reconciliations TO authenticated,service_role;
CREATE POLICY reconciliation_reads ON public.historical_legacy_reconciliations
FOR SELECT TO authenticated USING(public.has_app_access((SELECT auth.uid()))
  AND public.can_read_historical_sales((SELECT auth.uid())));

-- Internal guard. Catalog enumeration also catches future FK references and
-- polymorphic record links instead of silently forgetting a newly added table.
CREATE OR REPLACE FUNCTION public.historical_legacy_blockers(_legacy_id uuid)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE _legacy public.opportunities; _problems text[]:='{}'; _column record;
  _has_reference boolean; _key text; _snapshot jsonb;
BEGIN
  SELECT * INTO _legacy FROM public.opportunities WHERE id=_legacy_id;
  IF NOT FOUND THEN RETURN ARRAY['record_missing']; END IF;
  IF _legacy.extra_data->>'source' IS DISTINCT FROM 'PHC Quotation List 2022-2026' THEN
    RETURN ARRAY['not_legacy_import'];
  END IF;
  IF _legacy.stage NOT IN ('qualification','quotation')
     OR _legacy.sales_stage IS NULL OR _legacy.sales_stage NOT IN ('rfq_received','jih') THEN
    _problems:=array_append(_problems,'stage_requires_review');
  END IF;
  _snapshot:=to_jsonb(_legacy);
  FOREACH _key IN ARRAY ARRAY[
    'company_id','project_id','main_contractor_id','source_tender_id','person_in_charge_id',
    'human_win_probability','expected_contract_date','next_action','next_action_due',
    'contract_value','contract_received_date','contract_signed_date','contract_reference_number',
    'technical_notes','verbal_award_date','won_at','lost_at','loss_reason','hold_reason',
    'estimated_value_min','estimated_value_max','pipeline_step','scored_at','management_review_reason'
  ] LOOP
    IF nullif(_snapshot->>_key,'') IS NOT NULL THEN
      _problems:=array_append(_problems,'recorded_'||_key);
    END IF;
  END LOOP;
  IF _legacy.evidence_count>0 OR _legacy.score_manual_override THEN
    _problems:=array_append(_problems,'evidence_or_manual_score');
  END IF;
  FOR _column IN
    SELECT DISTINCT c.relname AS table_name,a.attname AS column_name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND c.relname NOT IN ('audit_log','stage_transition_history','notifications',
        'opportunity_flags','historical_legacy_reconciliations')
      AND (a.attname IN ('entity_id','record_id','related_opportunity_id','opportunity_id',
        'linked_record_id','target_id','promoted_opportunity_id','converted_opportunity_id','duplicate_of')
        OR EXISTS(SELECT 1 FROM pg_constraint fk WHERE fk.conrelid=c.oid
          AND fk.confrelid='public.opportunities'::regclass AND fk.contype='f'
          AND a.attnum=ANY(fk.conkey)))
  LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE %I::text=$1)',
      _column.table_name,_column.column_name) INTO _has_reference USING _legacy_id::text;
    IF _has_reference THEN _problems:=array_append(_problems,'referenced_by_'||_column.table_name); END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.opportunity_flags WHERE linked_record_id=_legacy_id
    AND condition_key IS NULL) THEN _problems:=array_append(_problems,'manual_flag'); END IF;
  RETURN _problems;
END;
$$;
REVOKE ALL ON FUNCTION public.historical_legacy_blockers(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.historical_legacy_reconciliation_preview()
RETURNS TABLE(row_id uuid,canonical_id uuid,legacy_id uuid,sales_code text,amount numeric,
  fingerprint text,blockers text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_approve_historical_promotion(auth.uid()) OR NOT public.has_app_access(auth.uid()) THEN
    RAISE EXCEPTION 'Sales leadership and an authorized session are required.' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
    SELECT r.row_id,p.id,l.id,p.extra_data->>'source_sales_code',p.quotation_value,
      md5(to_jsonb(l)::text),public.historical_legacy_blockers(l.id)
    FROM public.historical_promotion_requests r
    JOIN public.opportunities p ON p.id=r.promoted_opportunity_id
    JOIN public.opportunities l ON l.id<>p.id AND l.stage<>'archived'
      AND l.extra_data->>'source'='PHC Quotation List 2022-2026'
      AND public.historical_opportunity_identity(l.extra_data->>'sales_code',l.client,l.project_name,l.quotation_value,l.currency)
        =public.historical_opportunity_identity(p.extra_data->>'source_sales_code',p.client,p.project_name,p.quotation_value,p.currency)
    WHERE r.status='promoted' AND p.stage<>'archived'
      AND p.extra_data->>'source'='historical_promotion'
      AND public.historical_identity_text(p.extra_data->>'source_sales_code')<>''
      AND public.historical_identity_text(p.client)<>''
      AND public.historical_identity_text(p.project_name)<>''
    ORDER BY r.row_id,l.id;
END;
$$;
REVOKE ALL ON FUNCTION public.historical_legacy_reconciliation_preview() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.historical_legacy_reconciliation_preview() TO authenticated;

CREATE OR REPLACE FUNCTION public.reconcile_historical_legacy(
  _row_id uuid,_expected_legacy jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE _uid uuid:=auth.uid(); _request public.historical_promotion_requests;
  _canonical public.opportunities; _legacy public.opportunities; _problems text[];
  _actual jsonb; _flags jsonb; _archived uuid[]:='{}'; _before jsonb;
BEGIN
  IF _uid IS NULL OR NOT public.can_approve_historical_promotion(_uid) OR NOT public.has_app_access(_uid) THEN
    RAISE EXCEPTION 'Sales leadership and an authorized session are required.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO _request FROM public.historical_promotion_requests
    WHERE row_id=_row_id AND status='promoted' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No active historical promotion for this row.' USING ERRCODE='P0002'; END IF;
  SELECT * INTO _canonical FROM public.opportunities WHERE id=_request.promoted_opportunity_id FOR UPDATE;
  IF _canonical.stage='archived' OR _canonical.extra_data->>'source' IS DISTINCT FROM 'historical_promotion'
    OR public.historical_identity_text(_canonical.extra_data->>'source_sales_code')=''
    OR public.historical_identity_text(_canonical.client)=''
    OR public.historical_identity_text(_canonical.project_name)='' THEN
    RAISE EXCEPTION 'Canonical opportunity is not eligible for reconciliation.' USING ERRCODE='23514';
  END IF;

  IF _canonical.extra_data ? 'legacy_import_sources'
    AND jsonb_typeof(_canonical.extra_data->'legacy_import_sources') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Existing legacy context requires review.' USING ERRCODE='23514';
  END IF;

  -- Row locks prevent changes after the preview is compared. The caller pins
  -- both identities and before-images; a change must be reviewed again.
  PERFORM 1 FROM public.opportunities l
    WHERE l.id<>_canonical.id AND l.stage<>'archived'
      AND l.extra_data->>'source'='PHC Quotation List 2022-2026'
      AND public.historical_opportunity_identity(l.extra_data->>'sales_code',l.client,l.project_name,l.quotation_value,l.currency)
        =public.historical_opportunity_identity(_canonical.extra_data->>'source_sales_code',_canonical.client,_canonical.project_name,_canonical.quotation_value,_canonical.currency)
    ORDER BY l.id FOR UPDATE;
  SELECT coalesce(jsonb_object_agg(l.id::text,md5(to_jsonb(l)::text)),'{}'::jsonb) INTO _actual
    FROM public.opportunities l WHERE l.id<>_canonical.id AND l.stage<>'archived'
      AND l.extra_data->>'source'='PHC Quotation List 2022-2026'
      AND public.historical_opportunity_identity(l.extra_data->>'sales_code',l.client,l.project_name,l.quotation_value,l.currency)
        =public.historical_opportunity_identity(_canonical.extra_data->>'source_sales_code',_canonical.client,_canonical.project_name,_canonical.quotation_value,_canonical.currency);
  IF _actual='{}'::jsonb AND EXISTS(SELECT 1 FROM public.historical_legacy_reconciliations WHERE row_id=_row_id) THEN
    RETURN jsonb_build_object('rowId',_row_id,'canonicalId',_canonical.id,'archivedIds','[]'::jsonb,'idempotent',true);
  END IF;
  IF _expected_legacy IS NOT NULL AND _expected_legacy IS DISTINCT FROM _actual THEN
    RAISE EXCEPTION 'Legacy records changed since review; refresh the preview.' USING ERRCODE='40001';
  END IF;
  FOR _legacy IN SELECT l.* FROM public.opportunities l WHERE _actual ? l.id::text ORDER BY l.id LOOP
    _problems:=public.historical_legacy_blockers(_legacy.id);
    IF cardinality(_problems)>0 THEN
      RAISE EXCEPTION 'Legacy opportunity % requires review: %',_legacy.id,array_to_string(_problems,', ') USING ERRCODE='23514';
    END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.id),'[]'::jsonb) INTO _flags
      FROM public.opportunity_flags f WHERE f.linked_record_id=_legacy.id;
    _before:=to_jsonb(_legacy);
    INSERT INTO public.historical_legacy_reconciliations(legacy_id,canonical_id,row_id,reconciled_by,before_legacy,flags_before)
      VALUES(_legacy.id,_canonical.id,_row_id,_uid,_before,_flags);
    UPDATE public.opportunities SET extra_data=coalesce(extra_data,'{}'::jsonb)||jsonb_build_object(
      'legacy_import_sources',coalesce(extra_data->'legacy_import_sources','{}'::jsonb)
        ||jsonb_build_object(_legacy.id::text,coalesce(_legacy.extra_data,'{}'::jsonb)))
      WHERE id=_canonical.id;
    UPDATE public.opportunities SET stage='archived',action_required=false,
      extra_data=coalesce(extra_data,'{}'::jsonb)||jsonb_build_object('canonical_opportunity_id',_canonical.id,
        'reconciled_historical_row_id',_row_id,'reconciled_at',now())
      WHERE id=_legacy.id;
    UPDATE public.opportunity_flags SET status='dismissed',completed_at=now(),completed_by=_uid
      WHERE linked_record_id=_legacy.id AND condition_key IS NOT NULL
        AND status IN ('open','in_progress','escalated','blocked');
    INSERT INTO public.audit_log(actor_id,action,entity_type,entity_id,before_value,after_value)
      VALUES(_uid,'historical_legacy.reconciled','opportunity',_legacy.id,_before,
        jsonb_build_object('canonical_id',_canonical.id,'historical_row_id',_row_id,'stage','archived'));
    INSERT INTO public.stage_transition_history(record_type,record_id,from_stage,to_stage,actor_id,notes)
      VALUES('opportunity',_legacy.id,_legacy.stage::text,'archived',_uid,
        format('Duplicate legacy import reconciled with opportunity %s; complete before-image retained.',_canonical.id));
    _archived:=array_append(_archived,_legacy.id);
  END LOOP;
  RETURN jsonb_build_object('rowId',_row_id,'canonicalId',_canonical.id,'archivedIds',to_jsonb(_archived),'idempotent',false);
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_historical_legacy(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reconcile_historical_legacy(uuid,jsonb) TO authenticated;

-- Future promotions reconcile legacy copies in the same transaction. An
-- unsafe match aborts the promotion instead of leaving two active deals.
CREATE OR REPLACE FUNCTION public.reconcile_legacy_after_promotion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.reconcile_historical_legacy(NEW.row_id,NULL);
  RETURN NEW;
END;
$$;
CREATE TRIGGER historical_promotion_reconcile_legacy
AFTER UPDATE OF status ON public.historical_promotion_requests
FOR EACH ROW WHEN (NEW.status='promoted' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.reconcile_legacy_after_promotion();

-- Existing CRM links are distinct from governed historical quotation promotion.
CREATE INDEX IF NOT EXISTS opportunity_source_identity_lookup
ON public.opportunities(public.historical_opportunity_identity(
  coalesce(extra_data->>'source_sales_code',extra_data->>'sales_code'),client,project_name,quotation_value,currency))
WHERE extra_data->>'source' IN ('PHC Quotation List 2022-2026','historical_promotion') AND stage<>'archived';

CREATE OR REPLACE VIEW public.historical_sales_search AS
  SELECT
    m.row_id,
    m.batch_id,
    m.sales_code_raw          AS sales_code,
    m.base_code,
    m.revision_no,
    m.variant,
    m.owner_prefix,
    m.owner_user_id,
    m.owner_label             AS owner,
    m.client_name_raw         AS client,
    m.company_id,
    m.company_matched,
    m.project_name_raw        AS project,
    m.project_location        AS location,
    m.route,
    m.status_raw              AS status,
    m.status_canonical,
    m.follow_up_raw           AS follow_up,
    m.amount_excl_vat         AS amount,
    m.currency,
    m.date_received,
    m.date_submitted,
    m.contact_name,
    public.historical_raw_get(r.raw, '^EMAIL SUBJECT$') AS email_subject,
    public.historical_raw_get(r.raw, '^UPDATE LOG$')    AS update_log,
    r.row_number,
    COALESCE(req.status::TEXT, 'not_promoted')          AS promotion_status,
    req.promoted_opportunity_id,
    req.promoted_quotation_id,
    public.historical_collision_class(m.row_id)         AS collision_class,
    lower(concat_ws(' ',
      m.sales_code_raw, m.base_code, m.client_name_raw, m.project_name_raw,
      m.project_location, m.owner_label, m.status_raw, m.contact_name,
      public.historical_raw_get(r.raw, '^DESIGNATION$')
    ))                        AS search_text,
    -- APPENDED, and that is not a style choice. CREATE OR REPLACE VIEW may only
    -- add columns at the END. The migration that introduced follow_up hit the
    -- same rule and dropped the view to place it mid-row; these two are
    -- metadata nobody scans a row for, so appending is both correct and avoids
    -- a window where the view does not exist.
    public.historical_raw_get(r.raw, '^DESIGNATION$')   AS contact_designation,
    public.historical_raw_get(r.raw, '^LAST UPDATE$')   AS last_update_note,
    coalesce(live.ids,'{}'::uuid[]) AS existing_opportunity_ids
  FROM public.historical_sales_mapped m
  JOIN public.historical_sales_rows   r ON r.id = m.row_id
  LEFT JOIN LATERAL (
    SELECT p.* FROM public.historical_promotion_requests p
     WHERE p.row_id = m.row_id
     ORDER BY (p.status = 'promoted') DESC, p.created_at DESC
     LIMIT 1
  ) req ON TRUE
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT p.id ORDER BY p.id) AS ids
    FROM public.opportunities p
    WHERE p.stage<>'archived'
      AND p.extra_data->>'source' IN ('PHC Quotation List 2022-2026','historical_promotion')
      AND public.historical_identity_text(m.sales_code_raw)<>''
      AND public.historical_identity_text(m.client_name_raw)<>''
      AND public.historical_identity_text(m.project_name_raw)<>''
      AND public.historical_opportunity_identity(
        coalesce(p.extra_data->>'source_sales_code',p.extra_data->>'sales_code'),p.client,p.project_name,p.quotation_value,p.currency)
        =public.historical_opportunity_identity(m.sales_code_raw,m.client_name_raw,m.project_name_raw,m.amount_excl_vat,m.currency)
  ) live ON TRUE
 WHERE public.can_read_historical_sales((SELECT auth.uid()));


GRANT SELECT ON public.historical_sales_search TO authenticated;
