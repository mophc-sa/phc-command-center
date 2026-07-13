import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Copy, ShieldCheck,
  BarChart3, Download, X, Loader2, History, Archive, Trash2, Flame, RotateCcw,
  Save, Ban, Pencil, FileText,
} from "lucide-react";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createBatch, listBatches, getBatch, cancelBatch,
  uploadImportFile, parseFile, validateBatch, detectDuplicates,
  approveBatch, dryRunCommit, commitBatch, downloadReport,
  saveMappings, getMappings, getImportErrors, getDuplicateCandidates,
  resolveDuplicate, getImportFiles,
  getImportRows, updateImportRow, excludeImportRow, restoreImportRow, softDeleteImportRow,
  archiveImportBatch, softDeleteImportBatch, purgeImportBatch,
  updateBatch, getFileDownloadUrl,
  getBatchActivity, getReadinessChecklist, saveReadinessChecklist, deriveAutoChecklist,
  READINESS_ITEMS, stagedGroupsForRow,
  IMPORT_CAPABLE_ROLES, APPROVE_COMMIT_ROLES, UPLOAD_ROLES,
  COMPANY_TARGET_COLUMNS, TARGET_ENTITIES, getTargetColumns, EXTRA_DATA_SENTINEL,
  suggestImportMappings, type AiMappingSuggestion,
  type ImportBatch, type ImportMapping, type ImportRow, type ImportTargetEntity,
  type ReadinessChecklist, type StagedGroup,
} from "@/lib/import-actions";
import { Layers, Files, Activity as ActivityIcon, ListChecks, Lock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/data-import")({
  head: () => ({ meta: [{ title: "Data Import — PHC" }, { name: "robots", content: "noindex" }] }),
  component: DataImportCenter,
});

type StatusTone = "positive" | "attention" | "danger" | "muted" | "neutral";

function statusTone(s: string): StatusTone {
  if (s === "committed" || s === "approved") return "positive";
  if (s === "dry_run") return "positive";
  if (s === "failed" || s === "cancelled") return "danger";
  if (s === "pending_approval" || s === "duplicate_review") return "attention";
  return "neutral";
}

type HistoryFilter =
  | "active" | "all" | "parsed" | "needs_mapping" | "validation_failed"
  | "dry_run" | "archived" | "deleted";

