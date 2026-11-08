-- =============================================================================
-- Pricing loop PR 3, part 2: a pricer sends the frozen file to one supplier.
--
-- An invitation is one request to one vendor for one frozen BOQ revision: the
-- lines it covers, the exact file versions sent, and a reply-by date. Sending
-- moves the file boq_frozen -> at_supplier. The supplier reads it through the
-- portal functions (next migration); staff read these tables (pricers and cost
-- readers: which supplier a file went to is supplier information).
--
-- One supplier per file in this release (spec decision 7). A Phase 7B quote
-- another supplier entered before the freeze, or a 7B selection, would make
-- the file unbuildable (multi_quote_lines; build refuses a selection, AI_HANDOFF
-- PR 3 contract). Sending therefore names the file's supplier: with the
-- pricer's confirmation it cancels the other suppliers' live quotes on this
-- revision and clears selections, through PR 2's entry flag (the file is
-- at_supplier by then, which the flag requires).
--
-- An open request stays 'sent'/'opened' if its file later moves past at_supplier
-- or closes: the portal functions (Task 3) filter on the file's state, and
-- cancel/extend refuse a file that is no longer at the supplier.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.supplier_invitations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id         uuid NOT NULL REFERENCES public.pricing_files(id) ON DELETE RESTRICT,
  boq_revision_id uuid NOT NULL REFERENCES public.boq_revisions(id) ON DELETE RESTRICT,
  vendor_id       uuid NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  -- What the supplier sees as the project's name. Never the client, deal or site.
  project_code    text NOT NULL,
  status          text NOT NULL DEFAULT 'sent'
                  CHECK (status IN ('sent','opened','submitted','reopened','cancelled')),
  reply_by        date NOT NULL,
  -- Shown to the supplier: what PHC asks for (no client names).
  instructions    text CHECK (instructions IS NULL OR char_length(instructions) <= 1000),
  -- Shown to the supplier when lines come back (next migrations).
  return_message  text CHECK (return_message IS NULL OR char_length(return_message) <= 1000),
  sent_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  opened_at       timestamptz,
  submitted_at    timestamptz,
  cancelled_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at    timestamptz,
  cancel_reason   text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT si_cancelled_has_reason CHECK (status <> 'cancelled'
                                            OR (cancelled_at IS NOT NULL AND btrim(coalesce(cancel_reason, '')) <> ''))
);
-- One open request per file.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invitations_one_open
  ON public.supplier_invitations (file_id) WHERE status IN ('sent','opened','reopened');
CREATE INDEX IF NOT EXISTS supplier_invitations_vendor ON public.supplier_invitations (vendor_id, status);
CREATE INDEX IF NOT EXISTS supplier_invitations_file ON public.supplier_invitations (file_id, sent_at);

-- The lines a request covers. The revision is frozen, so boq_lines cannot
-- change under it (Phase 7A); state says which lines the supplier may price.
CREATE TABLE IF NOT EXISTS public.supplier_invitation_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES public.supplier_invitations(id) ON DELETE RESTRICT,
  boq_line_id   uuid NOT NULL REFERENCES public.boq_lines(id) ON DELETE RESTRICT,
  state         text NOT NULL DEFAULT 'open' CHECK (state IN ('open','submitted','reopened')),
  CONSTRAINT sil_one_per_line UNIQUE (invitation_id, boq_line_id)
);

-- The exact file versions sent: the document, its storage object's version
-- and time, and a neutral name (<project code>-NN.ext) so no client name in a
-- file name reaches the supplier.
CREATE TABLE IF NOT EXISTS public.supplier_invitation_files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id     uuid NOT NULL REFERENCES public.supplier_invitations(id) ON DELETE RESTRICT,
  document_id       uuid NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  display_name      text NOT NULL,
  storage_bucket    text NOT NULL,
  storage_path      text NOT NULL,
  mime_type         text,
  size_bytes        bigint,
  checksum          text,
  object_version    text,
  object_updated_at timestamptz,
  CONSTRAINT sif_one_per_document UNIQUE (invitation_id, document_id)
);

ALTER TABLE public.supplier_invitations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_invitation_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_invitation_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_invitations, public.supplier_invitation_lines, public.supplier_invitation_files FROM anon, authenticated;
GRANT SELECT ON public.supplier_invitations, public.supplier_invitation_lines, public.supplier_invitation_files TO authenticated;
GRANT ALL ON public.supplier_invitations, public.supplier_invitation_lines, public.supplier_invitation_files TO service_role;

