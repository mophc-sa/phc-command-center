-- =========================================================
-- PHASE 7C (3/3) — approval integration and document reach.
--
-- REUSES `approvals`, DOES NOT REPLACE IT
-- ---------------------------------------
-- The approvals table already carries linked_record_type / linked_record_id /
-- requested_action / requested_payload and an execution record. Phase 7C adds
-- no approval table of its own; a quotation submission is an approvals row
-- pointing at a quotation_revision.
--
-- WHY PRICES ARE BANNED FROM THE PAYLOAD
-- --------------------------------------
-- `approvals` is readable by EVERY active user:
--
--     "Approvals readable"  SELECT  USING (is_active_user(auth.uid()))
--
-- That is fine for a workflow queue and fatal for money. Phases 7A and 7B went
-- to considerable lengths to keep cost and margin behind
-- can_read_commercial_cost() — column privileges, security-definer views, the
-- lot. A payload of {"proposed_price": 1840000, "margin": 0.22} on an approvals
-- row hands all of it to viewer, to system_admin, to every active account, in
-- one jsonb column that no column privilege covers.
--
-- So the payload carries POINTERS, never figures. The approver opens the
-- revision, where RLS still applies. A trigger enforces this rather than a
-- convention, because a convention is one careless insert away from being
-- untrue and nothing would ever report it.
--
-- The ban is scoped to quotation_revision approvals. Applying it to every
-- approval type would retro-break existing flows that legitimately carry
-- amounts, which is a behaviour change to live data paths and not this phase's
-- call to make.
--
-- THE boq_revision GAP FROM 7A
-- ----------------------------
-- 7A added 'boq_revision' to document_entity_type but never added a branch to
-- document_entity_grants(), so it fell to `ELSE RETURN FALSE`. Documents
-- attached to a BOQ revision are currently readable by nobody — fail-closed,
-- so not an exposure, but the feature does not work. The registry's own
-- comment warned that adding an enum value without a matching branch grants
-- nothing. Closed here alongside the 7C branch, because shipping a second
-- entity type with the same defect would be careless.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. Is there money in this payload? ============
-- Recursive: a price nested three objects deep is still a price. Matches on
-- key NAME rather than value, because a bare number is ambiguous and a key
-- called "unit_price" is not.
CREATE OR REPLACE FUNCTION public.jsonb_has_money_key(_payload JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE _k TEXT; _v JSONB;
BEGIN
  IF _payload IS NULL THEN RETURN FALSE; END IF;

  IF jsonb_typeof(_payload) = 'object' THEN
    FOR _k, _v IN SELECT key, value FROM jsonb_each(_payload) LOOP
      IF _k ~* '(price|amount|total|subtotal|vat|margin|cost|rate|discount|fee|value|sar|usd)' THEN
        RETURN TRUE;
      END IF;
      IF public.jsonb_has_money_key(_v) THEN RETURN TRUE; END IF;
    END LOOP;
  ELSIF jsonb_typeof(_payload) = 'array' THEN
    FOR _v IN SELECT value FROM jsonb_array_elements(_payload) LOOP
      IF public.jsonb_has_money_key(_v) THEN RETURN TRUE; END IF;
    END LOOP;
  END IF;

  RETURN FALSE;
END; $$;

COMMENT ON FUNCTION public.jsonb_has_money_key IS
  'True if any key anywhere in the payload names money. Deliberately broad and deliberately name-based: rejecting a harmless key costs a rename, while letting a price through publishes it to every active user via the approvals SELECT policy.';

CREATE OR REPLACE FUNCTION public.approval_payload_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.linked_record_type = 'quotation_revision' THEN
    IF NEW.linked_record_id IS NULL THEN
      RAISE EXCEPTION 'A quotation_revision approval must name the revision it approves. | يجب تحديد المراجعة.'
        USING ERRCODE = 'check_violation';
    END IF;

    IF public.jsonb_has_money_key(NEW.requested_payload) THEN
      RAISE EXCEPTION 'Approval payloads for quotation revisions must not contain prices — approvals are readable by every active user. Reference the revision instead. | لا تُدرج الأسعار في حمولة الاعتماد.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS approvals_payload_guard ON public.approvals;
CREATE TRIGGER approvals_payload_guard
  BEFORE INSERT OR UPDATE ON public.approvals
  FOR EACH ROW EXECUTE FUNCTION public.approval_payload_guard();

COMMENT ON FUNCTION public.approval_payload_guard IS
  'Keeps money out of quotation_revision approval payloads. Scoped to that linked_record_type so existing approval flows carrying amounts are unaffected.';

-- ============ 2. Document reach for revisions ============
-- Reproduces the live function with two branches added and nothing else
-- touched. The unchanged branches are pinned byte-for-byte by
-- phase7c-schema.contract.test.ts against the migrations that defined them.
CREATE OR REPLACE FUNCTION public.document_entity_grants(_entity_type document_entity_type, _entity_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _personal BOOLEAN := FALSE;
  _exists   BOOLEAN := FALSE;
BEGIN
  IF _user_id IS NULL OR _entity_id IS NULL THEN
    RETURN FALSE;                       -- anon, or a link with no target
  END IF;
  IF NOT public.is_active_user(_user_id) THEN
    RETURN FALSE;                       -- suspended and pending accounts read nothing
  END IF;

  CASE _entity_type
    WHEN 'opportunity' THEN
      SELECT TRUE, o.owner_id = _user_id INTO _exists, _personal
        FROM public.opportunities o WHERE o.id = _entity_id;

    WHEN 'rfq' THEN
      SELECT TRUE, (r.sales_owner_id = _user_id OR r.assigned_to = _user_id) INTO _exists, _personal
        FROM public.rfqs r WHERE r.id = _entity_id;

    WHEN 'tender' THEN
      SELECT TRUE, t.tender_owner_id = _user_id INTO _exists, _personal
        FROM public.tenders t WHERE t.id = _entity_id;

    WHEN 'inbox_item' THEN
      SELECT TRUE, (i.created_by = _user_id OR i.assigned_owner_id = _user_id
                    OR i.info_responsible_id = _user_id) INTO _exists, _personal
        FROM public.inbox_items i WHERE i.id = _entity_id;

    -- A project has no owner column of its own; the stake comes through the
    -- opportunity that sits on it. Same rule migration 109 used for
    -- projects/{id}/cover.
    WHEN 'project' THEN
      SELECT TRUE, EXISTS (
        SELECT 1 FROM public.opportunities o
         WHERE o.project_id = p.id AND o.owner_id = _user_id
      ) INTO _exists, _personal
        FROM public.projects p WHERE p.id = _entity_id;

    -- Contracts are the one entity that already has a purpose-built read
    -- predicate, so this defers to it wholesale and returns — it does NOT fall
    -- through to the can_read_attachments role fallback below.
    --
    -- Without the early return, estimation_manager would be able to open a
    -- document attached to a contract while being refused the contract record
    -- itself, because they are in D24's attachment list but deliberately not in
    -- the contract read set. A file whose whole content is the commercial terms
    -- should not be reachable by someone denied those terms. Same for viewer and
    -- system_admin, which can_read_contract already excludes.
    WHEN 'contract' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.contracts c
         WHERE c.id = _entity_id
           AND public.can_read_contract(c.opportunity_id, c.responsible_user_id,
                                        c.created_by, _user_id)
      );

    WHEN 'boq' THEN
      SELECT TRUE, (b.created_by = _user_id
                    OR EXISTS (SELECT 1 FROM public.opportunities o
                                WHERE o.id = b.related_opportunity_id AND o.owner_id = _user_id))
        INTO _exists, _personal
        FROM public.boqs b WHERE b.id = _entity_id;

    -- Phase 7A added this enum value and no branch, so these documents were
    -- reachable by nobody. The stake comes through the parent BOQ, exactly as
    -- the 'boq' branch above resolves it.
    WHEN 'boq_revision' THEN
      SELECT TRUE, (b.created_by = _user_id
                    OR EXISTS (SELECT 1 FROM public.opportunities o
                                WHERE o.id = b.related_opportunity_id AND o.owner_id = _user_id))
        INTO _exists, _personal
        FROM public.boq_revisions br JOIN public.boqs b ON b.id = br.boq_id
       WHERE br.id = _entity_id;

    WHEN 'quotation' THEN
      SELECT TRUE, (q.owner_id = _user_id OR q.created_by = _user_id
                    OR EXISTS (SELECT 1 FROM public.opportunities o
                                WHERE o.id = q.related_opportunity_id AND o.owner_id = _user_id))
        INTO _exists, _personal
        FROM public.quotations q WHERE q.id = _entity_id;

    -- A revision's documents follow its parent quotation. Same stake, so a
    -- salesperson who can open the quotation can open the PDF that was sent.
    WHEN 'quotation_revision' THEN
      SELECT TRUE, (q.owner_id = _user_id OR q.created_by = _user_id
                    OR EXISTS (SELECT 1 FROM public.opportunities o
                                WHERE o.id = q.related_opportunity_id AND o.owner_id = _user_id))
        INTO _exists, _personal
        FROM public.quotation_revisions r JOIN public.quotations q ON q.id = r.quotation_id
       WHERE r.id = _entity_id;

    ELSE
      RETURN FALSE;                     -- a new enum value grants nothing
  END CASE;

  IF NOT COALESCE(_exists, FALSE) THEN
    RETURN FALSE;                       -- forged link: points at nothing
  END IF;

  RETURN COALESCE(_personal, FALSE) OR public.can_read_attachments(_user_id);
END;
$function$;
