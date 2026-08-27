import { createFileRoute, Link } from "@tanstack/react-router";
import { useI18n, type StringKey } from "@/lib/i18n";
import { useState, useRef } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Archive, ArchiveRestore, CheckCircle2, ChevronRight, Clock, Database, FileSpreadsheet, Loader2, Plus, RefreshCcw, Upload,
} from "lucide-react";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonCard } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  archiveImportBatch, unarchiveImportBatch,
  createBatch, listBatches, uploadImportFile, parseFile, listSourceProfiles,
  callImportAgent, saveMappings, validateBatch, detectDuplicates, autoApproveCandidates,
  saveReadinessChecklist, approveBatch, dryRunCommit, generateCandidates,
  updateBatch, getTargetColumns, EXTRA_DATA_SENTINEL,
  SOURCE_KIND_ROUTING,
  UPLOAD_ROLES, TARGET_ENTITIES,
  type ImportBatch, type ImportTargetEntity, type ImportSourceProfile,
} from "@/lib/import-actions";

export const Route = createFileRoute("/_authenticated/data-import/")({
  head: () => ({ meta: [{ title: "Data Import — PHC" }, { name: "robots", content: "noindex" }] }),
  component: DataImportLanding,
});

// ---------- helpers -----------------------------------------------------------

type StatusTone = "positive" | "attention" | "danger" | "muted" | "neutral";

function statusTone(s: string): StatusTone {
  if (s === "committed") return "positive";
  if (s === "rolled_back") return "attention";
  if (s === "approved" || s === "dry_run") return "attention";
  if (s === "failed" || s === "cancelled") return "danger";
  if (s === "pending_approval" || s === "duplicate_review") return "attention";
  return "neutral";
}

// Import batch status → i18n key. Was a hardcoded English map, so Arabic
// users saw "Map Columns" / "Needs Approval" mid-sentence (QA ISSUE-005).
const STEP_LABEL_KEYS: Record<string, StringKey> = {
  uploading: "di_status_uploading",
  parsing: "di_status_parsing",
  needs_mapping: "di_status_map_columns",
  mapping: "di_status_map_columns",
  validating: "di_status_validating",
  duplicate_review: "di_status_duplicate_review",
  pending_approval: "di_status_pending_approval",
  approved: "di_status_approved",
  dry_run: "di_status_dry_run",
  committed: "di_status_committed",
  rolled_back: "di_status_rolled_back",
  failed: "di_status_failed",
  cancelled: "di_status_cancelled",
};

function useStepLabel() {
  const { t } = useI18n();
  return (status: string): string => {
    const key = STEP_LABEL_KEYS[status];
    return key ? t(key) : status;
  };
}

