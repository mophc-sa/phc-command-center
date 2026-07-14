import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Loader2, CheckCircle2, AlertTriangle, Eye,
  Database, ShieldCheck, Sparkles,
} from "lucide-react";
import { PageHeader } from "@/components/phc/PageHeader";
import { Panel } from "@/components/phc/Panel";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { SkeletonCard } from "@/components/phc/Skeleton";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  getBatch, getMappings, saveMappings, getImportErrors, getDuplicateCandidates,
  getImportFiles, getImportRows, validateBatch, detectDuplicates,
  approveBatch, dryRunCommit, commitBatch,
  suggestImportMappings,
  getTargetColumns, EXTRA_DATA_SENTINEL,
  APPROVE_COMMIT_ROLES, UPLOAD_ROLES,
  type ImportBatch, type ImportMapping, type ImportRow,
  type ImportTargetEntity,
} from "@/lib/import-actions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/data-import/$batchId")({
  head: () => ({ meta: [{ title: "Import Detail — PHC" }, { name: "robots", content: "noindex" }] }),
  component: BatchDetailPage,
});

// ---------- helpers -----------------------------------------------------------

type StatusTone = "positive" | "attention" | "danger" | "muted" | "neutral";

function statusTone(s: string): StatusTone {
  if (s === "committed") return "positive";
  if (s === "approved" || s === "dry_run") return "attention";
  if (s === "failed" || s === "cancelled") return "danger";
  if (s === "pending_approval" || s === "duplicate_review") return "attention";
  return "neutral";
}

type Step = { key: string; label: string; statuses: string[] };

const STEPS: Step[] = [
  { key: "parse",    label: "Parsed",    statuses: ["parsing", "needs_mapping", "mapping"] },
  { key: "map",      label: "Mapped",    statuses: ["validating"] },
  { key: "validate", label: "Validated", statuses: ["duplicate_review"] },
  { key: "review",   label: "Reviewed",  statuses: ["pending_approval"] },
  { key: "approve",  label: "Approved",  statuses: ["approved", "dry_run"] },
  { key: "commit",   label: "Committed", statuses: ["committed"] },
];