function DataImportCenter() {
  const { t } = useI18n();
  const { hasAnyRole, hasRole } = useAuth();
  const qc = useQueryClient();

  const canAccess = hasAnyRole([...UPLOAD_ROLES] as any[]);
  const canApprove = hasAnyRole([...APPROVE_COMMIT_ROLES] as any[]);
  const isSystemAdmin = hasRole("system_admin" as any);

  const [tab, setTab] = useState("history");
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<HistoryFilter>("active");
  const [commitResult, setCommitResult] = useState<{ committed: number; failed: number; total: number } | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<AiMappingSuggestion[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Include archived/deleted only when the user wants to see them
  const includeArchived = filter === "all" || filter === "archived";
  const includeDeleted  = filter === "all" || filter === "deleted";

  const { data: batches = [], isLoading: batchesLoading } = useQuery<ImportBatch[]>({
    queryKey: ["import-batches", { includeArchived, includeDeleted }],
    staleTime: 10_000,
    queryFn: () => listBatches({ includeArchived, includeDeleted }),
    enabled: canAccess,
  });

  const { data: activeBatch } = useQuery({
    queryKey: ["import-batch", activeBatchId],
    staleTime: 10_000,
    queryFn: () => (activeBatchId ? getBatch(activeBatchId) : null),
    enabled: canAccess && !!activeBatchId,
    refetchInterval: busy ? 3000 : false,
  });

  const { data: mappings = [] } = useQuery({
    queryKey: ["import-mappings", activeBatchId],
    queryFn: () => (activeBatchId ? getMappings(activeBatchId) : []),
    enabled: canAccess && !!activeBatchId,
  });

  const { data: errors = [] } = useQuery({
    queryKey: ["import-errors", activeBatchId],
    queryFn: () => (activeBatchId ? getImportErrors(activeBatchId) : []),
    enabled: canAccess && !!activeBatchId && (tab === "validation" || tab === "result"),
  });

  const { data: dupes = [] } = useQuery({
    queryKey: ["import-dupes", activeBatchId],
    queryFn: () => (activeBatchId ? getDuplicateCandidates(activeBatchId) : []),
    enabled: canAccess && !!activeBatchId && (tab === "duplicates" || tab === "result"),
  });

  const { data: files = [] } = useQuery({
    queryKey: ["import-files", activeBatchId],
    queryFn: () => (activeBatchId ? getImportFiles(activeBatchId) : []),
    enabled: canAccess && !!activeBatchId,
  });

  const { data: rows = [] } = useQuery<ImportRow[]>({
    queryKey: ["import-rows", activeBatchId],
    queryFn: () => (activeBatchId ? getImportRows(activeBatchId, { includeDeleted: true }) : Promise.resolve([])),
    enabled: canAccess && !!activeBatchId && (tab === "rows" || tab === "staged"),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["import-batches"] });
    if (activeBatchId) {
      qc.invalidateQueries({ queryKey: ["import-batch", activeBatchId] });
      qc.invalidateQueries({ queryKey: ["import-errors", activeBatchId] });
      qc.invalidateQueries({ queryKey: ["import-dupes", activeBatchId] });
      qc.invalidateQueries({ queryKey: ["import-files", activeBatchId] });
      qc.invalidateQueries({ queryKey: ["import-mappings", activeBatchId] });
      qc.invalidateQueries({ queryKey: ["import-rows", activeBatchId] });
    }
  };

  if (!canAccess) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="max-w-md text-center">
          <ShieldCheck className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-4 text-lg font-medium text-foreground">{t("import_blocked")}</p>
        </div>
      </div>
    );
  }

  // -- Handlers ----------------------------------------------------------------

  const handleNewBatch = async () => {
    try {
      setBusy(true);
      const batch = await createBatch();
      setActiveBatchId(batch.id);
      setTab("upload");
      toast.success("New import batch created");
    } catch (e: any) {
      toast.error(t("toast_error") + e.message);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!activeBatchId) return;
    try {
      setBusy(true);
      const { fileId } = await uploadImportFile(activeBatchId, file);
      toast.success(`Uploaded ${file.name}`);
      await parseFile(activeBatchId, fileId);
      setTab("mapping");
      toast.success("File parsed — AI is suggesting column mappings…");
      // Kick off AI mapping suggestions in the background (non-blocking)
      setAiLoading(true);
      suggestImportMappings(activeBatchId)
        .then((suggestions) => {
          setAiSuggestions(suggestions);
          if (suggestions && suggestions.length > 0) {
            toast.success("AI mapping suggestions ready — review below");
          }
        })
        .catch(() => { /* AI unavailable — silent fallback to manual mapping */ })
        .finally(() => setAiLoading(false));
    } catch (e: any) {
      toast.error(t("toast_error") + e.message);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const handleValidate = async () => {
    if (!activeBatchId) return;
    try {
      setBusy(true);
      await validateBatch(activeBatchId);
      setTab("validation");
      toast.success("Validation complete");
    } catch (e: any) {
      toast.error(t("toast_error") + e.message);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const handleDetectDupes = async () => {
    if (!activeBatchId) return;
    try {
      setBusy(true);
      await detectDuplicates(activeBatchId);
      setTab("duplicates");
      toast.success("Duplicate detection complete");
    } catch (e: any) {
      toast.error(t("toast_error") + e.message);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const handleApprove = async () => {
    if (!activeBatchId) return;
    try {
      setBusy(true);
      await approveBatch(activeBatchId);
      setTab("approval");
      toast.success("Batch approved");
    } catch (e: any) {
      toast.error(t("toast_error") + e.message);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const handleDryRun = async () => {
    if (!activeBatchId) return;
    try {
      setBusy(true);
      await dryRunCommit(activeBatchId);
      setTab("result");
      toast.success("Dry-run complete — no real CRM records were created");
    } catch (e: any) {
      toast.error(t("toast_error") + e.message);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const handleCommit = async () => {
    if (!activeBatchId) return;
    if (!window.confirm(t("import_commit_confirm" as any))) return;
    try {
      setBusy(true);
      const result = await commitBatch(activeBatchId);
      setCommitResult(result);
      toast.success(`Committed ${result.committed} record(s) to CRM`);
    } catch (e: any) {
      toast.error(t("toast_error") + e.message);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const handleCancel = async () => {
    if (!activeBatchId) return;
    try {
      await cancelBatch(activeBatchId);
      setActiveBatchId(null);
      setTab("history");
      toast.success("Batch cancelled");
    } catch (e: any) {
      toast.error(t("toast_error") + e.message);
    } finally {
      refresh();
    }
  };

  const openBatch = (id: string) => {
    setActiveBatchId(id);
    setTab("overview");
  };

  // -- Row edit handlers -----------------------------------------------------

  const handleRowEdit = async (rowId: string, raw_data: Record<string, unknown>) => {
    try {
      await updateImportRow(rowId, { raw_data });
      toast.success("Row updated. Re-run validation to refresh results.");
      qc.invalidateQueries({ queryKey: ["import-rows", activeBatchId] });
      qc.invalidateQueries({ queryKey: ["import-batch", activeBatchId] });
    } catch (e: any) {
      toast.error(t("toast_error") + e.message);
    }
  };

  const handleRowExclude = async (rowId: string) => {
    try {
      await excludeImportRow(rowId);
      toast.success("Row excluded from batch");
      qc.invalidateQueries({ queryKey: ["import-rows", activeBatchId] });
    } catch (e: any) {
      toast.error(t("toast_error") + e.message);
    }
  };

  const handleRowRestore = async (rowId: string) => {
    try {
      await restoreImportRow(rowId);
      toast.success("Row restored");
      qc.invalidateQueries({ queryKey: ["import-rows", activeBatchId] });
    } catch (e: any) {
      toast.error(t("toast_error") + e.message);
    }
  };

  // -- Batch lifecycle handlers ---------------------------------------------

  const handleArchive = async (id: string) => {
    try {
      await archiveImportBatch(id);
      toast.success("Batch archived");
      refresh();
    } catch (e: any) { toast.error(t("toast_error") + e.message); }
  };

  const handleSoftDelete = async (id: string, reason: string) => {
    try {
      await softDeleteImportBatch(id, reason);
      toast.success("Batch deleted");
      if (id === activeBatchId) { setActiveBatchId(null); setTab("history"); }
      refresh();
    } catch (e: any) { toast.error(t("toast_error") + e.message); }
  };

  const handlePurge = async (id: string) => {
    try {
      setBusy(true);
      await purgeImportBatch(id, "DELETE");
      toast.success("Batch permanently purged");
      if (id === activeBatchId) { setActiveBatchId(null); setTab("history"); }
      refresh();
    } catch (e: any) {
      toast.error(t("toast_error") + e.message);
    } finally { setBusy(false); }
  };

  // Filter batches according to the History filter selection
  const visibleBatches = useMemo(() => filterBatches(batches, filter), [batches, filter]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
      <PageHeader
        eyebrow="PHC · Import"
        title={t("import_title")}
        description={t("import_desc")}
        actions={
          <button
            onClick={handleNewBatch}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {t("import_new_batch")}
          </button>
        }
      />

      <div className="mb-6 rounded-md border border-amber/30 bg-amber/5 px-4 py-3 text-sm text-amber">
        {t("import_dry_run_note")}
      </div>

      {isSystemAdmin && !canApprove && (
        <div className="mb-6 rounded-md border border-muted bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          {t("import_no_approve")}
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-6 flex flex-wrap gap-1">
          <TabsTrigger value="history"><History className="mr-1.5 h-3.5 w-3.5" />History</TabsTrigger>
          <TabsTrigger value="overview" disabled={!activeBatchId}><FileText className="mr-1.5 h-3.5 w-3.5" />Overview</TabsTrigger>
          <TabsTrigger value="upload" disabled={!activeBatchId}><Upload className="mr-1.5 h-3.5 w-3.5" />Upload</TabsTrigger>
          <TabsTrigger value="mapping" disabled={!activeBatchId}><FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />Mapping</TabsTrigger>
          <TabsTrigger value="rows" disabled={!activeBatchId}><Pencil className="mr-1.5 h-3.5 w-3.5" />Rows</TabsTrigger>
          <TabsTrigger value="staged" disabled={!activeBatchId}><Layers className="mr-1.5 h-3.5 w-3.5" />Staged</TabsTrigger>
          <TabsTrigger value="validation" disabled={!activeBatchId}><AlertTriangle className="mr-1.5 h-3.5 w-3.5" />Validation</TabsTrigger>
          <TabsTrigger value="duplicates" disabled={!activeBatchId}><Copy className="mr-1.5 h-3.5 w-3.5" />Duplicates</TabsTrigger>
          <TabsTrigger value="file" disabled={!activeBatchId}><Files className="mr-1.5 h-3.5 w-3.5" />Original File</TabsTrigger>
          <TabsTrigger value="checklist" disabled={!activeBatchId}><ListChecks className="mr-1.5 h-3.5 w-3.5" />Checklist</TabsTrigger>
          <TabsTrigger value="approval" disabled={!activeBatchId}><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Approval</TabsTrigger>
          <TabsTrigger value="result" disabled={!activeBatchId}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Result</TabsTrigger>
          <TabsTrigger value="activity" disabled={!activeBatchId}><ActivityIcon className="mr-1.5 h-3.5 w-3.5" />Activity</TabsTrigger>
          <TabsTrigger value="analysis" disabled={!activeBatchId}><BarChart3 className="mr-1.5 h-3.5 w-3.5" />Analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="history">
          <HistoryTab
            batches={visibleBatches}
            loading={batchesLoading}
            filter={filter}
            onFilter={setFilter}
            onOpen={openBatch}
            onArchive={handleArchive}
            onSoftDelete={handleSoftDelete}
            onPurge={handlePurge}
            isSystemAdmin={isSystemAdmin}
          />
        </TabsContent>

        <TabsContent value="overview">
          <OverviewTab
            batch={activeBatch}
            files={files}
            onUpdate={async (patch) => {
              if (!activeBatchId) return;
              try { await updateBatch(activeBatchId, patch); toast.success("Batch updated"); refresh(); }
              catch (e: any) { toast.error(t("toast_error") + e.message); }
            }}
          />
        </TabsContent>

        <TabsContent value="upload">
          <UploadTab
            batch={activeBatch}
            busy={busy}
            onUpload={handleFileUpload}
            onCancel={handleCancel}
            files={files}
            t={t}
          />
        </TabsContent>

        <TabsContent value="mapping">
          <MappingTab
            batch={activeBatch}
            files={files}
            mappings={mappings}
            onSave={async (m) => {
              if (!activeBatchId) return;
              try {
                setBusy(true);
                const saved = await saveMappings(activeBatchId, m);
                qc.setQueryData(["import-mappings", activeBatchId], saved);
                toast.success("Column mappings saved.");
                refresh();
                return saved;
              } catch (e: any) {
                toast.error(t("toast_error") + e.message);
                throw e;
              } finally {
                setBusy(false);
              }
            }}
            onValidate={handleValidate}
            busy={busy}
            t={t}
            aiSuggestions={aiSuggestions}
            aiLoading={aiLoading}
          />
        </TabsContent>

        <TabsContent value="rows">
          <RowsTab
            batch={activeBatch}
            rows={rows}
            files={files}
            onEdit={handleRowEdit}
            onExclude={handleRowExclude}
            onRestore={handleRowRestore}
            onRevalidate={handleValidate}
            busy={busy}
          />
        </TabsContent>

        <TabsContent value="validation">
          <ValidationTab
            batch={activeBatch}
            errors={errors}
            onDetectDupes={handleDetectDupes}
            onDownload={() => activeBatchId && downloadReport(activeBatchId, "validation_errors")}
            busy={busy}
            t={t}
          />
        </TabsContent>

        <TabsContent value="duplicates">
          <DuplicatesTab
            batch={activeBatch}
            dupes={dupes}
            onResolve={async (id, res) => {
              try { await resolveDuplicate(id, res); refresh(); }
              catch (e: any) { toast.error(t("toast_error") + e.message); }
            }}
            onProceedToApproval={() => setTab("approval")}
            onDownload={() => activeBatchId && downloadReport(activeBatchId, "duplicate_candidates")}
            busy={busy}
            t={t}
          />
        </TabsContent>

        <TabsContent value="approval">
          <ApprovalTab
            batch={activeBatch}
            canApprove={canApprove}
            isSystemAdmin={isSystemAdmin}
            onApprove={handleApprove}
            onDryRun={handleDryRun}
            busy={busy}
            t={t}
          />
        </TabsContent>

        <TabsContent value="staged">
          {activeBatchId ? <StagedTab batchId={activeBatchId} /> : null}
        </TabsContent>

        <TabsContent value="file">
          {activeBatchId ? <OriginalFileTab batchId={activeBatchId} /> : null}
        </TabsContent>

        <TabsContent value="checklist">
          {activeBatch ? <ChecklistTab batch={activeBatch} /> : null}
        </TabsContent>

        <TabsContent value="result">
          <ResultTab
            batch={activeBatch}
            onDownloadSummary={(fmt) => activeBatchId && downloadReport(activeBatchId, "import_summary", fmt)}
            onDownloadErrors={(fmt) => activeBatchId && downloadReport(activeBatchId, "validation_errors", fmt)}
            onDownloadDupes={(fmt) => activeBatchId && downloadReport(activeBatchId, "duplicate_candidates", fmt)}
            canApprove={canApprove}
            onCommit={handleCommit}
            commitResult={commitResult}
            busy={busy}
            t={t}
          />
        </TabsContent>

        <TabsContent value="activity">
          {activeBatchId ? <ActivityTab batchId={activeBatchId} /> : null}
        </TabsContent>

        <TabsContent value="analysis">
          <AnalysisTab batch={activeBatch} t={t} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// =============================================================================
// Phase 1.1 readiness — new tabs (staging + display only; NO live CRM writes)
// =============================================================================

const STAGED_GROUP_LABELS: Record<StagedGroup, string> = {
  companies: "Companies staged",
  contacts: "Contacts staged",
  opportunities: "Opportunities / Leads staged",
  projects: "Projects staged",
  rfq_tender: "RFQ / Tender staged",
  unmapped: "Unmapped fields",
};

function StagedTab({ batchId }: { batchId: string }) {
  const { t } = useI18n();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["import-rows-staged", batchId],
    queryFn: () => getImportRows(batchId, { limit: 1000 }),
  });
  const active = rows.filter((r) => !r.is_excluded && r.row_status !== "deleted" && r.row_status !== "excluded");
  const groups: Record<StagedGroup, ImportRow[]> = {
    companies: [], contacts: [], opportunities: [], projects: [], rfq_tender: [], unmapped: [],
  };
  for (const r of active) {
    for (const g of stagedGroupsForRow(r.mapped_data ?? r.raw_data)) groups[g].push(r);
  }
  if (isLoading) return <SkeletonTable rows={4} />;
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-[11px] text-amber-light">
        {t("import_staging_only_warning" as any)}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {(Object.keys(groups) as StagedGroup[]).map((g) => (
          <div key={g} className="rounded-lg border border-border/70 bg-surface/60 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{STAGED_GROUP_LABELS[g]}</span>
              <StatusPill tone={groups[g].length ? "neutral" : "muted"}>{groups[g].length} rows</StatusPill>
            </div>
            <div className="text-xs text-muted-foreground">
              {groups[g].length ? `${groups[g].length} staged row(s) would map to ${g}.` : "—"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OriginalFileTab({ batchId }: { batchId: string }) {
  const { data: files = [], isLoading } = useQuery({
    queryKey: ["import-files", batchId],
    queryFn: () => getImportFiles(batchId),
  });
  if (isLoading) return <SkeletonTable rows={3} />;
  if (!files.length) return <div className="text-sm text-muted-foreground">No file uploaded for this batch.</div>;
  return (
    <div className="space-y-3">
      {files.map((f: any) => (
        <div key={f.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-surface/60 p-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{f.file_name}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {f.file_type?.toUpperCase()} · {Math.round((f.file_size_bytes ?? 0) / 1024)} KB · {f.row_count ?? "—"} rows
            </div>
          </div>
          <button
            onClick={async () => {
              try { const url = await getFileDownloadUrl(f.storage_path); window.open(url, "_blank"); }
              catch (e) { toast.error(e instanceof Error ? e.message : "Download failed"); }
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" /> Download original file
          </button>
        </div>
      ))}
    </div>
  );
}

function ChecklistTab({ batch }: { batch: ImportBatch }) {
  const qc = useQueryClient();
  const auto = deriveAutoChecklist(batch);
  const { data: saved = {} } = useQuery({
    queryKey: ["import-checklist", batch.id],
    queryFn: () => getReadinessChecklist(batch.id),
  });
  const state: ReadinessChecklist = { ...saved, ...auto };
  const toggle = async (key: string, val: boolean) => {
    const next = { ...saved, [key]: val };
    await saveReadinessChecklist(batch.id, next);
    qc.invalidateQueries({ queryKey: ["import-checklist", batch.id] });
  };
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border/70 bg-surface/60 px-4 py-3 text-sm text-foreground">
        Real-data operation checklist — complete before any future commit. Auto items reflect batch state; manual items are your confirmation.
      </div>
      <ul className="space-y-2">
        {READINESS_ITEMS.map((item) => {
          const checked = !!state[item.key];
          return (
            <li key={item.key} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 px-4 py-2.5">
              <span className="flex items-center gap-2 text-sm text-foreground">
                {checked ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <div className="h-4 w-4 rounded-full border border-border" />}
                {item.label}
              </span>
              {item.manual ? (
                <input type="checkbox" checked={checked} onChange={(e) => toggle(item.key, e.target.checked)} className="h-4 w-4" />
              ) : (
                <StatusPill tone={checked ? "positive" : "muted"}>{checked ? "auto ✓" : "pending"}</StatusPill>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ActivityTab({ batchId }: { batchId: string }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["import-activity", batchId],
    queryFn: () => getBatchActivity(batchId),
  });
  if (isLoading) return <SkeletonTable rows={4} />;
  if (!rows.length) return <div className="text-sm text-muted-foreground">No activity recorded yet.</div>;
  return (
    <ul className="space-y-1.5 text-xs">
      {rows.map((r: any) => (
        <li key={r.id} className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background/40 px-3 py-2">
          <span className="font-medium text-foreground">{r.action}</span>
          <span className="text-muted-foreground">{new Date(r.created_at ?? r.timestamp).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function filterBatches(batches: ImportBatch[], f: HistoryFilter): ImportBatch[] {
  switch (f) {
    case "all":      return batches;
    case "archived": return batches.filter((b) => !!b.archived_at);
    case "deleted":  return batches.filter((b) => !!b.deleted_at);
    case "parsed":            return batches.filter((b) => b.status === "mapping" || b.status === "validating");
    case "needs_mapping":     return batches.filter((b) => b.status === "mapping");
    case "validation_failed": return batches.filter((b) => b.error_rows > 0);
    case "dry_run":           return batches.filter((b) => b.status === "dry_run");
    case "active":
    default:
      return batches.filter((b) => !b.archived_at && !b.deleted_at);
  }
}

// =============================================================================
// History
// =============================================================================

const FILTER_OPTIONS: { value: HistoryFilter; label: string }[] = [
  { value: "active",            label: "Active" },
  { value: "all",               label: "All" },
  { value: "parsed",            label: "Parsed" },
  { value: "needs_mapping",     label: "Needs Mapping" },
  { value: "validation_failed", label: "Validation Failed" },
  { value: "dry_run",           label: "Dry-run Completed" },
  { value: "archived",          label: "Archived" },
  { value: "deleted",           label: "Deleted" },
];

function HistoryTab({
  batches, loading, filter, onFilter, onOpen, onArchive, onSoftDelete, onPurge, isSystemAdmin,
}: {
  batches: ImportBatch[];
  loading: boolean;
  filter: HistoryFilter;
  onFilter: (f: HistoryFilter) => void;
  onOpen: (id: string) => void;
  onArchive: (id: string) => void;
  onSoftDelete: (id: string, reason: string) => void;
  onPurge: (id: string) => void;
  isSystemAdmin: boolean;
}) {
  const [confirm, setConfirm] = useState<{
    kind: "archive" | "delete" | "purge"; batch: ImportBatch;
  } | null>(null);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-1.5">
        {FILTER_OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => onFilter(o.value)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filter === o.value
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-surface text-muted-foreground hover:bg-muted"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonTable rows={5} />
      ) : batches.length === 0 ? (
        <EmptyState message="No import batches match this filter." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium">Target</th>
                <th className="px-3 py-2 font-medium">Uploaded</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 text-right font-medium">Valid</th>
                <th className="px-3 py-2 text-right font-medium">Errors</th>
                <th className="px-3 py-2 text-right font-medium">Dupes</th>
                <th className="px-3 py-2 font-medium">Updated</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr
                  key={b.id}
                  className={`border-b border-border last:border-0 ${b.deleted_at ? "opacity-60" : ""}`}
                >
                  <td className="px-3 py-2">
                    <button
                      onClick={() => onOpen(b.id)}
                      className="text-left text-sm font-medium text-foreground hover:underline"
                    >
                      {b.file_name ?? <span className="text-muted-foreground">(no file)</span>}
                    </button>
                    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{b.id.slice(0, 8)}…</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{b.target_entity}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(b.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill tone={statusTone(b.status)}>{b.status}</StatusPill>
                    {b.archived_at && <span className="ml-1 text-[10px] text-muted-foreground">·archived</span>}
                    {b.deleted_at && <span className="ml-1 text-[10px] text-danger">·deleted</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{b.total_rows}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-positive">{b.valid_rows}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-danger">{b.error_rows}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-amber">{b.duplicate_rows}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(b.updated_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => onOpen(b.id)}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Open batch"
                      >
                        <FileText className="h-3.5 w-3.5" />
                      </button>
                      {!b.archived_at && !b.deleted_at && (
                        <button
                          onClick={() => setConfirm({ kind: "archive", batch: b })}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="Archive"
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {!b.deleted_at && (
                        <button
                          onClick={() => setConfirm({ kind: "delete", batch: b })}
                          className="rounded p-1 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                          title="Delete (soft)"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {isSystemAdmin && (
                        <button
                          onClick={() => setConfirm({ kind: "purge", batch: b })}
                          className="rounded p-1 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                          title="Permanent purge (system_admin only)"
                        >
                          <Flame className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        state={confirm}
        onClose={() => setConfirm(null)}
        onArchive={onArchive}
        onSoftDelete={onSoftDelete}
        onPurge={onPurge}
      />
    </div>
  );
}

function ConfirmDialog({
  state, onClose, onArchive, onSoftDelete, onPurge,
}: {
  state: { kind: "archive" | "delete" | "purge"; batch: ImportBatch } | null;
  onClose: () => void;
  onArchive: (id: string) => void;
  onSoftDelete: (id: string, reason: string) => void;
  onPurge: (id: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");

  useEffect(() => { setReason(""); setTyped(""); }, [state?.batch.id, state?.kind]);

  if (!state) return null;
  const { kind, batch } = state;

  const isPurge = kind === "purge";
  const isDelete = kind === "delete";

  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {kind === "archive" && "Archive this import batch?"}
            {kind === "delete"  && "Delete this import batch?"}
            {kind === "purge"   && "Permanently purge this import batch?"}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <div className="rounded-md border border-border bg-muted/30 p-2 font-mono text-xs">
                {batch.file_name ?? batch.id.slice(0, 8)} · {batch.total_rows} rows · {batch.status}
              </div>
              {kind === "archive" && (
                <p className="text-muted-foreground">
                  Archived batches are hidden from the active history but remain fully recoverable.
                  The uploaded file and all import records are kept.
                </p>
              )}
              {isDelete && (
                <>
                  <p className="text-muted-foreground">
                    Soft-deletes the batch. It stays out of the normal history but the audit trail,
                    file, and rows are preserved. No CRM records are affected (dry-run only).
                  </p>
                  <Textarea
                    placeholder="Reason for deletion (required)"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                  />
                </>
              )}
              {isPurge && (
                <>
                  <p className="text-danger">
                    This is irreversible. It removes the original file from storage and every
                    import_* row for this batch. system_admin only.
                  </p>
                  <p className="text-muted-foreground">
                    Type <span className="font-mono font-semibold">DELETE</span> to confirm:
                  </p>
                  <Input
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder="DELETE"
                    className="font-mono"
                  />
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={(isDelete && !reason.trim()) || (isPurge && typed !== "DELETE")}
            onClick={() => {
              if (kind === "archive")   onArchive(batch.id);
              else if (kind === "delete") onSoftDelete(batch.id, reason);
              else if (kind === "purge")  onPurge(batch.id);
              onClose();
            }}
            className={isPurge || isDelete ? "bg-danger text-danger-foreground hover:bg-danger/90" : ""}
          >
            {kind === "archive" ? "Archive" : isDelete ? "Delete" : "Permanently purge"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// =============================================================================
// Overview
// =============================================================================

function OverviewTab({ batch, files, onUpdate }: {
  batch: ImportBatch | null | undefined;
  files: any[];
  onUpdate: (patch: { target_entity?: ImportTargetEntity; notes?: string }) => Promise<void>;
}) {
  if (!batch) return <EmptyState message="Open a batch from History to see details." />;

  const file = files[0];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard icon={<FileSpreadsheet className="h-4 w-4" />} label="Total rows" value={batch.total_rows} />
        <KpiCard icon={<CheckCircle2 className="h-4 w-4" />} label="Valid" value={batch.valid_rows} />
        <KpiCard icon={<AlertTriangle className="h-4 w-4" />} label="Errors" value={batch.error_rows} />
        <KpiCard icon={<Copy className="h-4 w-4" />} label="Duplicates" value={batch.duplicate_rows} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="text-sm font-medium text-foreground">Batch</h3>
          <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Batch ID</dt>
            <dd className="font-mono text-xs text-foreground">{batch.id}</dd>
            <dt className="text-muted-foreground">File</dt>
            <dd className="text-foreground">{batch.file_name ?? "—"}</dd>
            <dt className="text-muted-foreground">Uploaded</dt>
            <dd className="text-foreground">{new Date(batch.created_at).toLocaleString()}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd><StatusPill tone={statusTone(batch.status)}>{batch.status}</StatusPill></dd>
            <dt className="text-muted-foreground">Target</dt>
            <dd>
              <select
                value={batch.target_entity}
                onChange={(e) => onUpdate({ target_entity: e.target.value as ImportTargetEntity })}
                className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
              >
                {TARGET_ENTITIES.map((te) => (
                  <option key={te.value} value={te.value}>{te.label}</option>
                ))}
              </select>
            </dd>
            <dt className="text-muted-foreground">Dry-run</dt>
            <dd className="text-foreground">Yes (Phase 1 — no CRM writes)</dd>
          </dl>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="text-sm font-medium text-foreground">Original file</h3>
          {file ? (
            <div className="mt-3 space-y-3 text-sm">
              <div className="flex items-center gap-2 text-foreground">
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                {file.file_name}
              </div>
              <div className="text-xs text-muted-foreground">
                {(file.file_size_bytes / 1024).toFixed(1)} KB · {file.file_type} · {file.row_count ?? 0} rows
              </div>
              <button
                onClick={async () => {
                  try {
                    const url = await getFileDownloadUrl(file.storage_path);
                    window.open(url, "_blank");
                  } catch (e: any) { toast.error(e.message); }
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
              >
                <Download className="h-3 w-3" /> Download original
              </button>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No file uploaded yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Upload
// =============================================================================

function UploadTab({ batch, busy, onUpload, onCancel, files, t }: {
  batch: ImportBatch | null | undefined; busy: boolean;
  onUpload: (f: File) => void; onCancel: () => void;
  files: any[]; t: (k: any) => string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onUpload(file);
  }, [onUpload]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
  }, [onUpload]);

  if (!batch) return <EmptyState message={t("import_new_batch")} />;

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors ${
          dragOver ? "border-foreground bg-muted/50" : "border-border hover:border-muted-foreground"
        }`}
      >
        {busy ? <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
              : <Upload className="h-10 w-10 text-muted-foreground" />}
        <p className="mt-4 text-sm text-foreground">{t("import_upload_prompt")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("import_upload_limit")}</p>
        <input ref={fileRef} type="file" accept=".csv,.xlsx" onChange={handleChange} className="hidden" />
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f: any) => (
            <div key={f.id} className="flex items-center gap-3 rounded-md border border-border bg-surface px-4 py-2">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-foreground">{f.file_name}</span>
              <span className="text-xs text-muted-foreground">
                {(f.file_size_bytes / 1024).toFixed(0)} KB
                {f.row_count != null && ` · ${f.row_count} rows`}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={onCancel} className="text-sm text-muted-foreground hover:text-danger">
          <X className="mr-1 inline h-3.5 w-3.5" />{t("import_cancel")}
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Mapping
// =============================================================================

function MappingTab({ batch, files, mappings, onSave, onValidate, busy, t, aiSuggestions, aiLoading }: {
  batch: ImportBatch | null | undefined;
  files: any[];
  mappings: ImportMapping[];
  onSave: (m: Omit<ImportMapping, "id" | "batch_id">[]) => Promise<ImportMapping[] | void>;
  onValidate: () => Promise<void>;
  busy: boolean;
  t: (k: any) => string;
  aiSuggestions?: AiMappingSuggestion[] | null;
  aiLoading?: boolean;
}) {
  const columns: string[] = files[0]?.column_names ?? [];
  const targetColumns = getTargetColumns(batch?.target_entity ?? "companies");

  type Row = { source: string; target: string; isKey: boolean; aiSuggested?: boolean; aiConfidence?: number };
  const [draft, setDraft] = useState<Row[]>([]);

  const columnsKey = columns.join("|");
  const mappingsKey = mappings.map((m) => `${m.source_column}=${m.target_column}:${m.is_key}`).join("|");
  const suggestionsKey = aiSuggestions?.map((s) => `${s.sourceColumn}=${s.suggestedTarget}`).join("|") ?? "";

  useEffect(() => {
    const byCol = new Map<string, { target: string; isKey: boolean }>();
    for (const m of mappings) byCol.set(m.source_column, { target: m.target_column, isKey: m.is_key });

    // Build suggestion index (only if no saved mapping exists for this column)
    const aiByCol = new Map<string, AiMappingSuggestion>();
    for (const s of (aiSuggestions ?? [])) aiByCol.set(s.sourceColumn, s);

    setDraft(columns.map((c) => {
      const saved = byCol.get(c);
      if (saved) return { source: c, target: saved.target, isKey: saved.isKey };
      const ai = aiByCol.get(c);
      if (ai) return {
        source: c,
        target: ai.suggestedTarget,
        isKey: ai.isKey,
        aiSuggested: true,
        aiConfidence: ai.confidence,
      };
      return { source: c, target: "", isKey: false };
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnsKey, mappingsKey, suggestionsKey]);

  if (!batch || columns.length === 0) {
    return <EmptyState message={t("import_tab_upload")} />;
  }

  const updateRow = (idx: number, patch: Partial<Row>) =>
    setDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch, aiSuggested: false } : r)));

  /** Accept all AI suggestions at once */
  const acceptAllAi = () => {
    if (!aiSuggestions) return;
    const aiByCol = new Map(aiSuggestions.map((s) => [s.sourceColumn, s]));
    setDraft((prev) => prev.map((r) => {
      const ai = aiByCol.get(r.source);
      if (!ai) return r;
      return { ...r, target: ai.suggestedTarget, isKey: ai.isKey, aiSuggested: true, aiConfidence: ai.confidence };
    }));
  };

  /** Set all currently-unmapped columns to extra_data */
  const fillUnmappedAsExtra = () => {
    setDraft((prev) => prev.map((r) =>
      (!r.target || r.target === "") ? { ...r, target: EXTRA_DATA_SENTINEL } : r,
    ));
  };

  const buildPayload = () => {
    const seen = new Set<string>();
    return draft
      .filter((r) => {
        const source = r.source.trim();
        if (!r.target || r.target === "__skip__" || !source) return false;
        if (seen.has(source)) return false;
        seen.add(source);
        return true;
      })
      .map((r) => ({
        source_column: r.source.trim(),
        target_table: batch.target_entity,
        target_column: r.target.trim(),
        transform: null,
        is_key: r.isKey,
      }));
  };

  const validDraftCount = buildPayload().length;
  const canValidate = validDraftCount > 0 || mappings.length > 0;
  const hasUnsavedDraft = validDraftCount > 0;
  const aiSuggestedCount = draft.filter((r) => r.aiSuggested).length;
  const unmappedCount = draft.filter((r) => !r.target || r.target === "").length;

  const handleSave = async () => {
    const mapped = buildPayload();
    if (mapped.length === 0) {
      toast.error(t("toast_error") + "select a target field for at least one column");
      return;
    }
    const saved = await onSave(mapped);
    if (saved && saved.length === 0) {
      toast.error(t("toast_error") + "select a target field for at least one column");
    }
  };

  const handleValidateClick = async () => {
    const mapped = buildPayload();
    if (mapped.length === 0 && mappings.length === 0) {
      toast.error(t("toast_error") + "select a target field for at least one column");
      return;
    }
    if (mapped.length > 0) {
      const saved = await onSave(mapped);
      if (saved && saved.length === 0) return;
    }
    await onValidate();
  };

  return (
    <div className="space-y-4">
      {/* AI banner */}
      {aiLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-amber/30 bg-amber/10 px-4 py-2.5 text-sm text-amber-foreground">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          AI is analyzing your columns…
        </div>
      )}
      {!aiLoading && aiSuggestions && aiSuggestions.length > 0 && (
        <div className="rounded-lg border border-amber/30 bg-amber/10 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-amber-foreground">
              AI suggested mappings for <strong>{aiSuggestions.length}</strong> column{aiSuggestions.length !== 1 ? "s" : ""}.
              {aiSuggestedCount > 0 && <span className="ml-1 text-muted-foreground">({aiSuggestedCount} applied)</span>}
            </span>
            <div className="flex gap-2">
              <button
                onClick={acceptAllAi}
                className="rounded-md bg-amber/20 px-3 py-1 text-xs font-medium text-amber-foreground hover:bg-amber/30"
              >
                Accept All AI Suggestions
              </button>
              {unmappedCount > 0 && (
                <button
                  onClick={fillUnmappedAsExtra}
                  className="rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-muted"
                >
                  Keep remaining {unmappedCount} as Additional Data
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mapping table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">{t("import_source_col")}</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">{t("import_target_col")}</th>
              <th className="px-4 py-2 text-center font-medium text-muted-foreground">{t("import_key_field")}</th>
            </tr>
          </thead>
          <tbody>
            {draft.map((row, idx) => (
              <tr key={idx} className={`border-b border-border last:border-0 ${row.aiSuggested ? "bg-amber/5" : ""}`}>
                <td className="px-4 py-2">
                  <span className="font-mono text-xs text-foreground">
                    {row.source || <span className="text-muted-foreground">(column {idx + 1})</span>}
                  </span>
                  {row.aiSuggested && row.aiConfidence != null && (
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      row.aiConfidence >= 0.8 ? "bg-emerald-500/15 text-emerald-400" :
                      row.aiConfidence >= 0.5 ? "bg-amber/20 text-amber-foreground" :
                      "bg-muted text-muted-foreground"
                    }`}>
                      AI {Math.round(row.aiConfidence * 100)}%
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <select
                    value={row.target}
                    onChange={(e) => updateRow(idx, { target: e.target.value })}
                    className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                  >
                    <option value="">— skip —</option>
                    {targetColumns.map((tc) => (
                      <option key={tc.value} value={tc.value}>{tc.label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={row.isKey}
                    onChange={(e) => updateRow(idx, { isKey: e.target.checked })}
                    className="h-4 w-4 rounded border-border"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleSave}
          disabled={busy || validDraftCount === 0}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {t("import_save_mapping")}
        </button>
        <button
          onClick={handleValidateClick}
          disabled={busy || batch.status === "uploading" || !canValidate}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
        >
          {busy ? t("import_validating") : hasUnsavedDraft ? "Save & Validate" : t("import_validate")}
        </button>
        {hasUnsavedDraft && (
          <span className="text-xs text-muted-foreground">Unsaved mappings will be saved before validation.</span>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Rows (parsed row editing)
// =============================================================================

function RowsTab({ batch, rows, files, onEdit, onExclude, onRestore, onRevalidate, busy }: {
  batch: ImportBatch | null | undefined;
  rows: ImportRow[];
  files: any[];
  onEdit: (rowId: string, raw_data: Record<string, unknown>) => Promise<void>;
  onExclude: (rowId: string) => Promise<void>;
  onRestore: (rowId: string) => Promise<void>;
  onRevalidate: () => Promise<void>;
  busy: boolean;
}) {
  const columns: string[] = files[0]?.column_names ?? [];
  const [editing, setEditing] = useState<{ rowId: string; draft: Record<string, string> } | null>(null);

  if (!batch) return <EmptyState message="Open a batch first." />;
  if (rows.length === 0) return <EmptyState message="No parsed rows yet — upload a file to parse it." />;

  const activeCount   = rows.filter((r) => r.row_status === "active").length;
  const editedCount   = rows.filter((r) => r.row_status === "edited").length;
  const excludedCount = rows.filter((r) => r.row_status === "excluded" || r.row_status === "deleted").length;

  const startEdit = (row: ImportRow) => {
    const raw = (row.raw_data ?? {}) as Record<string, unknown>;
    const draft: Record<string, string> = {};
    for (const c of columns) draft[c] = raw[c] != null ? String(raw[c]) : "";
    setEditing({ rowId: row.id, draft });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(editing.draft)) patch[k] = v === "" ? null : v;
    await onEdit(editing.rowId, patch);
    setEditing(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 text-xs">
          <StatusPill tone="neutral">Active: {activeCount}</StatusPill>
          <StatusPill tone="attention">Edited: {editedCount}</StatusPill>
          <StatusPill tone="danger">Excluded: {excludedCount}</StatusPill>
        </div>
        <button
          onClick={onRevalidate}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          <RotateCcw className="h-3 w-3" /> Re-run validation
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="w-12 px-2 py-2 text-left text-xs font-medium text-muted-foreground">#</th>
              {columns.map((c) => (
                <th key={c} className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">{c}</th>
              ))}
              <th className="w-24 px-2 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
              <th className="w-28 px-2 py-2 text-right text-xs font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isExcluded = row.is_excluded || row.row_status === "excluded" || row.row_status === "deleted";
              const isEdit = editing?.rowId === row.id;
              const raw = (row.raw_data ?? {}) as Record<string, unknown>;
              return (
                <tr
                  key={row.id}
                  className={`border-b border-border last:border-0 ${
                    isExcluded ? "opacity-50 line-through"
                      : row.row_status === "edited" ? "bg-amber/5" : ""
                  }`}
                >
                  <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground">{row.row_number}</td>
                  {columns.map((c) => (
                    <td key={c} className="px-2 py-1.5 text-xs">
                      {isEdit ? (
                        <input
                          value={editing.draft[c] ?? ""}
                          onChange={(e) => setEditing({
                            ...editing,
                            draft: { ...editing.draft, [c]: e.target.value },
                          })}
                          className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-xs"
                        />
                      ) : (
                        <span className="text-foreground">{raw[c] != null ? String(raw[c]) : <span className="text-muted-foreground">—</span>}</span>
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {row.row_status}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex justify-end gap-1">
                      {isEdit ? (
                        <>
                          <button
                            onClick={saveEdit}
                            className="rounded p-1 text-positive hover:bg-positive/10"
                            title="Save row"
                          >
                            <Save className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setEditing(null)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted"
                            title="Cancel"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : isExcluded ? (
                        <button
                          onClick={() => onRestore(row.id)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="Restore row"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(row)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="Edit row"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => onExclude(row.id)}
                            className="rounded p-1 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                            title="Exclude from batch"
                          >
                            <Ban className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Edits and exclusions only affect this import batch. Excluded rows are skipped by validation and dry-run.
        No CRM records are modified.
      </p>
    </div>
  );
}

// =============================================================================
// Validation
// =============================================================================

function ValidationTab({ batch, errors, onDetectDupes, onDownload, busy, t }: {
  batch: ImportBatch | null | undefined;
  errors: any[];
  onDetectDupes: () => void;
  onDownload: () => void;
  busy: boolean;
  t: (k: any) => string;
}) {
  if (!batch) return <EmptyState message={t("import_tab_mapping")} />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard icon={<FileSpreadsheet className="h-4 w-4" />} label={t("import_rows_total")} value={batch.total_rows} />
        <KpiCard icon={<CheckCircle2 className="h-4 w-4" />} label={t("import_rows_valid")} value={batch.valid_rows} />
        <KpiCard icon={<AlertTriangle className="h-4 w-4" />} label={t("import_rows_errors")} value={batch.error_rows} />
        <KpiCard icon={<Copy className="h-4 w-4" />} label={t("import_rows_dupes")} value={batch.duplicate_rows} />
      </div>

      {errors.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Row</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Column</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Type</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Message</th>
              </tr>
            </thead>
            <tbody>
              {errors.slice(0, 100).map((e: any) => (
                <tr key={e.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{e.row_number}</td>
                  <td className="px-3 py-2 text-xs">{e.column_name}</td>
                  <td className="px-3 py-2"><StatusPill tone={e.severity === "error" ? "danger" : "attention"}>{e.error_type}</StatusPill></td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {errors.length > 100 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Showing 100 of {errors.length} errors
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onDetectDupes}
          disabled={busy}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {busy ? t("import_detecting") : t("import_detect_dupes")}
        </button>
        <button
          onClick={onDownload}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          <Download className="h-3.5 w-3.5" />{t("import_download_errors")}
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Duplicates
// =============================================================================

function DuplicatesTab({ batch, dupes, onResolve, onProceedToApproval, onDownload, busy, t }: {
  batch: ImportBatch | null | undefined;
  dupes: any[];
  onResolve: (id: string, res: "skip" | "merge" | "create_new") => Promise<void>;
  onProceedToApproval: () => void;
  onDownload: () => void;
  busy: boolean;
  t: (k: any) => string;
}) {
  if (!batch) return <EmptyState message={t("import_tab_validation")} />;

  return (
    <div className="space-y-6">
      {dupes.length === 0 ? (
        <EmptyState message="No duplicates found" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t("import_match_type")}</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t("import_confidence")}</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Existing ID</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Resolution</th>
              </tr>
            </thead>
            <tbody>
              {dupes.slice(0, 100).map((d: any) => (
                <tr key={d.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2"><StatusPill tone="attention">{d.match_type}</StatusPill></td>
                  <td className="px-3 py-2 font-mono text-xs">{d.confidence}%</td>
                  <td className="px-3 py-2 font-mono text-xs">{d.existing_record_id?.slice(0, 8)}…</td>
                  <td className="px-3 py-2">
                    {d.resolution === "pending" ? (
                      <div className="flex gap-1">
                        <button onClick={() => onResolve(d.id, "skip")} className="rounded bg-muted px-2 py-0.5 text-xs hover:bg-muted/80">{t("import_resolution_skip")}</button>
                        <button onClick={() => onResolve(d.id, "merge")} className="rounded bg-muted px-2 py-0.5 text-xs hover:bg-muted/80">{t("import_resolution_merge")}</button>
                        <button onClick={() => onResolve(d.id, "create_new")} className="rounded bg-muted px-2 py-0.5 text-xs hover:bg-muted/80">{t("import_resolution_create")}</button>
                      </div>
                    ) : (
                      <StatusPill tone="positive">{d.resolution}</StatusPill>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onProceedToApproval}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
        >
          {t("import_tab_approval")}
        </button>
        {dupes.length > 0 && (
          <button
            onClick={onDownload}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            <Download className="h-3.5 w-3.5" />{t("import_download_dupes")}
          </button>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Approval
// =============================================================================

function ApprovalTab({ batch, canApprove, isSystemAdmin, onApprove, onDryRun, busy, t }: {
  batch: ImportBatch | null | undefined;
  canApprove: boolean;
  isSystemAdmin: boolean;
  onApprove: () => void;
  onDryRun: () => void;
  busy: boolean;
  t: (k: any) => string;
}) {
  if (!batch) return <EmptyState message={t("import_tab_duplicates")} />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard icon={<FileSpreadsheet className="h-4 w-4" />} label={t("import_rows_total")} value={batch.total_rows} />
        <KpiCard icon={<CheckCircle2 className="h-4 w-4" />} label={t("import_rows_valid")} value={batch.valid_rows} />
        <KpiCard icon={<AlertTriangle className="h-4 w-4" />} label={t("import_rows_errors")} value={batch.error_rows} />
        <KpiCard icon={<Copy className="h-4 w-4" />} label={t("import_rows_dupes")} value={batch.duplicate_rows} />
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Status:</span>
          <StatusPill tone={statusTone(batch.status)}>
            {t(("import_status_" + batch.status) as any)}
          </StatusPill>
        </div>
        {batch.dry_run && <p className="mt-2 text-xs text-amber">{t("import_dry_run_note")}</p>}
      </div>

      <div className="flex gap-3">
        {canApprove && batch.status === "pending_approval" && (
          <button
            onClick={onApprove}
            disabled={busy}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {t("import_approve")}
          </button>
        )}
        {canApprove && batch.status === "approved" && (
          <button
            onClick={onDryRun}
            disabled={busy}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {busy ? t("import_running") : t("import_dry_run")}
          </button>
        )}
        {isSystemAdmin && !canApprove && (
          <p className="text-sm text-muted-foreground">{t("import_no_approve")}</p>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Result
// =============================================================================

type ReportFmt = "csv" | "json";

function ResultTab({ batch, onDownloadSummary, onDownloadErrors, onDownloadDupes, canApprove, onCommit, commitResult, busy, t }: {
  batch: ImportBatch | null | undefined;
  onDownloadSummary: (fmt: ReportFmt) => void;
  onDownloadErrors: (fmt: ReportFmt) => void;
  onDownloadDupes: (fmt: ReportFmt) => void;
  canApprove: boolean;
  onCommit: () => void;
  commitResult: { committed: number; failed: number; total: number } | null;
  busy: boolean;
  t: (k: any) => string;
}) {
  if (!batch) return <EmptyState message={t("import_tab_approval")} />;

  const ReportRow = ({ label, onDl }: { label: string; onDl: (f: ReportFmt) => void }) => (
    <div className="flex items-center gap-2">
      <span className="min-w-[160px] text-sm text-foreground">{label}</span>
      <button onClick={() => onDl("csv")} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted">
        <Download className="h-3.5 w-3.5" /> CSV
      </button>
      <button onClick={() => onDl("json")} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted">
        <Download className="h-3.5 w-3.5" /> JSON
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard icon={<FileSpreadsheet className="h-4 w-4" />} label={t("import_rows_total")} value={batch.total_rows} />
        <KpiCard icon={<CheckCircle2 className="h-4 w-4" />} label={t("import_would_create")} value={batch.valid_rows} />
        <KpiCard icon={<AlertTriangle className="h-4 w-4" />} label={t("import_would_skip")} value={batch.error_rows + batch.duplicate_rows} />
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <StatusPill tone={statusTone(batch.status)}>
          {t(("import_status_" + batch.status) as any)}
        </StatusPill>
        {batch.dry_run && <p className="mt-2 text-xs text-amber">{t("import_dry_run_note")}</p>}
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Dry-run reports</div>
        <ReportRow label="Import summary" onDl={onDownloadSummary} />
        <ReportRow label="Validation errors" onDl={onDownloadErrors} />
        <ReportRow label="Duplicate candidates" onDl={onDownloadDupes} />
      </div>

      {/* Section I — CRM commit */}
      {batch.status === "committed" || commitResult ? (
        <div className="rounded-lg border border-positive/40 bg-positive/5 p-4">
          <div className="text-sm font-medium text-positive">{t("import_commit_to_crm" as any)}</div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-md border border-border bg-surface px-3 py-2">
              <div className="text-xs text-muted-foreground">{t("import_committed_records" as any)}</div>
              <div className="mt-1 text-xl font-semibold text-positive">{commitResult?.committed ?? "—"}</div>
            </div>
            <div className="rounded-md border border-border bg-surface px-3 py-2">
              <div className="text-xs text-muted-foreground">{t("import_commit_failed_rows" as any)}</div>
              <div className="mt-1 text-xl font-semibold text-danger">{commitResult?.failed ?? "—"}</div>
            </div>
            <div className="rounded-md border border-border bg-surface px-3 py-2">
              <div className="text-xs text-muted-foreground">Total</div>
              <div className="mt-1 text-xl font-semibold text-foreground">{commitResult?.total ?? batch.total_rows ?? "—"}</div>
            </div>
          </div>
        </div>
      ) : canApprove && batch.status === "dry_run" ? (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            {t("import_commit_to_crm" as any)}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {t("import_staging_only_warning" as any)}
          </p>
          <button
            type="button"
            onClick={onCommit}
            disabled={busy}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t("import_commit_to_crm" as any)}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// =============================================================================
// Analysis
// =============================================================================

function AnalysisTab({ batch, t }: {
  batch: ImportBatch | null | undefined;
  t: (k: any) => string;
}) {
  if (!batch) return <EmptyState message={t("import_tab_result")} />;

  const successRate = batch.total_rows > 0 ? ((batch.valid_rows / batch.total_rows) * 100).toFixed(1) : "0";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Success Rate</div>
          <div className="mt-1 text-2xl font-semibold text-foreground">{successRate}%</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Error Rate</div>
          <div className="mt-1 text-2xl font-semibold text-foreground">
            {batch.total_rows > 0 ? ((batch.error_rows / batch.total_rows) * 100).toFixed(1) : "0"}%
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Duplicate Rate</div>
          <div className="mt-1 text-2xl font-semibold text-foreground">
            {batch.total_rows > 0 ? ((batch.duplicate_rows / batch.total_rows) * 100).toFixed(1) : "0"}%
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-medium text-foreground">Batch Details</h3>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted-foreground">Batch ID</dt>
          <dd className="font-mono text-xs text-foreground">{batch.id}</dd>
          <dt className="text-muted-foreground">Target entity</dt>
          <dd className="text-foreground">{batch.target_entity}</dd>
          <dt className="text-muted-foreground">Created</dt>
          <dd className="text-foreground">{new Date(batch.created_at).toLocaleString()}</dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd><StatusPill tone={statusTone(batch.status)}>{t(("import_status_" + batch.status) as any)}</StatusPill></dd>
          <dt className="text-muted-foreground">Dry Run</dt>
          <dd className="text-foreground">{batch.dry_run ? "Yes" : "No"}</dd>
          <dt className="text-muted-foreground">AI Suggestions</dt>
          <dd className="text-foreground">{batch.ai_suggestions_enabled ? "Enabled" : "Disabled"}</dd>
        </dl>
      </div>
    </div>
  );
}
