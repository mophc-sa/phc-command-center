-- =========================================================
-- PHASE 6 — Document registry.
--
-- WHY A REGISTRY AT ALL
-- ---------------------
-- Migration 109 closed the attachment read exposure with what it called a
-- staging policy, and said so in its own header: five of six upload sites write
-- to a static folder (`inbox/`, `contracts/`, `boq/`, `rfq/`) that carries no
-- entity id, so for most files the path proves nothing about what they belong
-- to. Access therefore had to fall back to "your role handles documents",
-- which is coarse: a bd_manager reads every file in the bucket because there is
-- nothing in the system that says which deal a file is attached to.
--
-- This table is that missing fact. Once a file is linked to an entity, access
-- can be derived from the entity rather than from a role, which is what
-- migration 109 said Phase 6 would do.
--
-- WHY LINKS ARE A SEPARATE TABLE
-- ------------------------------
-- The same PDF is routinely the RFQ document, the opportunity's evidence, and
-- later the project's record of what was quoted. A foreign key on `documents`
-- would force a choice and produce three uploads of one file — three objects to
-- keep in step, three chances for the wrong version to be the one someone
-- opens. A link table lets one stored object answer to several records.
--
-- WHY ACCESS IS NOT DERIVED FROM THE ENTITY'S OWN RLS
-- ---------------------------------------------------
-- The obvious design is a SECURITY INVOKER lookup so each entity's existing
-- SELECT policy decides. It is wrong here, and measurably so — the entity
-- policies in production today are:
--
--     opportunities   owner_id = uid OR can_view_all_sales_data(uid)
--     rfqs            sales_owner_id = uid OR can_view_all_sales_data(uid)
--     tenders         tender_owner_id = uid OR can_view_all_sales_data(uid)
--     projects        is_active_user(uid)          <-- every active user
--     inbox_items     is_active_user(uid)          <-- every active user
--     contracts       true                         <-- everyone
--
-- `can_view_all_sales_data()` includes `viewer` and `system_admin`, and the
-- last three are open to any active user. Deriving document reads from those
-- policies would hand `viewer` every contract and BOQ in the system — the exact
-- widening D24 refused. So visibility is a conjunction: a personal stake in the
-- record, or a role whose work involves documents (D24's narrow list) together
-- with the record existing. Explicit, and pinned by behavioural tests.
--
-- WHAT IS DELIBERATELY ABSENT
-- ---------------------------
-- No signed URLs are stored, anywhere, ever (D25). No physical delete: there is
-- no DELETE policy on either table, so the only removal is a soft one. No AI,
-- no OCR, no classification — Phase 6 is the shelf, not the librarian.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. Vocabulary ============
-- A closed set, because a free-text `type` column becomes eleven spellings of
-- "drawing" within a month and nothing can be filtered on it afterwards.
DO $$ BEGIN
  CREATE TYPE public.document_type AS ENUM (
    'boq', 'drawing', 'contract', 'quotation', 'photo', 'award_letter',
    'submission', 'correspondence', 'report', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Only entities that exist today and have a defined visibility rule below. A
-- value added here without a matching branch in document_entity_grants() grants
-- nothing — the CASE falls through to FALSE. That is the intended failure mode.
DO $$ BEGIN
  CREATE TYPE public.document_entity_type AS ENUM (
    'opportunity', 'rfq', 'tender', 'project', 'contract',
    'boq', 'quotation', 'inbox_item'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ 2. The file ============
CREATE TABLE IF NOT EXISTS public.documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Where the bytes are. A path, never a URL — see D25.
  storage_bucket    TEXT NOT NULL DEFAULT 'attachments',
  storage_path      TEXT NOT NULL,

  original_filename TEXT NOT NULL,
  mime_type         TEXT,
  size_bytes        BIGINT,
  -- sha256 hex when the uploader could compute it. Nullable on purpose: a
  -- fabricated checksum is worse than an absent one, and the legacy backfill
  -- cannot compute one without downloading every object.
  checksum          TEXT,

  doc_type          public.document_type NOT NULL DEFAULT 'other',
  title             TEXT,
  notes             TEXT,

  -- Where a photo was taken. Distinct from the project's site: a project has
  -- one location, but a photo of the north entrance sign has its own. Null for
  -- everything that is not a geotagged photo.
  captured_lat      NUMERIC(9,6),
  captured_lon      NUMERIC(9,6),

  uploaded_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Soft delete only. There is no DELETE policy on this table.
  deleted_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at        TIMESTAMPTZ,
  delete_reason     TEXT,

  -- Version history as a chain rather than a version number: each superseded
  -- row points at what replaced it, so the history survives even if someone
  -- deletes the middle of the chain.
  superseded_by     UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  superseded_at     TIMESTAMPTZ,

  -- Set only by the legacy backfill. Governs the one transitional read rule
  -- below, and shrinks to nothing as legacy files are linked.
  is_legacy         BOOLEAN NOT NULL DEFAULT FALSE,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT documents_lat_range CHECK (captured_lat IS NULL OR (captured_lat BETWEEN -90 AND 90)),
  CONSTRAINT documents_lon_range CHECK (captured_lon IS NULL OR (captured_lon BETWEEN -180 AND 180)),
  CONSTRAINT documents_latlon_together CHECK ((captured_lat IS NULL) = (captured_lon IS NULL)),
  CONSTRAINT documents_not_self_superseding CHECK (superseded_by IS DISTINCT FROM id),
  CONSTRAINT documents_supersede_consistent CHECK ((superseded_by IS NULL) = (superseded_at IS NULL)),
  CONSTRAINT documents_delete_consistent CHECK ((deleted_by IS NULL) = (deleted_at IS NULL))
);

-- One registry row per stored object. Without this, two rows could claim the
-- same file and disagree about who may read it.
CREATE UNIQUE INDEX IF NOT EXISTS documents_storage_object_unique
  ON public.documents (storage_bucket, storage_path);

COMMENT ON TABLE public.documents IS
  'One row per stored file. Holds the storage PATH, never a signed URL (D25) — links are minted at read time. Physical deletion is impossible by design: there is no DELETE policy, only deleted_at.';
COMMENT ON COLUMN public.documents.is_legacy IS
  'True only for rows created by the Phase 6 backfill from pre-registry uploads. The one read rule that still falls back to role rather than entity applies to these and only these.';

-- ============ 3. The links ============
CREATE TABLE IF NOT EXISTS public.document_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  entity_type public.document_entity_type NOT NULL,
  entity_id   UUID NOT NULL,
  -- What this file is TO that record: 'primary', 'evidence', 'cover', …
  -- Free text on purpose — it is a label, not a permission.
  link_role   TEXT,

  linked_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  linked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  unlinked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  unlinked_at TIMESTAMPTZ,

  CONSTRAINT document_links_unlink_consistent CHECK ((unlinked_by IS NULL) = (unlinked_at IS NULL))
);

-- A file links to a record once. Re-linking after an unlink is allowed, which
-- is why the constraint is partial.
CREATE UNIQUE INDEX IF NOT EXISTS document_links_active_unique
  ON public.document_links (document_id, entity_type, entity_id)
  WHERE unlinked_at IS NULL;

-- The index the whole feature leans on: "every live document on this record".
-- Without it, a project page with a photo gallery sequential-scans the link
-- table once per render.
CREATE INDEX IF NOT EXISTS document_links_entity_active
  ON public.document_links (entity_type, entity_id)
  WHERE unlinked_at IS NULL;

CREATE INDEX IF NOT EXISTS document_links_document_active
  ON public.document_links (document_id)
  WHERE unlinked_at IS NULL;

COMMENT ON TABLE public.document_links IS
  'Which records a file belongs to. Many-to-many on purpose: the same PDF is often the RFQ document, the opportunity evidence, and the project record. Unlinking is soft so the history of what was once attached survives.';

-- Supporting indexes on documents for the list and gallery reads.
CREATE INDEX IF NOT EXISTS documents_live_by_uploaded
  ON public.documents (uploaded_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS documents_uploader
  ON public.documents (uploaded_by)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS documents_supersede_chain
  ON public.documents (superseded_by)
  WHERE superseded_by IS NOT NULL;

-- ============ 4. Immutability of the parts that decide access ============
-- Without this, a user updates their own row's storage_path to point at someone
-- else's object and reads it — the registry would become the escalation path it
-- was built to prevent. Identity and provenance are fixed at insert; only the
-- human-editable fields and the lifecycle columns may move.
CREATE OR REPLACE FUNCTION public.documents_guard_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.storage_bucket IS DISTINCT FROM OLD.storage_bucket
     OR NEW.storage_path IS DISTINCT FROM OLD.storage_path THEN
    RAISE EXCEPTION 'documents.storage_path is immutable — a row may not be repointed at a different object';
  END IF;
  IF NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
     OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at THEN
    RAISE EXCEPTION 'documents provenance (uploaded_by/uploaded_at) is immutable';
  END IF;
  IF OLD.checksum IS NOT NULL AND NEW.checksum IS DISTINCT FROM OLD.checksum THEN
    RAISE EXCEPTION 'documents.checksum is immutable once recorded';
  END IF;
  IF OLD.size_bytes IS NOT NULL AND NEW.size_bytes IS DISTINCT FROM OLD.size_bytes THEN
    RAISE EXCEPTION 'documents.size_bytes is immutable once recorded';
  END IF;
  -- Undeleting is a decision, not an accident of an UPDATE that forgot the
  -- column. Restoring is possible, but only by clearing both fields together,
  -- which the check constraint already forces.
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS documents_guard_immutable_trg ON public.documents;
CREATE TRIGGER documents_guard_immutable_trg
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.documents_guard_immutable();

-- ============ 5. Who may see a record's documents ============
-- Two ways in, and they are different in kind:
--
--   a personal stake  you own or are assigned the record. This is what lets a
--                     salesperson reach their own deal's files and nobody
--                     else's.
--   a document role   D24's narrow list — the people whose work is the
--                     documents. Deliberately NOT can_view_all_sales_data(),
--                     which includes viewer and system_admin.
--
-- Unknown enum value, missing record, null user: FALSE. The CASE has no ELSE
-- that grants.
CREATE OR REPLACE FUNCTION public.document_entity_grants(
  _entity_type public.document_entity_type,
  _entity_id   UUID,
  _user_id     UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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

    WHEN 'contract' THEN
      SELECT TRUE, (c.responsible_user_id = _user_id OR c.created_by = _user_id
                    OR EXISTS (SELECT 1 FROM public.opportunities o
                                WHERE o.id = c.opportunity_id AND o.owner_id = _user_id))
        INTO _exists, _personal
        FROM public.contracts c WHERE c.id = _entity_id;

    WHEN 'boq' THEN
      SELECT TRUE, (b.created_by = _user_id
                    OR EXISTS (SELECT 1 FROM public.opportunities o
                                WHERE o.id = b.related_opportunity_id AND o.owner_id = _user_id))
        INTO _exists, _personal
        FROM public.boqs b WHERE b.id = _entity_id;

    WHEN 'quotation' THEN
      SELECT TRUE, (q.owner_id = _user_id OR q.created_by = _user_id
                    OR EXISTS (SELECT 1 FROM public.opportunities o
                                WHERE o.id = q.related_opportunity_id AND o.owner_id = _user_id))
        INTO _exists, _personal
        FROM public.quotations q WHERE q.id = _entity_id;

    ELSE
      RETURN FALSE;                     -- a new enum value grants nothing
  END CASE;

  IF NOT COALESCE(_exists, FALSE) THEN
    RETURN FALSE;                       -- forged link: points at nothing
  END IF;

  RETURN COALESCE(_personal, FALSE) OR public.can_read_attachments(_user_id);
END;
$$;

COMMENT ON FUNCTION public.document_entity_grants IS
  'Whether a user may reach documents attached to one record: a personal stake in it, or a document-handling role (D24) plus the record existing. Never derived from the entity table''s own SELECT policy — projects, inbox_items and contracts are readable by every active user, and reusing those would hand viewer every contract in the system.';

-- ============ 6. Who may read one document ============
CREATE OR REPLACE FUNCTION public.can_read_document(_document_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.documents d
     WHERE d.id = _document_id
       AND _user_id IS NOT NULL
       AND (
         -- You uploaded it.
         d.uploaded_by = _user_id
         -- Or it hangs off a record you can reach.
         OR EXISTS (
           SELECT 1 FROM public.document_links l
            WHERE l.document_id = d.id
              AND l.unlinked_at IS NULL
              AND public.document_entity_grants(l.entity_type, l.entity_id, _user_id)
         )
         -- Or it is a pre-registry file nobody has linked yet. This is the one
         -- rule still keyed to role rather than entity, it applies only to rows
         -- the backfill created, and it exists so that migrating to the
         -- registry does not silently strip managers of files they can read
         -- today. Link a legacy file to anything and this stops applying to it.
         OR (
           d.is_legacy
           AND NOT EXISTS (SELECT 1 FROM public.document_links l2
                            WHERE l2.document_id = d.id AND l2.unlinked_at IS NULL)
           AND public.can_read_attachments(_user_id)
         )
       )
  );
$$;

COMMENT ON FUNCTION public.can_read_document IS
  'Read predicate for one document: uploader, or a live link to a record the user can reach, or an unlinked legacy row plus a document-handling role. Soft-deleted rows are still readable through this — the storage policy is what stops the bytes being served.';

-- ============ 7. RLS ============
ALTER TABLE public.documents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_links ENABLE ROW LEVEL SECURITY;

-- ---- documents ----
DROP POLICY IF EXISTS "Documents readable via entity link" ON public.documents;
CREATE POLICY "Documents readable via entity link"
  ON public.documents FOR SELECT
  TO authenticated
  USING (public.can_read_document(id, (SELECT auth.uid())));

-- Upload rights are unchanged from the bucket's existing INSERT policy, so this
-- widens nothing: the same people who can put an object in the bucket can
-- register it. You may only register a file as yourself.
DROP POLICY IF EXISTS "Documents insertable by uploader" ON public.documents;
CREATE POLICY "Documents insertable by uploader"
  ON public.documents FOR INSERT
  TO authenticated
  WITH CHECK (
    uploaded_by = (SELECT auth.uid())
    AND public.is_active_user((SELECT auth.uid()))
    AND public.has_any_role((SELECT auth.uid()),
        ARRAY['salesperson','bd_manager','sales_manager','ceo','system_admin']::public.app_role[])
    AND deleted_at IS NULL
    AND is_legacy = FALSE
  );

-- Editing the title, superseding, and soft-deleting. The immutability trigger
-- is what stops this touching storage_path or provenance; the policy decides
-- who may attempt it at all.
DROP POLICY IF EXISTS "Documents updatable by uploader or commercial manager" ON public.documents;
CREATE POLICY "Documents updatable by uploader or commercial manager"
  ON public.documents FOR UPDATE
  TO authenticated
  USING (
    public.can_read_document(id, (SELECT auth.uid()))
    AND (uploaded_by = (SELECT auth.uid())
         OR public.is_commercial_manager((SELECT auth.uid())))
  )
  -- WITH CHECK cannot see OLD, so it cannot police what changed — that is the
  -- immutability trigger's job. What it can do is stop the row being handed to
  -- someone else: after the update you must still be the uploader, or a
  -- commercial manager acting on it.
  WITH CHECK (
    uploaded_by = (SELECT auth.uid())
    OR public.is_commercial_manager((SELECT auth.uid()))
  );

-- No DELETE policy, deliberately. Soft delete is the only removal in Phase 6.

-- ---- document_links ----
DROP POLICY IF EXISTS "Links readable when the entity is reachable" ON public.document_links;
CREATE POLICY "Links readable when the entity is reachable"
  ON public.document_links FOR SELECT
  TO authenticated
  USING (public.document_entity_grants(entity_type, entity_id, (SELECT auth.uid())));

-- Both halves are required, and the first is the important one: without it, a
-- salesperson could attach someone else's document to their own opportunity and
-- read it. You may only link a file you can already see, to a record you can
-- already reach.
DROP POLICY IF EXISTS "Links insertable by someone who can see both ends" ON public.document_links;
CREATE POLICY "Links insertable by someone who can see both ends"
  ON public.document_links FOR INSERT
  TO authenticated
  WITH CHECK (
    linked_by = (SELECT auth.uid())
    AND unlinked_at IS NULL
    AND public.can_read_document(document_id, (SELECT auth.uid()))
    AND public.document_entity_grants(entity_type, entity_id, (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Links unlinkable by someone who can reach the entity" ON public.document_links;
CREATE POLICY "Links unlinkable by someone who can reach the entity"
  ON public.document_links FOR UPDATE
  TO authenticated
  USING (public.document_entity_grants(entity_type, entity_id, (SELECT auth.uid())))
  WITH CHECK (public.document_entity_grants(entity_type, entity_id, (SELECT auth.uid())));

-- No DELETE policy here either: unlinking is soft, so "this used to be attached
-- to that" survives.