CREATE POLICY "Supplier invitations readable by pricers and cost readers" ON public.supplier_invitations
  FOR SELECT TO authenticated USING (public.is_pricer(auth.uid()) OR public.can_read_commercial_cost(auth.uid()));
CREATE POLICY "Supplier invitation lines readable by pricers and cost readers" ON public.supplier_invitation_lines
  FOR SELECT TO authenticated USING (public.is_pricer(auth.uid()) OR public.can_read_commercial_cost(auth.uid()));
CREATE POLICY "Supplier invitation files readable by pricers and cost readers" ON public.supplier_invitation_files
  FOR SELECT TO authenticated USING (public.is_pricer(auth.uid()) OR public.can_read_commercial_cost(auth.uid()));
CREATE POLICY audit_session_boundary ON public.supplier_invitations AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));
CREATE POLICY audit_session_boundary ON public.supplier_invitation_lines AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));
CREATE POLICY audit_session_boundary ON public.supplier_invitation_files AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));

-- Riyadh's date: reply-by dates are business days in Saudi Arabia, not UTC.
-- Internal helper: the SECURITY DEFINER functions below call it as the owner.
CREATE OR REPLACE FUNCTION public._pricing_today()
RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Riyadh')::date; $$;
REVOKE ALL ON FUNCTION public._pricing_today() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pricing_send_to_supplier(_file_id uuid, _vendor_id uuid, _reply_by date,
  _document_ids uuid[], _instructions text DEFAULT NULL, _replace_earlier boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); f public.pricing_files; inv public.supplier_invitations; code text;
        today date := public._pricing_today(); others integer; selected integer; n_lines integer;
        d record; ext text; ins text := nullif(btrim(coalesce(_instructions, '')), '');
        cancelled_ids uuid[] := '{}'; cleared_ids uuid[] := '{}'; est_ids uuid[];
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance send a file to the supplier. | إرسال الملف للمورد للتقدير أو المالية.' USING ERRCODE = '42501';
  END IF;
  IF _file_id IS NULL OR _vendor_id IS NULL OR _reply_by IS NULL THEN
    RAISE EXCEPTION 'Choose the supplier and the reply-by date. | اختر المورد وموعد الرد.' USING ERRCODE = '23514';
  END IF;
  IF _reply_by < today OR _reply_by > today + 180 THEN
    RAISE EXCEPTION 'The reply-by date is from today and within 180 days. | موعد الرد من اليوم وخلال 180 يوماً.' USING ERRCODE = '23514';
  END IF;
  IF _document_ids IS NULL OR cardinality(_document_ids) = 0 OR cardinality(_document_ids) > 50
     OR (SELECT count(DISTINCT x) FROM unnest(_document_ids) x) <> cardinality(_document_ids) THEN
    RAISE EXCEPTION 'Choose the files to send (1 to 50, each once). | اختر الملفات المرسلة (من 1 إلى 50، كل ملف مرة).' USING ERRCODE = '23514';
  END IF;
  IF char_length(coalesce(ins, '')) > 1000 THEN
    RAISE EXCEPTION 'The note to the supplier is up to 1000 characters. | الملاحظة للمورد حتى 1000 حرف.' USING ERRCODE = '23514';
  END IF;

  -- Lock order: estimation -> price -> file (PR 1). This RPC holds only the file
  -- lock: it writes neither an estimation nor an internal price. (A file at
  -- at_supplier may carry a price the supplier returned; it is not touched here.)
  SELECT * INTO f FROM public.pricing_files WHERE id = _file_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown pricing file. | ملف التسعير غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF f.state NOT IN ('boq_frozen','at_supplier') THEN
    RAISE EXCEPTION 'A file goes to the supplier once its BOQ is frozen. | يُرسل الملف للمورد بعد تجميد الكميات.' USING ERRCODE = 'P0001';
  END IF;
  IF f.boq_revision_id IS NULL OR NOT public.boq_revision_is_frozen(f.boq_revision_id) THEN
    RAISE EXCEPTION 'The file has no frozen BOQ revision. | لا توجد مراجعة كميات مجمّدة للملف.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.supplier_invitations i
              WHERE i.file_id = f.id AND i.status IN ('sent','opened','reopened')) THEN
    RAISE EXCEPTION 'This file already has an open supplier request; cancel it first. | لهذا الملف طلب مفتوح لدى مورد؛ ألغه أولاً.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vendors v WHERE v.id = _vendor_id) THEN
    RAISE EXCEPTION 'Unknown supplier. | المورد غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.boq_lines l WHERE l.revision_id = f.boq_revision_id) THEN
    RAISE EXCEPTION 'The BOQ has no lines to price. | لا بنود في الكميات للتسعير.' USING ERRCODE = 'P0001';
  END IF;
  -- Each file: a live document attached to this deal or its RFQ, its bytes in storage.
  IF EXISTS (SELECT 1 FROM unnest(_document_ids) x
              WHERE NOT EXISTS (
                SELECT 1 FROM public.documents dd
                  JOIN public.document_links l ON l.document_id = dd.id AND l.unlinked_at IS NULL
                 WHERE dd.id = x AND dd.deleted_at IS NULL
                   AND ((l.entity_type = 'opportunity' AND l.entity_id = f.opportunity_id)
                     OR (l.entity_type = 'rfq' AND f.rfq_id IS NOT NULL AND l.entity_id = f.rfq_id)))) THEN
    RAISE EXCEPTION 'A file is not attached to this deal. | أحد الملفات ليس مرفقاً بهذه الفرصة.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(_document_ids) x JOIN public.documents dd ON dd.id = x
              WHERE NOT EXISTS (SELECT 1 FROM storage.objects o
                                 WHERE o.bucket_id = dd.storage_bucket AND o.name = dd.storage_path)) THEN
    RAISE EXCEPTION 'A file is missing from storage; upload it again. | أحد الملفات غير موجود في التخزين؛ ارفعه مجدداً.' USING ERRCODE = '23514';
  END IF;
  SELECT o.project_code INTO code FROM public.opportunities o WHERE o.id = f.opportunity_id;
  IF code IS NULL THEN
    RAISE EXCEPTION 'The deal has no project code; the supplier sees the project code only. | لا رمز مشروع للفرصة؛ المورد يرى رمز المشروع فقط.' USING ERRCODE = 'P0001';
  END IF;

  -- Earlier supplier prices on this revision (Phase 7B, before the freeze).
  SELECT count(*) INTO others FROM public.supplier_quotes q
   WHERE q.boq_revision_id = f.boq_revision_id AND q.vendor_id <> _vendor_id
     AND q.is_current AND q.status NOT IN ('cancelled','superseded');
  SELECT count(*) INTO selected FROM public.supplier_quote_lines l
    JOIN public.supplier_quotes q ON q.id = l.supplier_quote_id
   WHERE q.boq_revision_id = f.boq_revision_id AND l.is_selected;
  -- Clearing a selection changes what estimation_cost_basis sums for EVERY
  -- estimation on this revision (it adds up the selected lines). The file's own
  -- estimation is the one this file is priced from; any other would silently
  -- change its cost, so the send is refused, confirmation or not.
  IF selected > 0 THEN
    SELECT array_agg(e.id ORDER BY e.created_at, e.id) INTO est_ids FROM public.estimations e
     WHERE e.boq_revision_id = f.boq_revision_id AND e.id IS DISTINCT FROM f.estimation_id;
    IF est_ids IS NOT NULL THEN
      RAISE EXCEPTION 'Another estimation on this BOQ uses the selected supplier prices; clearing them would change its cost. Finish or cancel that estimation first. | تقدير آخر على هذه الكميات يستخدم أسعار المورد المختارة؛ إلغاؤها يغيّر تكلفته. أنهِ ذلك التقدير أو ألغه أولاً.'
        USING ERRCODE = 'P0001', DETAIL = 'estimations: ' || array_to_string(est_ids, ',');
    END IF;
  END IF;
  IF (others > 0 OR selected > 0) AND NOT coalesce(_replace_earlier, false) THEN
    RAISE EXCEPTION 'This BOQ already has supplier prices on this revision (another supplier''s quote, or a selection by anyone). Confirm to cancel them for this file. | لهذه الكميات أسعار مورد على هذه المراجعة (عرض مورد آخر، أو اختيار من أي مستخدم). أكّد لإلغائها لهذا الملف.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Move first: PR 2's entry exception below needs the file at the supplier.
  IF f.state = 'boq_frozen' THEN
    f := public._pricing_file_apply(f, 'at_supplier', u, NULL);
  END IF;
  IF others > 0 OR selected > 0 THEN
    PERFORM set_config('phc.pricing_supplier_entry', f.boq_revision_id::text, true);
    WITH c AS (
      UPDATE public.supplier_quote_lines l SET is_selected = false, selected_by = NULL, selected_at = NULL
        FROM public.supplier_quotes q
       WHERE q.id = l.supplier_quote_id AND q.boq_revision_id = f.boq_revision_id AND l.is_selected
      RETURNING l.id)
    SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO cleared_ids FROM c;
    WITH c AS (
      UPDATE public.supplier_quotes q
         SET status = 'cancelled', cancel_reason = 'Another supplier was chosen for this pricing file'
       WHERE q.boq_revision_id = f.boq_revision_id AND q.vendor_id <> _vendor_id
         AND q.is_current AND q.status NOT IN ('cancelled','superseded')
      RETURNING q.id)
    SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO cancelled_ids FROM c;
    PERFORM set_config('phc.pricing_supplier_entry', '', true);
  END IF;

  INSERT INTO public.supplier_invitations (file_id, boq_revision_id, vendor_id, project_code, reply_by, instructions, sent_by)
  VALUES (f.id, f.boq_revision_id, _vendor_id, code, _reply_by, ins, u)
  RETURNING * INTO inv;
  INSERT INTO public.supplier_invitation_lines (invitation_id, boq_line_id)
  SELECT inv.id, l.id FROM public.boq_lines l WHERE l.revision_id = f.boq_revision_id;
  GET DIAGNOSTICS n_lines = ROW_COUNT;
  FOR d IN
    SELECT dd.id, dd.original_filename, dd.storage_bucket, dd.storage_path, dd.mime_type, dd.size_bytes,
           o.version AS object_version, o.updated_at AS object_updated_at, x.ord,
           -- The hash of the bytes actually sent: the storage object's own ETag,
           -- never the documents row (which may describe other bytes). NULL when
           -- storage reports none. Task 3's re-check compares version + updated_at
           -- as sent (NULL stays NULL and matches NULL; never now(), which nothing could match).
           nullif(btrim(o.metadata->>'eTag', '"'), '') AS object_checksum
      FROM unnest(_document_ids) WITH ORDINALITY AS x(id, ord)
      JOIN public.documents dd ON dd.id = x.id
      JOIN storage.objects o ON o.bucket_id = dd.storage_bucket AND o.name = dd.storage_path
     ORDER BY x.ord
  LOOP
    ext := lower(substring(d.original_filename from '\.([A-Za-z0-9]{1,8})$'));
    INSERT INTO public.supplier_invitation_files (invitation_id, document_id, display_name, storage_bucket, storage_path,
                                                  mime_type, size_bytes, checksum, object_version, object_updated_at)
    VALUES (inv.id, d.id, code || '-' || lpad(d.ord::text, 2, '0') || coalesce('.' || ext, ''),
            d.storage_bucket, d.storage_path, d.mime_type, d.size_bytes, d.object_checksum, d.object_version,
            d.object_updated_at);
  END LOOP;

  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.sent_to_supplier', 'opportunity', f.opportunity_id,
          jsonb_build_object('file_id', f.id, 'invitation_id', inv.id, 'vendor_id', _vendor_id, 'reply_by', _reply_by,
                             'lines', n_lines, 'files', cardinality(_document_ids),
                             'cancelled_quotes', cardinality(cancelled_ids), 'cleared_selections', cardinality(cleared_ids),
                             'cancelled_quote_ids', to_jsonb(cancelled_ids), 'cleared_line_ids', to_jsonb(cleared_ids)));
  RETURN jsonb_build_object('invitation_id', inv.id, 'lines', n_lines, 'files', cardinality(_document_ids));
