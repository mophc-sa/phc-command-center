import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n } from "@/lib/i18n";
import { canCreateSalesRecords, canManageSalesPipeline, type AppRole } from "@/lib/roles";
import {
  archiveRecord,
  flagDuplicate,
  requestDelete,
  unarchiveRecord,
  ARCHIVABLE_ENTITY_TYPES,
  DELETABLE_ENTITY_TYPES,
  DUPLICATE_ENTITY_TYPES,
  type ArchivableEntityType,
  type DeletableEntityType,
  type DuplicateEntityType,
} from "@/lib/record-lifecycle-actions";

// The full set of entity types this menu can meaningfully be used with —
// the union of every table with an archive path, a hard-delete path, or a
// duplicate-flag path. Individual pages only ever pass one specific type;
// this union just lets the component be reused anywhere without a type
// mismatch.
export type RecordLifecycleEntityType = ArchivableEntityType | DeletableEntityType | DuplicateEntityType;

const ARCHIVABLE: ReadonlySet<string> = new Set(ARCHIVABLE_ENTITY_TYPES);
const DELETABLE: ReadonlySet<string> = new Set(DELETABLE_ENTITY_TYPES);
const DUPLICATE_ALLOWED: ReadonlySet<string> = new Set(DUPLICATE_ENTITY_TYPES);

// Small standalone badge — place next to a record's title/status pills.
export function ArchivedBadge({ archived }: { archived: boolean | null | undefined }) {
  const { t } = useI18n();
  if (!archived) return null;
  return <StatusPill tone="muted">{t("lifecycle_archived_badge")}</StatusPill>;
}

// Dropdown of record-lifecycle actions (archive/unarchive, request delete,
// mark duplicate) — the replacement for direct delete everywhere in the
// Sales OS. Renders nothing if the caller has no lifecycle capability at all.
//
// "Request Delete" only ever appears for the conservative hard-delete
// allowlist (follow_ups, activities, inbox_items, boqs — see
// DELETABLE_ENTITY_TYPES). Every other entity type this menu is wired to
// today (companies, opportunities) has no hard-delete path at all, server-
// side rejected too — companies/leads/contacts/rfqs/tenders are archive-only,
// opportunities is stage='archived' only. Mark Duplicate remains available
// for the broader DUPLICATE_ENTITY_TYPES set regardless of delete eligibility.
export function RecordLifecycleMenu({
  entityType,
  entityId,
  roles,
  archived,
  onDone,
}: {
  entityType: RecordLifecycleEntityType;
  entityId: string;
  roles: AppRole[] | null | undefined;
  archived?: boolean | null;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [unarchiveOpen, setUnarchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);

  const isArchivable = ARCHIVABLE.has(entityType);
  const canArchive = isArchivable && !archived && canManageSalesPipeline(roles);
  const canUnarchive = isArchivable && !!archived && canManageSalesPipeline(roles);
  const canFlagDuplicate = DUPLICATE_ALLOWED.has(entityType) && canCreateSalesRecords(roles);
  const canRequestThisDelete = DELETABLE.has(entityType) && canCreateSalesRecords(roles);
  if (!canArchive && !canUnarchive && !canFlagDuplicate && !canRequestThisDelete) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={t("lifecycle_menu_label")}
            className="inline-flex items-center justify-center rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canArchive ? (
            <DropdownMenuItem onSelect={() => setArchiveOpen(true)}>{t("lifecycle_archive")}</DropdownMenuItem>
          ) : null}
          {canUnarchive ? (
            <DropdownMenuItem onSelect={() => setUnarchiveOpen(true)}>{t("lifecycle_unarchive")}</DropdownMenuItem>
          ) : null}
          {canFlagDuplicate ? (
            <DropdownMenuItem onSelect={() => setDuplicateOpen(true)}>{t("lifecycle_mark_duplicate")}</DropdownMenuItem>
          ) : null}
          {canRequestThisDelete ? (
            <DropdownMenuItem className="text-red-400" onSelect={() => setDeleteOpen(true)}>
              {t("lifecycle_request_delete")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <ActionDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={t("lifecycle_archive")}
        description={t("lifecycle_archive_desc")}
        submitLabel={t("lifecycle_archive")}
        fields={[{ key: "reason", type: "textarea", label: t("lifecycle_reason_optional") }]}
        onSubmit={async (v) => {
          try {
            await archiveRecord({ entityType: entityType as ArchivableEntityType, entityId, reason: v.reason || undefined });
            toast.success(t("lifecycle_archived_toast"));
            onDone();
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />

      <ActionDialog
        open={unarchiveOpen}
        onOpenChange={setUnarchiveOpen}
        title={t("lifecycle_unarchive")}
        description={t("lifecycle_unarchive_desc")}
        submitLabel={t("lifecycle_unarchive")}
        fields={[]}
        onSubmit={async () => {
          try {
            await unarchiveRecord({ entityType: entityType as ArchivableEntityType, entityId });
            toast.success(t("lifecycle_unarchived_toast"));
            onDone();
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />

      <ActionDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("lifecycle_request_delete")}
        description={t("lifecycle_request_delete_desc")}
        submitLabel={t("lifecycle_request_delete")}
        destructive
        fields={[{ key: "reason", type: "textarea", label: t("lifecycle_reason_required"), required: true }]}
        onSubmit={async (v) => {
          try {
            await requestDelete({ entityType: entityType as DeletableEntityType, entityId, reason: v.reason });
            toast.success(t("lifecycle_delete_requested_toast"));
            onDone();
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />

      <ActionDialog
        open={duplicateOpen}
        onOpenChange={setDuplicateOpen}
        title={t("lifecycle_mark_duplicate")}
        description={t("lifecycle_mark_duplicate_desc")}
        submitLabel={t("lifecycle_mark_duplicate")}
        fields={[
          { key: "duplicateOfId", type: "text", label: t("lifecycle_duplicate_of_id"), required: true },
          { key: "reason", type: "textarea", label: t("lifecycle_reason_optional") },
        ]}
        onSubmit={async (v) => {
          try {
            await flagDuplicate({
              entityType: entityType as DuplicateEntityType,
              entityId,
              duplicateOfId: v.duplicateOfId,
              reason: v.reason || undefined,
            });
            toast.success(t("lifecycle_duplicate_flagged_toast"));
            onDone();
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </>
  );
}