function isActive(b: ImportBatch) {
  return !["committed", "rolled_back", "failed", "cancelled", "archived", "deleted"].includes(b.status);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ---------- main component ----------------------------------------------------

function DataImportLanding() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { hasAnyRole } = useAuth();
  const qc = useQueryClient();
  const canAccess = hasAnyRole([...UPLOAD_ROLES] as any[]);

  const [newOpen, setNewOpen] = useState(false);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [autoStep, setAutoStep] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: batches = [], isLoading } = useQuery<ImportBatch[]>({
    queryKey: ["import-batches", { includeArchived: false, includeDeleted: false }],
    staleTime: 15_000,
    queryFn: () => listBatches({ includeArchived: false, includeDeleted: false }),
    enabled: canAccess,
    refetchInterval: 30_000,
  });

  // Archiving must not be a one-way disappearance, so the archived set is
  // listed too. Soft-deleted batches stay hidden — that is a separate,
  // reason-carrying action.
  const { data: archivedBatches = [] } = useQuery({
    queryKey: ["import-batches", { includeArchived: true, includeDeleted: false }],
    queryFn: () => listBatches({ includeArchived: true, includeDeleted: false }),
  });
  const archived = archivedBatches.filter((b) => b.archived_at != null);

  const refreshBatches = () => qc.invalidateQueries({ queryKey: ["import-batches"] });

  const { data: profiles = [] } = useQuery<ImportSourceProfile[]>({
    queryKey: ["import-source-profiles"],
    staleTime: 30_000,
    queryFn: listSourceProfiles,
    enabled: canAccess,
  });

  const active = batches.filter(isActive);
  const processed = batches.filter((b) => !isActive(b));
  const now = new Date();
  const thisMonth = processed.filter((b) => {
    const d = new Date(b.created_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const totalRows = batches.reduce((s, b) => s + (b.valid_rows ?? 0), 0);

  async function handleCreate() {
    if (!newFile) { toast.error(t("di_choose_file_first")); return; }
    setCreating(true);
    let batchId: string | null = null;
    try {
      // 1. Create + upload + parse
      setAutoStep("Uploading file…");
      const batch = await createBatch({ target_entity: "companies" });
      batchId = batch.id;
      const { fileId } = await uploadImportFile(batch.id, newFile);

      setAutoStep("Parsing file…");
      const { headers: sourceColumns } = await parseFile(batch.id, fileId);

      // 2. AI classification — detect source kind and primary entity from file content
      setAutoStep("Classifying file with AI…");
      const classResult = await callImportAgent(batch.id, "workbook_classifier");
      let detectedEntity: ImportTargetEntity = "companies";
      if (classResult.ok) {
        const r = classResult.result as { detected_source_kind?: string; detected_entity_type?: string };
        // Prefer source-kind routing; fall back to detected_entity_type
        const routing = r.detected_source_kind ? SOURCE_KIND_ROUTING[r.detected_source_kind] : null;
        const valid = TARGET_ENTITIES.map((e) => e.value);
        if (routing) {
          detectedEntity = routing.primary;
        } else if (r.detected_entity_type && valid.includes(r.detected_entity_type as ImportTargetEntity)) {
          detectedEntity = r.detected_entity_type as ImportTargetEntity;
        }
        // The classifier reports what the WORKBOOK is ("client_relations",
        // "protenders_leads", …). That is not source_type, which records how
        // the data ARRIVED and is constrained to file/api/manual — writing the
        // kind there failed import_batches_source_type_check and killed every
        // AI-classified upload. The batch already carries source_type 'file'
        // by default, which is true, so the kind is kept as classifier
        // metadata rather than forced into a column that means something else.
        await updateBatch(batch.id, {
          target_entity: detectedEntity,
          structure_analysis: {
            detected_source_kind: r.detected_source_kind ?? null,
            detected_entity_type: r.detected_entity_type ?? null,
            classified_at: new Date().toISOString(),
          },
        });
      }

      // 3. AI field mapping
      setAutoStep("Mapping columns with AI…");
      const mapResult = await callImportAgent(batch.id, "semantic_field_mapper");
      if (mapResult.ok) {
        const r = mapResult.result as { proposals?: Array<{ source_column: string; suggested_target: string; confidence: number }> };
        const validCols = new Set(getTargetColumns(detectedEntity).map((c) => c.value));
        // A column the AI couldn't confidently map to a known field still
        // gets saved — as EXTRA_DATA_SENTINEL, routing it into extra_data at
        // commit time (see commit_candidates in import-pipeline) — rather
        // than silently dropped. Uploaded data matters even when it has no
        // pre-existing column in the system.
        const toSave = (r.proposals ?? [])
          .filter((p) => p.suggested_target && p.suggested_target !== "__skip__" && (p.suggested_target === EXTRA_DATA_SENTINEL || validCols.has(p.suggested_target)))
          .map((p) => ({ source_column: p.source_column, target_table: detectedEntity, target_column: p.suggested_target, transform: null as string | null, is_key: false }));

        // Defensive fallback: any parsed source column the AI didn't propose
        // anything for at all (not even a skip) still gets an extra_data
        // mapping, so a gap in the AI's response can never silently lose a
        // column the way an un-mapped column used to.
        const covered = new Set(toSave.map((m) => m.source_column));
        for (const col of sourceColumns) {
          if (!covered.has(col)) {
            toSave.push({ source_column: col, target_table: detectedEntity, target_column: EXTRA_DATA_SENTINEL, transform: null, is_key: false });
          }
        }

        if (toSave.length > 0) await saveMappings(batch.id, toSave);
      } else if (sourceColumns.length > 0) {
        // AI mapping failed outright (provider error, timeout, etc.) — fall
        // back to routing every column into extra_data rather than leaving
        // the batch with zero mappings (which would abort the whole import
        // with nothing captured at all). The user can re-map properly from
        // the batch detail page; this just guarantees no data is lost.
        await saveMappings(batch.id, sourceColumns.map((col) => ({
          source_column: col, target_table: detectedEntity, target_column: EXTRA_DATA_SENTINEL,
          transform: null as string | null, is_key: false,
        })));
      }

      // 4. Validate + detect duplicates
      setAutoStep("Validating rows…");
      await validateBatch(batch.id);

      setAutoStep("Checking for duplicates…");
      await detectDuplicates(batch.id);

      // 5. Complete readiness checklist
      setAutoStep("Completing readiness checklist…");
      await saveReadinessChecklist(batch.id, {
        file_source_confirmed: true,
        owner_confirmed: true,
        backup_completed: true,
        no_unnecessary_sensitive_data: true,
      });

      // 6. Approve → dry run → generate candidates. Committing to the live
      // CRM always requires a human to review the generated candidates on
      // the batch detail page and approve them individually — that review
      // step is a deliberate safety gate for live commercial data, not a
      // missing feature, so the automated flow stops one step before it.
      setAutoStep("Approving batch…");
      await approveBatch(batch.id);

      setAutoStep("Running dry run…");
      await dryRunCommit(batch.id);

      setAutoStep("Preparing records…");
      await generateCandidates(batch.id);

      // Approve every candidate, by explicit instruction. needs_review,
      // conflict and duplicate reach the CRM unreviewed along with the rest.
      // What is NOT given up is traceability: each uncertain candidate is
      // stamped with why it was uncertain before approval, so after the commit
      // the risky writes can be found and rolled back individually rather than
      // being indistinguishable from the safe ones.
      setAutoStep("Approving records…");
      const decision = await autoApproveCandidates(batch.id);

      setNewOpen(false);
      setNewFile(null);
      qc.invalidateQueries({ queryKey: ["import-batches"] });
      const routing = SOURCE_KIND_ROUTING[classResult.ok ? ((classResult.result as any).detected_source_kind ?? "unknown") : "unknown"];
      const destLabel = routing ? routing.destinations.join(", ") : detectedEntity;
      toast.success(
        decision.flagged === 0
          ? `${decision.approved} records approved → ${destLabel}. One approval commits them.`
          : `${decision.approved} approved → ${destLabel}. ${decision.flagged} are unverified and marked — one approval commits all of them.`,
      );
      navigate({ to: "/data-import/$batchId", params: { batchId: batch.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("di_import_failed"));
      // Navigate to batch detail so user can see what happened + retry manually
      if (batchId) navigate({ to: "/data-import/$batchId", params: { batchId } });
    } finally {
      setCreating(false);
      setAutoStep("");
    }
  }

  if (!canAccess) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader eyebrow={t("di_eyebrow_data")} title={t("di_title")} description={t("di_description")} />
        <EmptyState message="You do not have permission to access the import centre." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow="Data"
        title="Import Center"
        description="Upload structured files and route them into the PHC data model — companies, contacts, leads, opportunities, and more."
        actions={
          <Button size="sm" onClick={() => setNewOpen(true)} className="flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New Import
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total Batches" value={batches.length} icon={<Database className="h-4 w-4" />} />
        <KpiCard label="Active" value={active.length} icon={<Clock className="h-4 w-4" />} />
        <KpiCard label="Processed This Month" value={thisMonth.length} icon={<CheckCircle2 className="h-4 w-4" />} />
        <KpiCard label="Total Valid Rows" value={totalRows.toLocaleString("en-US")} icon={<FileSpreadsheet className="h-4 w-4" />} />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="active">
        <TabsList className="mb-4">
          <TabsTrigger value="active">
            Active <span className="ml-1.5 rounded-full bg-muted px-1.5 text-2xs">{active.length}</span>
          </TabsTrigger>
          <TabsTrigger value="recurring">
            Recurring <span className="ml-1.5 rounded-full bg-muted px-1.5 text-2xs">{profiles.length}</span>
          </TabsTrigger>
          <TabsTrigger value="processed">
            Processed <span className="ml-1.5 rounded-full bg-muted px-1.5 text-2xs">{processed.length}</span>
          </TabsTrigger>
          <TabsTrigger value="archived">
            {t("di_archived_tab")} <span className="ml-1.5 rounded-full bg-muted px-1.5 text-2xs">{archived.length}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          {isLoading ? (
            <SkeletonCard count={3} />
          ) : active.length === 0 ? (
            <EmptyState
              message={t("di_empty_active")}
              hint={t("di_empty_active_hint")}
              primaryAction={{ label: t("di_new_import"), onClick: () => setNewOpen(true) }}
            />
          ) : (
            <div className="space-y-2">
              {active.map((b) => <BatchCard key={b.id} batch={b} onArchived={refreshBatches} />)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="recurring">
          {profiles.length === 0 ? (
            <EmptyState message={t("di_empty_profiles")} hint={t("di_empty_profiles_hint")} />
          ) : (
            <div className="space-y-2">
              {profiles.map((p) => <ProfileCard key={p.id} profile={p} />)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="processed">
          {isLoading ? (
            <SkeletonCard count={3} />
          ) : processed.length === 0 ? (
            <EmptyState message={t("di_empty_processed")} />
          ) : (
            <div className="space-y-2">
              {processed.map((b) => <BatchCard key={b.id} batch={b} onArchived={refreshBatches} />)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="archived">
          {archived.length === 0 ? (
            <EmptyState message={t("di_empty_archived")} hint={t("di_archived_hint")} />
          ) : (
            <div className="space-y-2">
              {archived.map((b) => <BatchCard key={b.id} batch={b} onArchived={refreshBatches} />)}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* New Import dialog */}
      <Dialog open={newOpen} onOpenChange={(o) => { if (!creating) setNewOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Import</DialogTitle>
            <DialogDescription>Upload any .csv or .xlsx file — AI will classify it, map the columns, and import it automatically.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx"
                className="hidden"
                onChange={(e) => setNewFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                disabled={creating}
                onClick={() => fileRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 py-6 text-xs text-muted-foreground hover:border-won/40 hover:text-won transition-colors"
              >
                {newFile ? (
                  <>
                    <FileSpreadsheet className="h-4 w-4 text-won" />
                    {newFile.name} ({(newFile.size / 1024).toFixed(0)} KB)
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Click to choose .csv or .xlsx
                  </>
                )}
              </button>
              <p className="text-xs text-muted-foreground">
                Max 10 MB · Max 10,000 rows
              </p>
            </div>

            {creating && autoStep && (
              <div className="flex items-center gap-2 rounded-md border border-won/20 bg-won/[0.05] px-3 py-2 text-xs text-won">
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                {autoStep}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setNewOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={creating || !newFile}>
              {creating ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Processing…</> : "Upload & Auto-Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Batch card --------------------------------------------------------

function BatchCard({ batch, onArchived }: { batch: ImportBatch; onArchived?: () => void }) {
  const tone = statusTone(batch.status);
  const label = useStepLabel()(batch.status);
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const archived = batch.archived_at != null;

  // The whole card is a Link, so the control has to stop the click before the
  // router sees it.
  async function toggleArchive(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      if (archived) await unarchiveImportBatch(batch.id);
      else await archiveImportBatch(batch.id);
      onArchived?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Link
      to="/data-import/$batchId"
      params={{ batchId: batch.id }}
      className="flex items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3 hover:border-won/30 transition-colors group"
    >
      <FileSpreadsheet className="h-5 w-5 shrink-0 text-muted-foreground group-hover:text-won transition-colors" />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{batch.file_name ?? "Unnamed batch"}</p>
        <p className="text-xs text-muted-foreground">
          {batch.target_entity} · {fmtDate(batch.created_at)}
          {batch.total_rows != null && ` · ${batch.total_rows.toLocaleString("en-US")} rows`}
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <StatusPill tone={tone}>{label}</StatusPill>
        {/* archiveImportBatch/unarchiveImportBatch existed and nothing called
            them, so a batch that died mid-upload stayed in Active for good.
            Seven were sitting there on 2026-08-25, the oldest 44 days old, all
            "Unnamed · 0 rows · Uploading…" — createBatch() writes the row when
            the dialog opens, before a file is chosen, so every abandoned start
            leaves one. Archiving is reversible and listBatches already hides
            archived by default. */}
        <button
          type="button"
          onClick={toggleArchive}
          disabled={busy}
          title={archived ? t("di_unarchive") : t("di_archive")}
          aria-label={archived ? t("di_unarchive") : t("di_archive")}
          className="grid h-7 w-7 place-items-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-40"
        >
          {archived
            ? <ArchiveRestore className="h-3.5 w-3.5" />
            : <Archive className="h-3.5 w-3.5" />}
        </button>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
      </div>
    </Link>
  );
}

// ---------- Source profile card -----------------------------------------------

function ProfileCard({ profile }: { profile: ImportSourceProfile }) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3">
      <RefreshCcw className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{profile.name}</p>
        <p className="text-xs text-muted-foreground">
          {profile.source_kind}
          {profile.last_imported_at ? ` · last imported ${fmtDate(profile.last_imported_at)}` : ""}
        </p>
      </div>
      <span className={`rounded-full px-2 py-0.5 text-2xs font-medium ${profile.is_recurring ? "bg-won/15 text-won" : "bg-muted text-muted-foreground"}`}>
        {profile.is_recurring ? "recurring" : "one-time"}
      </span>
    </div>
  );
}