END $$;
REVOKE ALL ON FUNCTION public.pricing_send_to_supplier(uuid, uuid, date, uuid[], text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_send_to_supplier(uuid, uuid, date, uuid[], text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.pricing_cancel_invitation(_invitation_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); inv public.supplier_invitations; fid uuid; opp uuid; fstate public.pricing_file_state; r text := btrim(coalesce(_reason, ''));
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance cancel a supplier request. | إلغاء طلب المورد للتقدير أو المالية.' USING ERRCODE = '42501';
  END IF;
  IF char_length(r) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Give a reason (up to 500 characters). | اذكر السبب (حتى 500 حرف).' USING ERRCODE = '23514';
  END IF;
  SELECT i.file_id INTO fid FROM public.supplier_invitations i WHERE i.id = _invitation_id;
  IF fid IS NULL THEN
    RAISE EXCEPTION 'Unknown supplier request. | طلب المورد غير موجود.' USING ERRCODE = '23514';
  END IF;
  -- Lock order: the file, then its request.
  SELECT f.opportunity_id, f.state INTO opp, fstate FROM public.pricing_files f WHERE f.id = fid FOR UPDATE;
  SELECT * INTO inv FROM public.supplier_invitations WHERE id = _invitation_id FOR UPDATE;
  IF fstate <> 'at_supplier' THEN
    RAISE EXCEPTION 'The file is no longer at the supplier. | الملف لم يعد عند المورد.' USING ERRCODE = 'P0001';
  END IF;
  IF inv.status NOT IN ('sent','opened','reopened') THEN
    RAISE EXCEPTION 'Only an open request can be cancelled. | يُلغى الطلب المفتوح فقط.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.supplier_invitations
     SET status = 'cancelled', cancelled_by = u, cancelled_at = now(), cancel_reason = r, updated_at = now()
   WHERE id = inv.id RETURNING * INTO inv;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.supplier_request_cancelled', 'opportunity', opp,
          jsonb_build_object('file_id', fid, 'invitation_id', inv.id));
  RETURN jsonb_build_object('invitation_id', inv.id, 'status', inv.status);
END $$;
REVOKE ALL ON FUNCTION public.pricing_cancel_invitation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_cancel_invitation(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.pricing_extend_invitation(_invitation_id uuid, _reply_by date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); inv public.supplier_invitations; fid uuid; opp uuid; fstate public.pricing_file_state; today date := public._pricing_today();
BEGIN
  IF NOT public.is_pricer(u) THEN
    RAISE EXCEPTION 'Only estimation or finance change the reply-by date. | تغيير موعد الرد للتقدير أو المالية.' USING ERRCODE = '42501';
  END IF;
  IF _reply_by IS NULL OR _reply_by < today OR _reply_by > today + 180 THEN
    RAISE EXCEPTION 'The reply-by date is from today and within 180 days. | موعد الرد من اليوم وخلال 180 يوماً.' USING ERRCODE = '23514';
  END IF;
  SELECT i.file_id INTO fid FROM public.supplier_invitations i WHERE i.id = _invitation_id;
  IF fid IS NULL THEN
    RAISE EXCEPTION 'Unknown supplier request. | طلب المورد غير موجود.' USING ERRCODE = '23514';
  END IF;
  SELECT f.opportunity_id, f.state INTO opp, fstate FROM public.pricing_files f WHERE f.id = fid FOR UPDATE;
  SELECT * INTO inv FROM public.supplier_invitations WHERE id = _invitation_id FOR UPDATE;
  IF fstate <> 'at_supplier' THEN
    RAISE EXCEPTION 'The file is no longer at the supplier. | الملف لم يعد عند المورد.' USING ERRCODE = 'P0001';
  END IF;
  IF inv.status NOT IN ('sent','opened','reopened') THEN
    RAISE EXCEPTION 'Only an open request has a reply-by date to change. | يتغير موعد الرد للطلب المفتوح فقط.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.supplier_invitations SET reply_by = _reply_by, updated_at = now() WHERE id = inv.id RETURNING * INTO inv;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (u, 'user', 'pricing_file.supplier_reply_by_changed', 'opportunity', opp,
          jsonb_build_object('file_id', fid, 'invitation_id', inv.id, 'reply_by', _reply_by));
  RETURN jsonb_build_object('invitation_id', inv.id, 'reply_by', inv.reply_by);
END $$;
REVOKE ALL ON FUNCTION public.pricing_extend_invitation(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_extend_invitation(uuid, date) TO authenticated;