function currentStepIndex(status: string): number {
  const idx = STEPS.findIndex((s) => s.statuses.includes(status));
  return idx === -1 ? 0 : idx;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function rowStatusClass(status: string): string {
  if (status === "valid" || status === "committed") return "bg-emerald-500/15 text-emerald-400";
  if (status === "error" || status === "failed")    return "bg-red-500/15 text-red-400";
  if (status === "duplicate")                        return "bg-amber-500/15 text-amber-400";
  return "bg-muted text-muted-foreground";
}

// ---------- page --------------------------------------------------------------

function BatchDetailPage() {
  const { batchId } = Route.useParams();
  const { hasAnyRole } = useAuth();
  const qc = useQueryClient();
  const canAccess = hasAnyRole([...UPLOAD_ROLES] as any[]);
  const canApprove = hasAnyRole([...APPROVE_COMMIT_ROLES] as any[]);

  const [busy, setBusy] = useState<string | null>(null);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiStep, setAiStep] = useState<string>("");

  const { data: batch, isLoading: batchLoading } = useQuery<ImportBatch | null>({
    queryKey: ["import-batch", batchId],
    queryFn: () => getBatch(batchId),
    enabled: canAccess && !!batchId,
    refetchInterval: busy ? 3000 : 15_000,
  });

  const { data: mappings = [] } = useQuery<ImportMapping[]>({
    queryKey: ["import-mappings", batchId],
    queryFn: () => getMappings(batchId),
    enabled: canAccess && !!batchId,
  });

  const { data: errors = [] } = useQuery({
    queryKey: ["import-errors", batchId],
    queryFn: () => getImportErrors(batchId),
    enabled: canAccess && !!batchId && !!batch &&
      ["validating", "duplicate_review", "pending_approval"].includes(batch.status),
  });

  const { data: dupes = [] } = useQuery({
    queryKey: ["import-dupes", batchId],
    queryFn: () => getDuplicateCandidates(batchId),
    enabled: canAccess && !!batchId && !!batch &&
      ["duplicate_review", "pending_approval", "approved"].includes(batch.status),
  });

  const { data: files = [] } = useQuery({
    queryKey: ["import-files", batchId],
    queryFn: () => getImportFiles(batchId),
    enabled: canAccess && !!batchId,
  });

  const { data: rows = [] } = useQuery<ImportRow[]>({
    queryKey: ["import-rows", batchId],
    queryFn: () => getImportRows(batchId, { includeDeleted: false }),
    enabled: canAccess && !!batchId && !!batch,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["import-batch", batchId] });
    qc.invalidateQueries({ queryKey: ["import-mappings", batchId] });
    qc.invalidateQueries({ queryKey: ["import-errors", batchId] });
    qc.invalidateQueries({ queryKey: ["import-dupes", batchId] });
    qc.invalidateQueries({ queryKey: ["import-rows", batchId] });
    qc.invalidateQueries({ queryKey: ["import-batches"] });
  };

  async function runStep(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    try {
      await fn();
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${label} failed`);
    } finally {
      setBusy(null);
    }
  }

  async function runAiPipeline() {
    if (!batch) return;
    setAiRunning(true);
    try {
      // 1. Suggest mappings and auto-save
      setAiStep("Suggesting column mappings…");
      const suggestions = await suggestImportMappings(batchId);
      if (suggestions && suggestions.length > 0) {
        const targetCols = new Set<string>(
          getTargetColumns(batch.target_entity as ImportTargetEntity).map((c) => c.value),
        );
        const toSave = suggestions
          .filter((s) => s.suggestedTarget && s.suggestedTarget !== "__skip__" && s.suggestedTarget !== EXTRA_DATA_SENTINEL)
          .filter((s) => targetCols.has(s.suggestedTarget!))
          .map((s) => ({
            source_column: s.sourceColumn,
            target_table: batch.target_entity,
            target_column: s.suggestedTarget!,
            transform: null,
            is_key: s.isKey ?? false,
          }));
        if (toSave.length > 0) {
          await saveMappings(batchId, toSave);
        }
      }

      // 2. Validate
      setAiStep("Validating rows…");
      await validateBatch(batchId);

      // 3. Detect duplicates
      setAiStep("Detecting duplicates…");
      await detectDuplicates(batchId);

      refresh();
      toast.success("AI pipeline complete — review results then approve");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI pipeline failed");
    } finally {
      setAiRunning(false);
      setAiStep("");
    }
  }

  if (!canAccess) {
    return <EmptyState message="You do not have permission to view this import." />;
  }

  if (batchLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <SkeletonCard count={2} />
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Link to="/data-import" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Import Center
        </Link>
        <EmptyState message="Batch not found." />
      </div>
    );
  }

  const stepIndex = currentStepIndex(batch.status);
  const isMappingStep = ["needs_mapping", "mapping"].includes(batch.status);
  const isCommitted = batch.status === "committed";
  const isFailed = ["failed", "cancelled"].includes(batch.status);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Back link + Header */}
      <div>
        <Link
          to="/data-import"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Import Center
        </Link>
        <PageHeader
          eyebrow="Import Batch"
          title={batch.file_name ?? "Unnamed Batch"}
          description={`${batch.target_entity} · created ${fmtDate(batch.created_at)}`}
          actions={<StatusPill tone={statusTone(batch.status)}>{batch.status}</StatusPill>}
        />
      </div>

      {/* Progress stepper */}
      <Stepper steps={STEPS} currentIndex={stepIndex} failed={isFailed} />

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 text-center">
        {[
          { label: "Total",      value: batch.total_rows ?? "—" },
          { label: "Valid",      value: batch.valid_rows ?? "—" },
          { label: "Errors",     value: batch.error_rows ?? "—" },
          { label: "Duplicates", value: batch.duplicate_rows ?? "—" },
          { label: "Dry Run",    value: batch.dry_run ? "Yes" : "No" },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-md border border-border bg-surface px-3 py-2">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-sm font-semibold text-foreground">{String(value)}</p>
          </div>
        ))}
      </div>

      {/* AI Pipeline trigger */}
      {(isMappingStep || ["validating", "duplicate_review"].includes(batch.status)) && (
        <Panel title="AI Pipeline">
          <p className="text-xs text-muted-foreground mb-3">
            One click: the AI suggests column mappings, validates rows, and detects duplicates. Review the results before approving.
          </p>
          {aiRunning ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {aiStep}
            </div>
          ) : (
            <Button
              size="sm"
              onClick={runAiPipeline}
              disabled={!!busy}
              className="border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 border"
            >
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Run AI Pipeline
            </Button>
          )}
        </Panel>
      )}

      {/* Tabs */}
      <Tabs defaultValue={isMappingStep ? "mapping" : "summary"}>
        <TabsList className="mb-4">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="mapping">
            Mapping {mappings.length > 0 && `(${mappings.length})`}
          </TabsTrigger>
          <TabsTrigger value="rows">
            Rows {rows.length > 0 && `(${rows.length})`}
          </TabsTrigger>
          {(errors as any[]).length > 0 && (
            <TabsTrigger value="errors">Errors ({(errors as any[]).length})</TabsTrigger>
          )}
          {(dupes as any[]).length > 0 && (
            <TabsTrigger value="duplicates">Duplicates ({(dupes as any[]).length})</TabsTrigger>
          )}
          <TabsTrigger value="approval">Approval</TabsTrigger>
        </TabsList>

        {/* Summary */}
        <TabsContent value="summary">
          <Panel title="Batch details">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
              {([
                ["Batch ID",    batch.id.slice(0, 8) + "…"],
                ["Entity",      batch.target_entity],
                ["Status",      batch.status],
                ["File",        batch.file_name ?? "—"],
                ["Created",     fmtDate(batch.created_at)],
                ["Approved by", batch.approved_by ? batch.approved_by.slice(0, 8) + "…" : "—"],
                ["Committed at",batch.committed_at ? fmtDate(batch.committed_at) : "—"],
                ["Dry run",     batch.dry_run ? "Yes" : "No"],
                ["AI enabled",  batch.ai_suggestions_enabled ? "On" : "Off"],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-medium text-foreground mt-0.5">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </TabsContent>

        {/* Mapping */}
        <TabsContent value="mapping">
          <MappingPanel
            batchId={batchId}
            entity={batch.target_entity as ImportTargetEntity}
            mappings={mappings}
            files={files as any[]}
            busy={!!busy || aiRunning}
            onSaved={refresh}
          />
        </TabsContent>

        {/* Rows */}
        <TabsContent value="rows">
          <Panel title="Rows">
            {rows.length === 0 ? (
              <EmptyState message="No rows yet." />
            ) : (
              <div className="overflow-auto rounded border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      <th className="px-3 py-2 text-left text-muted-foreground font-medium w-12">#</th>
                      <th className="px-3 py-2 text-left text-muted-foreground font-medium">Status</th>
                      <th className="px-3 py-2 text-left text-muted-foreground font-medium">Preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 200).map((row) => (
                      <tr key={row.id} className="border-b border-border/50 hover:bg-muted/10">
                        <td className="px-3 py-1.5 text-muted-foreground">{row.row_number}</td>
                        <td className="px-3 py-1.5">
                          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", rowStatusClass(row.status))}>
                            {row.status}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground truncate max-w-xs">
                          {Object.values(row.raw_data ?? {}).slice(0, 3).join(" · ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 200 && (
                  <p className="px-3 py-2 text-[10px] text-muted-foreground">
                    Showing 200 of {rows.length} rows.
                  </p>
                )}
              </div>
            )}
          </Panel>
        </TabsContent>

        {/* Errors */}
        {(errors as any[]).length > 0 && (
          <TabsContent value="errors">
            <Panel title="Validation errors">
              <div className="overflow-auto rounded border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      <th className="px-3 py-2 text-left text-muted-foreground font-medium">Row</th>
                      <th className="px-3 py-2 text-left text-muted-foreground font-medium">Column</th>
                      <th className="px-3 py-2 text-left text-muted-foreground font-medium">Message</th>
                      <th className="px-3 py-2 text-left text-muted-foreground font-medium">Severity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(errors as any[]).map((e: any) => (
                      <tr key={e.id} className="border-b border-border/50">
                        <td className="px-3 py-1.5">{e.row_number}</td>
                        <td className="px-3 py-1.5 font-mono">{e.column_name}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{e.message}</td>
                        <td className="px-3 py-1.5">
                          <span className={e.severity === "error" ? "text-red-400" : "text-amber-400"}>
                            {e.severity}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </TabsContent>
        )}

        {/* Duplicates */}
        {(dupes as any[]).length > 0 && (
          <TabsContent value="duplicates">
            <Panel title="Duplicate candidates">
              <p className="text-xs text-muted-foreground mb-3">
                These rows matched existing CRM records or other rows in the file.
              </p>
              <div className="overflow-auto rounded border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      <th className="px-3 py-2 text-left text-muted-foreground font-medium">Scope</th>
                      <th className="px-3 py-2 text-left text-muted-foreground font-medium">Type</th>
                      <th className="px-3 py-2 text-left text-muted-foreground font-medium">Confidence</th>
                      <th className="px-3 py-2 text-left text-muted-foreground font-medium">Suggested</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(dupes as any[]).map((d: any) => (
                      <tr key={d.id} className="border-b border-border/50">
                        <td className="px-3 py-1.5">{d.match_scope}</td>
                        <td className="px-3 py-1.5">{d.match_type}</td>
                        <td className="px-3 py-1.5">{d.confidence}%</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{d.suggested_action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </TabsContent>
        )}

        {/* Approval */}
        <TabsContent value="approval">
          <ApprovalPanel
            batch={batch}
            canApprove={canApprove}
            busy={!!busy}
            onStep={runStep}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------- Stepper -----------------------------------------------------------

function Stepper({ steps, currentIndex, failed }: { steps: Step[]; currentIndex: number; failed: boolean }) {
  return (
    <nav aria-label="Import progress" className="flex items-center gap-0">
      {steps.map((step, i) => {
        const done    = !failed && i < currentIndex;
        const current = i === currentIndex;
        const future  = !failed && i > currentIndex;
        return (
          <div key={step.key} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center gap-1 flex-1">
              <div className={cn(
                "h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 shrink-0 transition-colors",
                done    && "border-emerald-500 bg-emerald-500/20 text-emerald-400",
                current && !failed && "border-emerald-400 bg-emerald-400/10 text-emerald-300",
                current && failed  && "border-red-500 bg-red-500/20 text-red-400",
                future  && "border-border bg-transparent text-muted-foreground",
              )}>
                {done ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : current && failed ? (
                  <AlertTriangle className="h-3 w-3" />
                ) : (
                  i + 1
                )}
              </div>
              <span className={cn(
                "text-[10px] font-medium text-center leading-tight hidden sm:block",
                done           ? "text-emerald-400"  :
                current && !failed ? "text-foreground" :
                                 "text-muted-foreground",
              )}>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn("h-px flex-1 mx-1 transition-colors", done ? "bg-emerald-500/40" : "bg-border")} />
            )}
          </div>
        );
      })}
    </nav>
  );
}

// ---------- Mapping panel -----------------------------------------------------

function MappingPanel({
  batchId, entity, mappings, files, busy, onSaved,
}: {
  batchId: string;
  entity: ImportTargetEntity;
  mappings: ImportMapping[];
  files: { column_names?: string[] }[];
  busy: boolean;
  onSaved: () => void;
}) {
  const [localMappings, setLocalMappings] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const mp of mappings) m[mp.source_column] = mp.target_column;
    return m;
  });
  const [saving, setSaving] = useState(false);
  const targetCols = getTargetColumns(entity);

  const sourceColumns = [...new Set(files.flatMap((f) => f.column_names ?? []))];

  async function handleSave() {
    setSaving(true);
    try {
      const toSave = Object.entries(localMappings)
        .filter(([, t]) => t && t !== "__skip__")
        .map(([source_column, target_column]) => ({
          source_column,
          target_table: entity,
          target_column,
          transform: null,
          is_key: false,
        }));
      await saveMappings(batchId, toSave);
      toast.success("Mappings saved");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (sourceColumns.length === 0) {
    return (
      <Panel title="Column mapping">
        <EmptyState message="No columns found. The file may not have been parsed yet." />
      </Panel>
    );
  }

  return (
    <Panel title="Column mapping">
      <p className="text-xs text-muted-foreground mb-4">
        Map each source column to a CRM field. Run the AI Pipeline above to auto-suggest mappings.
      </p>
      <div className="space-y-2">
        {sourceColumns.map((srcCol) => (
          <div key={srcCol} className="flex items-center gap-3">
            <span className="font-mono text-xs text-muted-foreground w-48 shrink-0 truncate" title={srcCol}>
              {srcCol}
            </span>
            <span className="text-muted-foreground text-xs">→</span>
            <Select
              value={localMappings[srcCol] ?? "__skip__"}
              onValueChange={(v) => setLocalMappings((prev) => ({ ...prev, [srcCol]: v }))}
              disabled={busy || saving}
            >
              <SelectTrigger className="h-7 text-xs w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__skip__">Skip this column</SelectItem>
                <SelectItem value={EXTRA_DATA_SENTINEL}>Additional Data</SelectItem>
                {targetCols
                  .filter((c) => c.value !== EXTRA_DATA_SENTINEL)
                  .map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}{"required" in c && c.required ? " *" : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={saving || busy}>
          {saving ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Saving…</>
          ) : (
            "Save Mappings"
          )}
        </Button>
      </div>
    </Panel>
  );
}

// ---------- Approval panel ----------------------------------------------------

function ApprovalPanel({
  batch, canApprove, busy, onStep,
}: {
  batch: ImportBatch;
  canApprove: boolean;
  busy: boolean;
  onStep: (label: string, fn: () => Promise<unknown>) => void;
}) {
  const [commitResult, setCommitResult] = useState<{ committed: number; failed: number; total: number } | null>(null);
  const [dryRunResult, setDryRunResult] = useState<{ would_create: number; would_skip_duplicates: number; would_skip_errors: number } | null>(null);

  const isPendingApproval = batch.status === "pending_approval";
  const isApproved       = batch.status === "approved";
  const isDryRun         = batch.status === "dry_run";
  const isCommitted      = batch.status === "committed";

  if (isCommitted) {
    return (
      <Panel title="Committed">
        <div className="flex items-center gap-2 text-emerald-400">
          <CheckCircle2 className="h-5 w-5" />
          <p className="text-sm font-medium">This batch has been committed to the CRM.</p>
        </div>
        {commitResult && (
          <p className="mt-2 text-xs text-muted-foreground">
            {commitResult.committed} created · {commitResult.failed} failed · {commitResult.total} total
          </p>
        )}
      </Panel>
    );
  }

  return (
    <Panel title="Approval & Commit">
      {!canApprove && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400 mb-4">
          You need a manager role (Managing Director, General Manager, CEO, or Sales Manager) to approve and commit imports.
        </div>
      )}

      <div className="space-y-3">
        {/* Step 1: Approve */}
        <div className={cn("rounded-md border px-4 py-3", isPendingApproval ? "border-emerald-500/30 bg-emerald-500/5" : "border-border opacity-60")}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">1. Approve batch</p>
              <p className="text-xs text-muted-foreground mt-0.5">Confirms the data is ready to be written to the CRM.</p>
            </div>
            <Button
              size="sm"
              disabled={!isPendingApproval || !canApprove || busy}
              onClick={() => onStep("Approve", () => approveBatch(batch.id))}
              className="shrink-0"
            >
              <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
              Approve
            </Button>
          </div>
        </div>

        {/* Step 2: Dry run */}
        <div className={cn("rounded-md border px-4 py-3", isApproved ? "border-amber-500/30 bg-amber-500/5" : "border-border opacity-60")}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">2. Dry run</p>
              <p className="text-xs text-muted-foreground mt-0.5">Simulates the commit without writing any data.</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!isApproved || !canApprove || busy}
              onClick={() => onStep("Dry run", async () => {
                const r = await dryRunCommit(batch.id);
                setDryRunResult(r as any);
              })}
              className="shrink-0"
            >
              <Eye className="h-3.5 w-3.5 mr-1.5" />
              Dry Run
            </Button>
          </div>
          {dryRunResult && (
            <p className="mt-2 text-xs text-muted-foreground">
              Would create {dryRunResult.would_create} · skip {dryRunResult.would_skip_duplicates} duplicates · skip {dryRunResult.would_skip_errors} errors
            </p>
          )}
        </div>

        {/* Step 3: Commit */}
        <div className={cn("rounded-md border px-4 py-3", isDryRun ? "border-red-500/30 bg-red-500/5" : "border-border opacity-60")}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">3. Commit to CRM</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Permanently writes validated rows to live CRM tables. This cannot be undone.
              </p>
            </div>
            <Button
              size="sm"
              disabled={!isDryRun || !canApprove || busy}
              onClick={() => onStep("Commit", async () => {
                const r = await commitBatch(batch.id);
                setCommitResult(r as any);
              })}
              className="shrink-0 border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 border"
            >
              <Database className="h-3.5 w-3.5 mr-1.5" />
              Commit
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}
