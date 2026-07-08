import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Copy, ShieldCheck,
  BarChart3, Download, X, Loader2, History,
} from "lucide-react";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  createBatch, listBatches, getBatch, cancelBatch,
  uploadImportFile, parseFile, validateBatch, detectDuplicates,
  approveBatch, dryRunCommit, downloadReport,
  saveMappings, getMappings, getImportErrors, getDuplicateCandidates,
  resolveDuplicate, getImportFiles,
  IMPORT_CAPABLE_ROLES, APPROVE_COMMIT_ROLES, UPLOAD_ROLES,
  COMPANY_TARGET_COLUMNS,
  type ImportBatch, type ImportMapping,
} from "@/lib/import-actions";

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

function DataImportCenter() {
  const { t } = useI18n();
  const { hasAnyRole, hasRole } = useAuth();
  const qc = useQueryClient();

  // Access check
  const canAccess = hasAnyRole([...UPLOAD_ROLES] as any[]);
  const canApprove = hasAnyRole([...APPROVE_COMMIT_ROLES] as any[]);
  const isSystemAdmin = hasRole("system_admin" as any);

  const [tab, setTab] = useState("history");
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Queries
  const { data: batches = [], isLoading: batchesLoading } = useQuery({
    queryKey: ["import-batches"],
    queryFn: listBatches,
    enabled: canAccess,
  });

  const { data: activeBatch } = useQuery({
    queryKey: ["import-batch", activeBatchId],
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

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["import-batches"] });
    if (activeBatchId) {
      qc.invalidateQueries({ queryKey: ["import-batch", activeBatchId] });
      qc.invalidateQueries({ queryKey: ["import-errors", activeBatchId] });
      qc.invalidateQueries({ queryKey: ["import-dupes", activeBatchId] });
      qc.invalidateQueries({ queryKey: ["import-files", activeBatchId] });
      qc.invalidateQueries({ queryKey: ["import-mappings", activeBatchId] });
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
      toast.success(t("toast_success"));
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
      toast.success(t("toast_success"));

      // Auto-parse
      await parseFile(activeBatchId, fileId);
      setTab("mapping");
      toast.success(t("toast_success"));
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
      toast.success(t("toast_success"));
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
      toast.success(t("toast_success"));
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
      toast.success(t("toast_success"));
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
      toast.success(t("toast_success"));
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
      toast.success(t("toast_success"));
    } catch (e: any) {
      toast.error(t("toast_error") + e.message);
    } finally {
      refresh();
    }
  };

  const openBatch = (id: string) => {
    setActiveBatchId(id);
    setTab("upload");
  };

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

      {/* Dry-run notice */}
      <div className="mb-6 rounded-md border border-amber/30 bg-amber/5 px-4 py-3 text-sm text-amber">
        {t("import_dry_run_note")}
      </div>

      {/* System admin notice */}
      {isSystemAdmin && !canApprove && (
        <div className="mb-6 rounded-md border border-muted bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          {t("import_no_approve")}
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-6 flex flex-wrap gap-1">
          <TabsTrigger value="history"><History className="mr-1.5 h-3.5 w-3.5" />{t("import_tab_history")}</TabsTrigger>
          <TabsTrigger value="upload"><Upload className="mr-1.5 h-3.5 w-3.5" />{t("import_tab_upload")}</TabsTrigger>
          <TabsTrigger value="mapping"><FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />{t("import_tab_mapping")}</TabsTrigger>
          <TabsTrigger value="validation"><AlertTriangle className="mr-1.5 h-3.5 w-3.5" />{t("import_tab_validation")}</TabsTrigger>
          <TabsTrigger value="duplicates"><Copy className="mr-1.5 h-3.5 w-3.5" />{t("import_tab_duplicates")}</TabsTrigger>
          <TabsTrigger value="approval"><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />{t("import_tab_approval")}</TabsTrigger>
          <TabsTrigger value="result"><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />{t("import_tab_result")}</TabsTrigger>
          <TabsTrigger value="analysis"><BarChart3 className="mr-1.5 h-3.5 w-3.5" />{t("import_tab_analysis")}</TabsTrigger>
        </TabsList>

        {/* HISTORY */}
        <TabsContent value="history">
          <HistoryTab batches={batches} loading={batchesLoading} onOpen={openBatch} t={t} />
        </TabsContent>

        {/* UPLOAD */}
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

        {/* MAPPING */}
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
          />
        </TabsContent>

        {/* VALIDATION */}
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

        {/* DUPLICATES */}
        <TabsContent value="duplicates">
          <DuplicatesTab
            batch={activeBatch}
            dupes={dupes}
            onResolve={async (id, res) => {
              try {
                await resolveDuplicate(id, res);
                refresh();
              } catch (e: any) {
                toast.error(t("toast_error") + e.message);
              }
            }}
            onProceedToApproval={() => setTab("approval")}
            onDownload={() => activeBatchId && downloadReport(activeBatchId, "duplicate_candidates")}
            busy={busy}
            t={t}
          />
        </TabsContent>

        {/* APPROVAL */}
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

        {/* RESULT */}
        <TabsContent value="result">
          <ResultTab
            batch={activeBatch}
            onDownloadSummary={() => activeBatchId && downloadReport(activeBatchId, "import_summary")}
            onDownloadErrors={() => activeBatchId && downloadReport(activeBatchId, "validation_errors")}
            onDownloadDupes={() => activeBatchId && downloadReport(activeBatchId, "duplicate_candidates")}
            t={t}
          />
        </TabsContent>

        {/* ANALYSIS */}
        <TabsContent value="analysis">
          <AnalysisTab batch={activeBatch} t={t} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// =============================================================================
// Sub-components for each tab
// =============================================================================

function HistoryTab({ batches, loading, onOpen, t }: {
  batches: ImportBatch[]; loading: boolean; onOpen: (id: string) => void; t: (k: any) => string;
}) {
  if (loading) return <EmptyState message="Loading…" />;
  if (batches.length === 0) return <EmptyState message={t("import_no_batches")} />;

  return (
    <div className="space-y-2">
      {batches.map((b) => (
        <button
          key={b.id}
          onClick={() => onOpen(b.id)}
          className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-muted/50"
        >
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">
              {b.id.slice(0, 8)}… · {b.total_rows} {t("import_rows_total").toLowerCase()}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {new Date(b.created_at).toLocaleDateString()} · {b.source_type}
            </div>
          </div>
          <StatusPill tone={statusTone(b.status)}>
            {t(("import_status_" + b.status) as any)}
          </StatusPill>
        </button>
      ))}
    </div>
  );
}

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

  if (!batch) {
    return <EmptyState message={t("import_new_batch")} />;
  }

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors ${
          dragOver ? "border-foreground bg-muted/50" : "border-border hover:border-muted-foreground"
        }`}
      >
        {busy ? (
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        ) : (
          <Upload className="h-10 w-10 text-muted-foreground" />
        )}
        <p className="mt-4 text-sm text-foreground">{t("import_upload_prompt")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("import_upload_limit")}</p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx"
          onChange={handleChange}
          className="hidden"
        />
      </div>

      {/* Uploaded files */}
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

      {/* Cancel */}
      <div className="flex justify-end">
        <button onClick={onCancel} className="text-sm text-muted-foreground hover:text-danger">
          <X className="mr-1 inline h-3.5 w-3.5" />{t("import_cancel")}
        </button>
      </div>
    </div>
  );
}

function MappingTab({ batch, files, mappings, onSave, onValidate, busy, t }: {
  batch: ImportBatch | null | undefined;
  files: any[];
  mappings: ImportMapping[];
  onSave: (m: Omit<ImportMapping, "id" | "batch_id">[]) => Promise<ImportMapping[] | void>;
  onValidate: () => Promise<void>;
  busy: boolean;
  t: (k: any) => string;
}) {
  const columns: string[] = files[0]?.column_names ?? [];

  // Row state keyed by column INDEX (not header name) so files with duplicate
  // or blank headers keep each row independent.
  type Row = { source: string; target: string; isKey: boolean };
  const [draft, setDraft] = useState<Row[]>([]);

  // Re-seed the draft whenever the parsed columns or saved mappings change
  // (files load asynchronously, so the initial value would otherwise be []).
  const columnsKey = columns.join("|");
  const mappingsKey = mappings.map((m) => `${m.source_column}=${m.target_column}:${m.is_key}`).join("|");
  useEffect(() => {
    const byCol = new Map<string, { target: string; isKey: boolean }>();
    for (const m of mappings) byCol.set(m.source_column, { target: m.target_column, isKey: m.is_key });
    setDraft(columns.map((c) => ({
      source: c,
      target: byCol.get(c)?.target ?? "",
      isKey: byCol.get(c)?.isKey ?? false,
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnsKey, mappingsKey]);


  if (!batch || columns.length === 0) {
    return <EmptyState message={t("import_tab_upload")} />;
  }

  const updateRow = (idx: number, patch: Partial<Row>) =>
    setDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  // Build the mapping payload from the current draft, deduping source_column
  // (UNIQUE constraint) and dropping blank sources / unselected targets.
  const buildPayload = () => {
    const seen = new Set<string>();
    return draft
      .filter((r) => {
        const source = r.source.trim();
        if (!r.target || !source) return false;
        if (seen.has(source)) return false;
        seen.add(source);
        return true;
      })
      .map((r) => ({
        source_column: r.source.trim(),
        target_table: "companies",
        target_column: r.target.trim(),
        transform: null,
        is_key: r.isKey,
      }));
  };

  const validDraftCount = buildPayload().length;
  const canValidate = validDraftCount > 0 || mappings.length > 0;
  const hasUnsavedDraft = validDraftCount > 0;

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

  // Save the current draft first (so the user doesn't have to click Save
  // separately) and then validate. Prevents the "no mappings" edge-function
  // error when the user goes straight to Validate.
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
    <div className="space-y-6">
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
              <tr key={idx} className="border-b border-border last:border-0">
                <td className="px-4 py-2 font-mono text-xs text-foreground">
                  {row.source || <span className="text-muted-foreground">(column {idx + 1})</span>}
                </td>
                <td className="px-4 py-2">
                  <select
                    value={row.target}
                    onChange={(e) => updateRow(idx, { target: e.target.value })}
                    className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                  >
                    <option value="">— skip —</option>
                    {COMPANY_TARGET_COLUMNS.map((tc) => (
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
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard icon={<FileSpreadsheet className="h-4 w-4" />} label={t("import_rows_total")} value={batch.total_rows} />
        <KpiCard icon={<CheckCircle2 className="h-4 w-4" />} label={t("import_rows_valid")} value={batch.valid_rows} />
        <KpiCard icon={<AlertTriangle className="h-4 w-4" />} label={t("import_rows_errors")} value={batch.error_rows} />
        <KpiCard icon={<Copy className="h-4 w-4" />} label={t("import_rows_dupes")} value={batch.duplicate_rows} />
      </div>

      {/* Errors table */}
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
      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard icon={<FileSpreadsheet className="h-4 w-4" />} label={t("import_rows_total")} value={batch.total_rows} />
        <KpiCard icon={<CheckCircle2 className="h-4 w-4" />} label={t("import_rows_valid")} value={batch.valid_rows} />
        <KpiCard icon={<AlertTriangle className="h-4 w-4" />} label={t("import_rows_errors")} value={batch.error_rows} />
        <KpiCard icon={<Copy className="h-4 w-4" />} label={t("import_rows_dupes")} value={batch.duplicate_rows} />
      </div>

      {/* Status */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Status:</span>
          <StatusPill tone={statusTone(batch.status)}>
            {t(("import_status_" + batch.status) as any)}
          </StatusPill>
        </div>
        {batch.dry_run && (
          <p className="mt-2 text-xs text-amber">{t("import_dry_run_note")}</p>
        )}
      </div>

      {/* Actions */}
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

function ResultTab({ batch, onDownloadSummary, onDownloadErrors, onDownloadDupes, t }: {
  batch: ImportBatch | null | undefined;
  onDownloadSummary: () => void;
  onDownloadErrors: () => void;
  onDownloadDupes: () => void;
  t: (k: any) => string;
}) {
  if (!batch) return <EmptyState message={t("import_tab_approval")} />;

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
        {batch.dry_run && (
          <p className="mt-2 text-xs text-amber">{t("import_dry_run_note")}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <button onClick={onDownloadSummary} className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">
          <Download className="h-3.5 w-3.5" />{t("import_download_summary")}
        </button>
        <button onClick={onDownloadErrors} className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">
          <Download className="h-3.5 w-3.5" />{t("import_download_errors")}
        </button>
        <button onClick={onDownloadDupes} className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">
          <Download className="h-3.5 w-3.5" />{t("import_download_dupes")}
        </button>
      </div>
    </div>
  );
}

function AnalysisTab({ batch, t }: {
  batch: ImportBatch | null | undefined;
  t: (k: any) => string;
}) {
  if (!batch) return <EmptyState message={t("import_tab_result")} />;

  const successRate = batch.total_rows > 0
    ? ((batch.valid_rows / batch.total_rows) * 100).toFixed(1)
    : "0";

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
