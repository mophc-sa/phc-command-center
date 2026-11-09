-- =============================================================================
-- Pricing loop PR 3, part 3: what a supplier reads in the portal.
--
-- A supplier has no table access (has_app_access is false for it). It reads
-- through these SECURITY DEFINER functions only, each of which starts from
-- _supplier_session_vendor() (active supplier, linked vendor, MFA). What they
-- return is the spec's list: project code, reply-by, lines (quantity, size,
-- specs), the files sent, and the supplier's OWN prices. Never the client, the
-- deal, the site (boq_lines.location), PHC's cost or selling price, another
-- supplier, or an internal id other than the request's own.
-- =============================================================================

-- The vendor of an active supplier account, without the session's MFA level:
-- only for the service-role path below, where sales-os-api has already
-- required aal2 of this user (resolveCaller) and called supplier_portal_file as
-- them. Same conditions as _supplier_session_vendor() otherwise.
CREATE OR REPLACE FUNCTION public._supplier_account_vendor(_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.vendor_id FROM public.profiles p
   WHERE p.id = _user_id AND p.status = 'active' AND p.vendor_id IS NOT NULL
     AND public.is_supplier_account(p.id);
$$;
REVOKE ALL ON FUNCTION public._supplier_account_vendor(uuid) FROM PUBLIC, anon, authenticated;

-- The vendor's request, or 42501 with the same message for "not yours" and "unknown".
CREATE OR REPLACE FUNCTION public._supplier_invitation_for_vendor(_invitation_id uuid, _vendor_id uuid)
RETURNS public.supplier_invitations LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.supplier_invitations;
BEGIN
  IF _vendor_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to the supplier portal with two-step verification. | سجّل الدخول لبوابة المورد بالتحقق بخطوتين.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO inv FROM public.supplier_invitations i
   WHERE i.id = _invitation_id AND i.vendor_id = _vendor_id AND i.status <> 'cancelled';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This request is not available. | هذا الطلب غير متاح.' USING ERRCODE = '42501';
  END IF;
  RETURN inv;
END $$;
REVOKE ALL ON FUNCTION public._supplier_invitation_for_vendor(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- The caller's request (active supplier, linked vendor, aal2).
CREATE OR REPLACE FUNCTION public._supplier_invitation_for_session(_invitation_id uuid)
RETURNS public.supplier_invitations LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._supplier_invitation_for_vendor(_invitation_id, public._supplier_session_vendor());
$$;
REVOKE ALL ON FUNCTION public._supplier_invitation_for_session(uuid) FROM PUBLIC, anon, authenticated;

-- The request's file is still at the supplier on the revision that was sent. An
-- open request stays sent/opened after its file moves on or closes (Task 2), so
-- everything the supplier can READ (lines, prices, files, downloads) requires this.
CREATE OR REPLACE FUNCTION public._supplier_invitation_live(_inv public.supplier_invitations)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.pricing_files f
                  WHERE f.id = _inv.file_id AND f.state = 'at_supplier' AND f.boq_revision_id = _inv.boq_revision_id);
$$;
REVOKE ALL ON FUNCTION public._supplier_invitation_live(public.supplier_invitations) FROM PUBLIC, anon, authenticated;

-- A request takes prices while it is open and its file is at the supplier on the same revision.
CREATE OR REPLACE FUNCTION public._supplier_invitation_editable(_inv public.supplier_invitations)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _inv.status IN ('sent','opened','reopened') AND public._supplier_invitation_live(_inv);
$$;
REVOKE ALL ON FUNCTION public._supplier_invitation_editable(public.supplier_invitations) FROM PUBLIC, anon, authenticated;

-- What the supplier sees as the request's status: open, returned (lines came back), submitted, closed.
CREATE OR REPLACE FUNCTION public._supplier_portal_status(_inv public.supplier_invitations)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN _inv.status = 'submitted' THEN 'submitted'
              WHEN public._supplier_invitation_editable(_inv) THEN
                   CASE WHEN _inv.status = 'reopened' THEN 'returned' ELSE 'open' END
              ELSE 'closed' END;
$$;
REVOKE ALL ON FUNCTION public._supplier_portal_status(public.supplier_invitations) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.supplier_portal_invitations()
RETURNS TABLE (invitation_id uuid, project_code text, reply_by date, status text, sent_at timestamptz,
               submitted_at timestamptz, lines integer, open_lines integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE v uuid := public._supplier_session_vendor();
BEGIN
  IF v IS NULL THEN
    RAISE EXCEPTION 'Sign in to the supplier portal with two-step verification. | سجّل الدخول لبوابة المورد بالتحقق بخطوتين.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT i.id, i.project_code, i.reply_by, public._supplier_portal_status(i), i.sent_at, i.submitted_at,
           (SELECT count(*)::int FROM public.supplier_invitation_lines l WHERE l.invitation_id = i.id),
           (SELECT count(*)::int FROM public.supplier_invitation_lines l
             WHERE l.invitation_id = i.id AND l.state IN ('open','reopened')
               AND public._supplier_invitation_editable(i))
      FROM public.supplier_invitations i
     WHERE i.vendor_id = v AND i.status <> 'cancelled'
     ORDER BY (public._supplier_portal_status(i) IN ('open','returned')) DESC, i.reply_by, i.sent_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.supplier_portal_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_portal_invitations() TO authenticated;

-- One request with its lines, files and the supplier's own current prices.
-- The first read of an open request marks it opened (Zayed sees "opened").
CREATE OR REPLACE FUNCTION public.supplier_portal_invitation(_invitation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.supplier_invitations := public._supplier_invitation_for_session(_invitation_id);
        ed boolean; lv boolean; q public.supplier_quotes;
BEGIN
  ed := public._supplier_invitation_editable(inv);
  lv := public._supplier_invitation_live(inv);
  IF inv.status = 'sent' AND ed THEN
    UPDATE public.supplier_invitations SET status = 'opened', opened_at = now(), updated_at = now()
     WHERE id = inv.id RETURNING * INTO inv;
    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, before_value, after_value)
    SELECT auth.uid(), 'user', 'supplier_portal.opened', 'opportunity', f.opportunity_id,
           jsonb_build_object('status', 'sent'),
           jsonb_build_object('invitation_id', inv.id, 'file_id', inv.file_id, 'status', 'opened')
      FROM public.pricing_files f WHERE f.id = inv.file_id;
  END IF;
  -- The supplier's own live quote on this revision (theirs, whoever typed it).
  SELECT * INTO q FROM public.supplier_quotes sq
   WHERE lv AND sq.boq_revision_id = inv.boq_revision_id AND sq.vendor_id = inv.vendor_id
     AND sq.is_current AND sq.status NOT IN ('cancelled','superseded');
  RETURN jsonb_build_object(
    'invitation_id', inv.id,
    'project_code', inv.project_code,
    'reply_by', inv.reply_by,
    'sent_at', inv.sent_at,
    'instructions', inv.instructions,
    'return_message', CASE WHEN inv.status = 'reopened' AND lv THEN inv.return_message END,
    'status', public._supplier_portal_status(inv),
    'editable', ed,
    'terms', jsonb_build_object('lead_time_days', q.lead_time_days, 'payment_terms', q.payment_terms,
                                'valid_until', q.valid_until),
    'lines', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'line_id', il.id, 'line_number', bl.line_number, 'sign_type', bl.sign_type,
               'description', bl.description, 'dimensions', bl.dimensions, 'material', bl.material,
               'mounting', bl.mounting, 'illumination', bl.illumination, 'finish', bl.finish,
               'quantity', bl.quantity, 'unit', bl.unit, 'width_mm', bl.width_mm, 'height_mm', bl.height_mm,
               'has_screen', bl.has_screen, 'state', il.state,
               'editable', ed AND il.state IN ('open','reopened'),
               'unit_cost', ql.unit_cost, 'unit_cost_with_screen', ql.unit_cost_with_screen,
               'spec_difference', ql.alternate_spec)
             ORDER BY bl.line_number NULLS LAST, bl.sort_order NULLS LAST, il.id)
        FROM public.supplier_invitation_lines il
        JOIN public.boq_lines bl ON bl.id = il.boq_line_id
        LEFT JOIN public.supplier_quote_lines ql ON ql.supplier_quote_id = q.id AND ql.boq_line_id = il.boq_line_id
       WHERE lv AND il.invitation_id = inv.id), '[]'::jsonb),
    'files', coalesce((
      SELECT jsonb_agg(jsonb_build_object('file_id', sf.id, 'name', sf.display_name, 'size_bytes', sf.size_bytes,
                                          'mime_type', sf.mime_type) ORDER BY sf.display_name)
        FROM public.supplier_invitation_files sf WHERE lv AND sf.invitation_id = inv.id), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.supplier_portal_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_portal_invitation(uuid) TO authenticated;

-- One sent file of a request, if it may still be downloaded: the request is
-- live (file at the supplier on the revision sent), the document is not deleted,
-- and the storage object is the exact one sent (same version and updated time;
-- NULL on both sides matches). 42501 when not the request's or not live, P0001
-- when the bytes changed or went.
CREATE OR REPLACE FUNCTION public._supplier_portal_file_checked(_inv public.supplier_invitations, _file_id uuid)
RETURNS public.supplier_invitation_files LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE sf public.supplier_invitation_files;
BEGIN
  SELECT * INTO sf FROM public.supplier_invitation_files f WHERE f.id = _file_id AND f.invitation_id = _inv.id;
  IF NOT FOUND OR NOT public._supplier_invitation_live(_inv) THEN
    RAISE EXCEPTION 'This request is not available. | هذا الطلب غير متاح.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.documents d WHERE d.id = sf.document_id AND d.deleted_at IS NULL)
     OR NOT EXISTS (SELECT 1 FROM storage.objects o
                     WHERE o.bucket_id = sf.storage_bucket AND o.name = sf.storage_path
                       AND o.version IS NOT DISTINCT FROM sf.object_version
                       AND o.updated_at IS NOT DISTINCT FROM sf.object_updated_at) THEN
    RAISE EXCEPTION 'This file changed or was removed after it was sent; ask PHC to send the request again. | تغيّر هذا الملف أو حُذف بعد إرساله؛ اطلب من PHC إعادة إرسال الطلب.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN sf;
END $$;
REVOKE ALL ON FUNCTION public._supplier_portal_file_checked(public.supplier_invitations, uuid) FROM PUBLIC, anon, authenticated;

-- The supplier's check before a download (sales-os-api calls it as the
-- supplier). It answers which file under its neutral name, never where the
-- bytes are: no bucket, path, document id or original file name, all of which
-- can carry the deal id or the client's name.
CREATE OR REPLACE FUNCTION public.supplier_portal_file(_invitation_id uuid, _file_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE sf public.supplier_invitation_files :=
  public._supplier_portal_file_checked(public._supplier_invitation_for_session(_invitation_id), _file_id);
BEGIN
  RETURN jsonb_build_object('ok', true, 'file_id', sf.id, 'name', sf.display_name,
                            'mime_type', sf.mime_type, 'size_bytes', sf.size_bytes);
END $$;
REVOKE ALL ON FUNCTION public.supplier_portal_file(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_portal_file(uuid, uuid) TO authenticated;

-- Where the bytes are, for sales-os-api's service client only: it re-runs the
-- same checks for the supplier user sales-os-api authenticated (active supplier,
-- linked vendor; aal2 was required of that session), audits the download, and
-- the bytes are streamed back by the service under the neutral name. Never
-- callable by a signed-in account.
CREATE OR REPLACE FUNCTION public._supplier_portal_file_location(_invitation_id uuid, _file_id uuid, _supplier_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.supplier_invitations :=
          public._supplier_invitation_for_vendor(_invitation_id, public._supplier_account_vendor(_supplier_user));
        sf public.supplier_invitation_files := public._supplier_portal_file_checked(inv, _file_id);
        opp uuid;
        sz bigint;
BEGIN
  SELECT f.opportunity_id INTO opp FROM public.pricing_files f WHERE f.id = inv.file_id;
  -- The size storage holds for the object (what will be read into memory), not the documents row.
  SELECT (o.metadata->>'size')::bigint INTO sz FROM storage.objects o
   WHERE o.bucket_id = sf.storage_bucket AND o.name = sf.storage_path;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (_supplier_user, 'user', 'supplier_portal.file_downloaded', 'opportunity', opp,
          jsonb_build_object('invitation_id', inv.id, 'file_id', sf.id, 'document_id', sf.document_id));
  -- object_version / object_updated_at: what was just checked (equal to the object now);
  -- sales-os-api compares them with _supplier_portal_object_state after reading the bytes.
  RETURN jsonb_build_object('bucket', sf.storage_bucket, 'path', sf.storage_path, 'name', sf.display_name,
                            'mime_type', sf.mime_type, 'size_bytes', sz,
                            'object_version', sf.object_version, 'object_updated_at', sf.object_updated_at);
END $$;
REVOKE ALL ON FUNCTION public._supplier_portal_file_location(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._supplier_portal_file_location(uuid, uuid, uuid) TO service_role;

-- The storage object's version and time now, at the path a request file was sent
-- from (NULL when it is gone). sales-os-api reads it after downloading the bytes:
-- if the object was replaced between the check and the read, the bytes are not
-- served. Service role only; it answers no path and no name.
CREATE OR REPLACE FUNCTION public._supplier_portal_object_state(_file_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('version', o.version, 'updated_at', o.updated_at)
    FROM public.supplier_invitation_files sf
    JOIN storage.objects o ON o.bucket_id = sf.storage_bucket AND o.name = sf.storage_path
   WHERE sf.id = _file_id;
$$;
REVOKE ALL ON FUNCTION public._supplier_portal_object_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._supplier_portal_object_state(uuid) TO service_role;
