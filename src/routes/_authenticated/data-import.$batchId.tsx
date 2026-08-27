import { createFileRoute, Link } from "@tanstack/react-router";
import React, { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Loader2, CheckCircle2, AlertTriangle, Eye,
  Database, ShieldCheck, Sparkles, Undo2,
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
  approveBatch, dryRunCommit, commitBatch, rollbackBatch,
  suggestImportMappings,
  callImportAgent,
  getSplitProposals, reviewSplitProposal, stageSplitProposals, acceptSplitProposalToRow,
  acceptResolvedLink, runDataCleanup, runContactMapping,
  getTargetColumns, EXTRA_DATA_SENTINEL,
  APPROVE_COMMIT_ROLES, UPLOAD_ROLES,
  READINESS_ITEMS, saveReadinessChecklist, getReadinessChecklist, deriveAutoChecklist,
  SOURCE_KIND_ROUTING,
  generateCandidates, listCandidates, updateCandidateReview,
  type ImportBatch, type ImportMapping, type ImportRow,
  type ImportTargetEntity,
  type AiAgentCallResult,
  type ImportSplitProposal,
  type ImportRecordCandidate,
  type ReadinessChecklist,
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
  if (s === "rolled_back") return "attention";
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
  { key: "commit",   label: "Committed", statuses: ["committed", "rolled_back"] },
];

function currentStepIndex(status: string): number {
  const idx = STEPS.findIndex((s) => s.statuses.includes(status));
  return idx === -1 ? 0 : idx;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function rowStatusClass(status: string): string {
  if (status === "valid" || status === "committed") return "bg-won/15 text-won";
  if (status === "error" || status === "failed")    return "bg-destructive/15 text-destructive";
  if (status === "duplicate")                        return "bg-amber/15 text-amber-light";
  return "bg-muted text-muted-foreground";
}

function humanizeEntity(entityType: string): string {
  return entityType.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function groupByEntity<T extends { entity_type: string }>(items: T[]): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    (groups[item.entity_type] ??= []).push(item);
  }
  return groups;
}

// Short, best-effort preview of a candidate's payload — first couple of
// non-empty values, not a full field dump (payload shape varies by entity).
function previewPayload(payload: Record<string, unknown>): string {
  const parts = Object.entries(payload)
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .slice(0, 2)
    .map(([, v]) => String(v));
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function candidateActionClass(action: string): string {
  if (action === "create") return "bg-won-surface text-won";
  if (action === "update") return "bg-info/10 text-info";
  if (action === "duplicate") return "bg-muted text-muted-foreground";
  return "bg-amber/10 text-amber-light"; // needs_review, conflict
}

function candidateStatusClass(status: string): string {
  if (status === "approved") return "text-won";
  if (status === "rejected") return "text-destructive";
  return "text-muted-foreground";
}

// ---------- page --------------------------------------------------------------

function BatchDetailPage() {
  const { batchId } = Route.useParams();
  const { hasAnyRole } = useAuth();
  const qc = useQueryClient();
  const canAccess = hasAnyRole([...UPLOAD_ROLES] as any[]);
  const canApprove = hasAnyRole([...APPROVE_COMMIT_ROLES] as any[]);

  const [busy, setBusy] = useState<string | null>(null);
  const [reviewingCandidateId, setReviewingCandidateId] = useState<string | null>(null);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiStep, setAiStep] = useState<string>("");
  const [mappingAiOutput, setMappingAiOutput] = useState<Record<string, unknown> | null>(null);
  const [mappingAiAgent, setMappingAiAgent] = useState<string>("");
  const [sheetAiOutput, setSheetAiOutput] = useState<Record<string, unknown> | null>(null);
  const [mapperProposals, setMapperProposals] = useState<Array<{
    source_column: string; suggested_target: string; confidence: number; rationale: string; dismissed: boolean;
  }>>([]);

  // Extraction panel state (Task 7)
  const [extractorRunning, setExtractorRunning] = useState(false);
  const [resolverRunning, setResolverRunning] = useState(false);
  const [resolverOutput, setResolverOutput] = useState<Record<string, unknown> | null>(null);
  // value = whether it landed in the structured import_candidate_links
  // table vs. fell back to a raw_data note (see acceptResolvedLink).
  const [acceptedLinkIds, setAcceptedLinkIds] = useState<Map<number, boolean>>(new Map());
  const [dismissedLinkIds, setDismissedLinkIds] = useState<Set<number>>(new Set());

  // AI panels state (Task 8)
  const [changeOutput, setChangeOutput] = useState<Record<string, unknown> | null>(null);
  const [changeRunning, setChangeRunning] = useState(false);
  const [reviewerOutput, setReviewerOutput] = useState<Record<string, unknown> | null>(null);
  const [reviewerRunning, setReviewerRunning] = useState(false);

  // data_cleanup / contact_mapping — previously built and tested at the
  // agent level with zero UI call sites (see docs/ai-orchestrator.md,
  // "Later agents" section).
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<Awaited<ReturnType<typeof runDataCleanup>> | null>(null);
  const [appliedCorrectionIds, setAppliedCorrectionIds] = useState<Set<number>>(new Set());
  const [flaggedDuplicateRowIds, setFlaggedDuplicateRowIds] = useState<Set<string>>(new Set());

  const [mappingRunning, setMappingRunning] = useState(false);
  const [mappingResult, setMappingResult] = useState<Awaited<ReturnType<typeof runContactMapping>> | null>(null);
  const [acceptedContactLinkIds, setAcceptedContactLinkIds] = useState<Map<number, boolean>>(new Map());

  const { data: splitProposals = [], refetch: refetchSplits } = useQuery<ImportSplitProposal[]>({
    queryKey: ["import-split-proposals", batchId],
    queryFn: () => getSplitProposals(batchId),
    enabled: canAccess && !!batchId,
  });

  const acceptedSplits = splitProposals.filter((p) => p.review_status === "accepted");

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

  const { data: candidates = [] } = useQuery<ImportRecordCandidate[]>({
    queryKey: ["import-candidates", batchId],
    queryFn: () => listCandidates(batchId),
    enabled: canAccess && !!batchId && !!batch &&
      ["pending_approval", "approved", "dry_run", "committed"].includes(batch.status),
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
    qc.invalidateQueries({ queryKey: ["import-candidates", batchId] });
    qc.invalidateQueries({ queryKey: ["import-rows", batchId] });
    qc.invalidateQueries({ queryKey: ["import-split-proposals", batchId] });
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

      {/* Data routing banner — shown when source type is known */}
      {batch.source_type && batch.source_type !== "unknown" && SOURCE_KIND_ROUTING[batch.source_type] && (
        <div className="rounded-md border border-won/20 bg-won/[0.05] px-4 py-2.5 flex items-center gap-3 text-xs">
          <span className="text-muted-foreground shrink-0">Detected:</span>
          <span className="font-medium text-won capitalize">{batch.source_type.replace(/_/g, " ")}</span>
          <span className="text-muted-foreground shrink-0">→ routes to:</span>
          <div className="flex flex-wrap gap-1">
            {SOURCE_KIND_ROUTING[batch.source_type].destinations.map((d) => (
              <span key={d} className="rounded bg-won/10 px-2 py-0.5 text-won font-medium capitalize">
                {d.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      )}

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
              className="border-won/40 bg-won/10 text-won hover:bg-won/20 border"
            >
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Run AI Pipeline
            </Button>
          )}
        </Panel>
      )}

      {/* Extraction Panel — shown when batch is post-validate */}
      {(batch?.status === "duplicate_review" || batch?.status === "pending_approval") && (
        <div className="mb-4 rounded-lg border border-muted bg-muted/30 p-4 space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Sparkles className="h-4 w-4" />
            Entity Extraction
          </div>

          {/* entity_extractor button */}
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              disabled={extractorRunning || resolverRunning}
              onClick={async () => {
                setExtractorRunning(true);
                try {
                  const r = await callImportAgent(batchId, "entity_extractor");
                  if (r.ok) {
                    const result = r.result as { split_proposals: Array<{ source_row_id: string; entities: Array<{ entity_type: string; proposed_payload: Record<string, unknown>; role: string }> }>; multi_entity_count: number };
                    await stageSplitProposals(batchId, r.outputId, result.split_proposals ?? []);
                    await refetchSplits();
                    toast.success(`${result.multi_entity_count ?? 0} multi-entity rows found`);
                  } else {
                    toast.error(r.message);
                  }
                } finally {
                  setExtractorRunning(false);
                }
              }}
            >
              {extractorRunning ? (
                <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Extracting…</>
              ) : (
                <><Sparkles className="mr-2 h-3 w-3" />Extract Entities</>
              )}
            </Button>
            <span className="text-xs text-muted-foreground">Find rows containing multiple entities (e.g. company + contact)</span>
          </div>

          {/* Split proposals list */}
          {splitProposals.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">{splitProposals.length} proposed splits</div>
              {splitProposals.map((proposal) => (
                <div key={proposal.id} className="rounded border border-border bg-background p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-muted-foreground">
                      {proposal.entity_type} — {proposal.role ?? ""}
                    </span>
                    <div className="flex gap-1">
                      {proposal.review_status === "pending" && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs text-won"
                            onClick={async () => {
                              await reviewSplitProposal(proposal.id, "accepted");
                              const db = (await import("@/integrations/supabase/client")).supabase;
                              const { data: maxRow } = await db.from("import_rows").select("row_number").eq("batch_id", batchId).order("row_number", { ascending: false }).limit(1).maybeSingle();
                              const nextRowNumber = (maxRow?.row_number ?? 0) + 1;
                              await acceptSplitProposalToRow(proposal, batchId, nextRowNumber);
                              await refetchSplits();
                            }}
                          >
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs text-muted-foreground"
                            onClick={async () => {
                              await reviewSplitProposal(proposal.id, "rejected");
                              await refetchSplits();
                            }}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                      {proposal.review_status !== "pending" && (
                        <span className={cn(
                          "px-2 py-0.5 rounded text-2xs font-medium",
                          proposal.review_status === "accepted"
                            ? "bg-won/20 text-won"
                            : "bg-muted text-muted-foreground",
                        )}>
                          {proposal.review_status}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-muted-foreground font-mono text-2xs break-all">
                    {JSON.stringify(proposal.proposed_payload).slice(0, 200)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* relationship_resolver — enabled only when accepted splits exist */}
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              disabled={resolverRunning || extractorRunning || acceptedSplits.length === 0}
              onClick={async () => {
                setResolverRunning(true);
                try {
                  const r = await callImportAgent(batchId, "relationship_resolver");
                  if (r.ok) {
                    setResolverOutput(r.result as Record<string, unknown>);
                    setAcceptedLinkIds(new Map());
                    setDismissedLinkIds(new Set());
                    toast.success("Relationships resolved");
                  } else {
                    toast.error(r.message);
                  }
                } finally {
                  setResolverRunning(false);
                }
              }}
            >
              {resolverRunning ? (
                <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Resolving…</>
              ) : (
                <><Sparkles className="mr-2 h-3 w-3" />Resolve Relationships</>
              )}
            </Button>
            {acceptedSplits.length === 0 && (
              <span className="text-xs text-muted-foreground">Accept at least one split proposal first</span>
            )}
          </div>

          {/* relationship_resolver results */}
          {resolverOutput && (
            <div className="rounded border border-border bg-background p-3 text-sm space-y-1">
              <div className="font-medium mb-1">Proposed relationships ({(resolverOutput.links as unknown[])?.length ?? 0}):</div>
              {(resolverOutput.links as Array<{ from_entity_ref: string; to_entity_ref: string; relationship_type: string; confidence: number; rationale: string; source_row_id?: string }>).slice(0, 10).map((link, i) => {
                const isAccepted = acceptedLinkIds.has(i);
                const acceptedStructured = acceptedLinkIds.get(i);
                const isDismissed = dismissedLinkIds.has(i);
                return (
                  <div key={i} className={cn("flex items-center gap-2 text-xs py-0.5", isDismissed && "opacity-40 line-through")}>
                    <span className="font-mono">{link.from_entity_ref.slice(0, 8)}…</span>
                    {" "}→ <span className="text-primary">{link.relationship_type}</span> →{" "}
                    <span className="font-mono">{link.to_entity_ref.slice(0, 8)}…</span>
                    <span className="ml-1 opacity-60">({Math.round(link.confidence * 100)}%)</span>
                    {!isAccepted && !isDismissed && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1.5 text-2xs text-won ml-auto"
                          onClick={async () => {
                            try {
                              const result = await acceptResolvedLink({
                                batchId,
                                fromRef: link.from_entity_ref,
                                toRef: link.to_entity_ref,
                                relationshipType: link.relationship_type,
                                confidence: link.confidence,
                                rationale: link.rationale,
                              });
                              setAcceptedLinkIds((prev) => new Map(prev).set(i, result.structured));
                              toast.success(result.structured ? "Relationship saved" : (result.message ?? "Saved as a note"));
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : "Failed to save relationship");
                            }
                          }}
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1.5 text-2xs text-muted-foreground"
                          onClick={() => setDismissedLinkIds((prev) => new Set([...prev, i]))}
                        >
                          Dismiss
                        </Button>
                      </>
                    )}
                    {isAccepted && (
                      <span className={cn(
                        "ml-auto px-1.5 py-0.5 rounded text-2xs font-medium",
                        acceptedStructured ? "bg-won/20 text-won" : "bg-amber/20 text-amber-light",
                      )}>
                        {acceptedStructured ? "saved" : "note only"}
                      </span>
                    )}
                  </div>
                );
              })}
              {(resolverOutput.unresolved as unknown[])?.length > 0 && (
                <div className="text-xs text-amber-light mt-1">
                  {(resolverOutput.unresolved as Array<{ entity_ref: string; reason: string }>).length} unresolved
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Data Cleanup + Contact Mapping — same gate as Entity Extraction above */}
      {(batch?.status === "duplicate_review" || batch?.status === "pending_approval") && (
        <div className="mb-4 rounded-lg border border-muted bg-muted/30 p-4 space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Sparkles className="h-4 w-4" />
            Data Quality &amp; Contact Mapping
          </div>

          {/* data_cleanup */}
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              disabled={cleanupRunning}
              onClick={async () => {
                setCleanupRunning(true);
                try {
                  const r = await runDataCleanup(batchId);
                  if (r.ok) {
                    setCleanupResult(r);
                    setAppliedCorrectionIds(new Set());
                    setFlaggedDuplicateRowIds(new Set());
                    toast.success("Data cleanup complete");
                  } else {
                    toast.error(r.error ?? "Data cleanup failed");
                  }
                } finally {
                  setCleanupRunning(false);
                }
              }}
            >
              {cleanupRunning ? (
                <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Analyzing…</>
              ) : (
                <><Sparkles className="mr-2 h-3 w-3" />Clean Up Data</>
              )}
            </Button>
          </div>

          {cleanupResult?.ok && (
            <div className="rounded border border-border bg-background p-3 text-sm space-y-3">
              {cleanupResult.quality_score != null && (
                <div className="flex items-center gap-2">
                  <span className="font-medium">Quality score: {cleanupResult.quality_score}/100</span>
                  {cleanupResult.quality_summary && (
                    <span className="text-xs text-muted-foreground">{cleanupResult.quality_summary}</span>
                  )}
                </div>
              )}

              {cleanupResult.corrections && cleanupResult.corrections.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Corrections ({cleanupResult.corrections.length})</div>
                  {cleanupResult.corrections.slice(0, 15).map((c, i) => {
                    const applied = appliedCorrectionIds.has(i);
                    return (
                      <div key={i} className={cn("flex flex-wrap items-center gap-2 text-xs py-0.5", applied && "opacity-50")}>
                        <span className="text-muted-foreground">{c.field}:</span>
                        <span className="line-through opacity-70">{c.original}</span>
                        {"→"}
                        <span className="text-won">{c.corrected}</span>
                        <span className="opacity-60">({c.reason})</span>
                        {!applied ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 px-1.5 text-2xs text-won ms-auto"
                            onClick={async () => {
                              try {
                                const { data: existingRow } = await (await import("@/integrations/supabase/client")).supabase
                                  .from("import_rows").select("id, raw_data").eq("id", c.row_id).single();
                                if (existingRow) {
                                  await (await import("@/integrations/supabase/client")).supabase
                                    .from("import_rows")
                                    .update({ raw_data: { ...(existingRow.raw_data as object), [c.field]: c.corrected } })
                                    .eq("id", c.row_id);
                                }
                                setAppliedCorrectionIds((prev) => new Set([...prev, i]));
                                toast.success("Correction applied");
                              } catch {
                                toast.error("Failed to apply correction");
                              }
                            }}
                          >
                            Apply
                          </Button>
                        ) : (
                          <span className="ms-auto rounded bg-won/20 px-1.5 py-0.5 text-2xs font-medium text-won">applied</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {cleanupResult.duplicates && cleanupResult.duplicates.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Possible duplicates ({cleanupResult.duplicates.length})</div>
                  {cleanupResult.duplicates.slice(0, 15).map((d, i) => (
                    <div key={i} className="space-y-1 text-xs">
                      <div className="opacity-70">{d.duplicate_type} — {d.reason}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {d.row_ids.map((rowId) => {
                          const flagged = flaggedDuplicateRowIds.has(rowId);
                          return (
                            <Button
                              key={rowId}
                              size="sm"
                              variant="ghost"
                              disabled={flagged}
                              className="h-5 px-1.5 text-2xs"
                              onClick={async () => {
                                try {
                                  await (await import("@/integrations/supabase/client")).supabase
                                    .from("import_rows").update({ status: "duplicate" }).eq("id", rowId);
                                  setFlaggedDuplicateRowIds((prev) => new Set([...prev, rowId]));
                                  toast.success("Row flagged as duplicate");
                                } catch {
                                  toast.error("Failed to flag row");
                                }
                              }}
                            >
                              {flagged ? "flagged" : `mark ${rowId.slice(0, 8)}… duplicate`}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* contact_mapping */}
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              disabled={mappingRunning}
              onClick={async () => {
                setMappingRunning(true);
                try {
                  const r = await runContactMapping(batchId);
                  if (r.ok) {
                    setMappingResult(r);
                    setAcceptedContactLinkIds(new Map());
                    toast.success("Contact mapping complete");
                  } else {
                    toast.error(r.error ?? "Contact mapping failed");
                  }
                } finally {
                  setMappingRunning(false);
                }
              }}
            >
              {mappingRunning ? (
                <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Mapping…</>
              ) : (
                <><Sparkles className="mr-2 h-3 w-3" />Map Contacts to Companies</>
              )}
            </Button>
          </div>

          {mappingResult?.ok && (
            <div className="rounded border border-border bg-background p-3 text-sm space-y-3">
              {mappingResult.classifications && mappingResult.classifications.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Row classifications ({mappingResult.classifications.length})</div>
                  <div className="flex flex-wrap gap-1.5">
                    {mappingResult.classifications.slice(0, 20).map((c, i) => (
                      <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-2xs" title={c.reason}>
                        {c.row_id.slice(0, 8)}… → {c.entity_type} ({Math.round(c.confidence * 100)}%)
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {mappingResult.contact_company_links && mappingResult.contact_company_links.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">
                    Proposed contact ↔ company links ({mappingResult.contact_company_links.length})
                  </div>
                  {mappingResult.contact_company_links.slice(0, 15).map((link, i) => {
                    const accepted = acceptedContactLinkIds.has(i);
                    const structured = acceptedContactLinkIds.get(i);
                    return (
                      <div key={i} className="flex flex-wrap items-center gap-2 text-xs py-0.5">
                        <span className="font-mono">{link.contact_row_id.slice(0, 8)}…</span>
                        {" → "}
                        <span className="text-primary">{link.company_name}</span>
                        <span className="opacity-60">({Math.round(link.confidence * 100)}% · {link.match_basis})</span>
                        {!accepted ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 px-1.5 text-2xs text-won ms-auto"
                            onClick={async () => {
                              try {
                                const result = await acceptResolvedLink({
                                  batchId,
                                  fromRef: link.contact_row_id,
                                  toRef: link.company_row_id ?? link.company_name,
                                  relationshipType: "contact_of",
                                  confidence: link.confidence,
                                  rationale: link.match_basis,
                                });
                                setAcceptedContactLinkIds((prev) => new Map(prev).set(i, result.structured));
                                toast.success(result.structured ? "Link saved" : (result.message ?? "Saved as a note"));
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Failed to save link");
                              }
                            }}
                          >
                            Accept
                          </Button>
                        ) : (
                          <span className={cn(
                            "ms-auto rounded px-1.5 py-0.5 text-2xs font-medium",
                            structured ? "bg-won/20 text-won" : "bg-amber/20 text-amber-light",
                          )}>
                            {structured ? "saved" : "note only"}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {mappingResult.suggested_splits && mappingResult.suggested_splits.length > 0 && (
                <div className="text-xs text-amber-light">
                  {mappingResult.suggested_splits.length} row(s) may contain more than one entity — use Entity Extraction above to split them.
                </div>
              )}
            </div>
          )}
        </div>
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
          {["pending_approval", "approved", "dry_run", "committed"].includes(batch?.status ?? "") && (
            <TabsTrigger value="candidates">Candidates {candidates.length > 0 && `(${candidates.length})`}</TabsTrigger>
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
          {/* Mapping Step AI Panel — shown when batch is in mapping status */}
          {batch?.status === "mapping" && (
            <div className="mb-4 rounded-lg border border-muted bg-muted/30 p-4 space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Sparkles className="h-4 w-4" />
                AI Assist
              </div>

              {/* workbook_classifier */}
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={aiRunning}
                  onClick={async () => {
                    setAiRunning(true);
                    setAiStep("workbook_classifier");
                    try {
                      const r = await callImportAgent(batchId, "workbook_classifier");
                      if (r.ok) {
                        setMappingAiAgent("workbook_classifier");
                        setMappingAiOutput(r.result as Record<string, unknown>);
                        toast.success("Workbook classified");
                      } else {
                        toast.error(r.message);
                      }
                    } finally {
                      setAiRunning(false);
                      setAiStep("");
                    }
                  }}
                >
                  {aiRunning && aiStep === "workbook_classifier" ? (
                    <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Classifying…</>
                  ) : (
                    <><Sparkles className="mr-2 h-3 w-3" />Classify with AI</>
                  )}
                </Button>
                <span className="text-xs text-muted-foreground">Auto-detect what entity type this file contains</span>
              </div>

              {/* workbook_classifier result */}
              {mappingAiAgent === "workbook_classifier" && mappingAiOutput && (
                <div className="rounded border border-border bg-background p-3 text-sm space-y-1">
                  <div className="font-medium">
                    Detected: <span className="text-primary">{String(mappingAiOutput.detected_entity_type)}</span>
                    {" "}({String(mappingAiOutput.detected_source_kind)})
                    <span className="ml-2 text-muted-foreground">
                      {Math.round(Number(mappingAiOutput.confidence) * 100)}% confidence
                    </span>
                  </div>
                  <div className="text-muted-foreground text-xs">{String(mappingAiOutput.rationale)}</div>
                  {(mappingAiOutput.warnings as string[])?.length > 0 && (
                    <div className="mt-1 text-amber-light text-xs">
                      {(mappingAiOutput.warnings as string[]).join(" · ")}
                    </div>
                  )}
                </div>
              )}

              {/* sheet_classifier — only when file has multiple sheets */}
              {((files as any[])?.[0]?.sheet_count ?? 1) > 1 && (
                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={aiRunning}
                    onClick={async () => {
                      setAiRunning(true);
                      setAiStep("sheet_classifier");
                      try {
                        const r = await callImportAgent(batchId, "sheet_classifier");
                        if (r.ok) {
                          setSheetAiOutput(r.result as Record<string, unknown>);
                          toast.success("Sheets classified");
                        } else {
                          toast.error(r.message);
                        }
                      } finally {
                        setAiRunning(false);
                        setAiStep("");
                      }
                    }}
                  >
                    {aiRunning && aiStep === "sheet_classifier" ? (
                      <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Classifying Sheets…</>
                    ) : (
                      <><Sparkles className="mr-2 h-3 w-3" />Classify Sheets</>
                    )}
                  </Button>
                  <span className="text-xs text-muted-foreground">Recommend which sheet(s) to import</span>
                </div>
              )}

              {/* sheet_classifier result */}
              {sheetAiOutput && (
                <div className="rounded border border-border bg-background p-3 text-sm space-y-1">
                  <div className="font-medium mb-1">Sheet recommendations:</div>
                  {(sheetAiOutput.sheets as Array<{ sheet_name: string; detected_entity_type: string; confidence: number; recommended_action: string; rationale: string }>).map((s) => (
                    <div key={s.sheet_name} className="flex items-center gap-2 text-xs">
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-2xs font-medium",
                        s.recommended_action === "import" ? "bg-won/20 text-won" :
                        s.recommended_action === "skip"   ? "bg-muted text-muted-foreground" :
                                                            "bg-amber/20 text-amber-light",
                      )}>
                        {s.recommended_action}
                      </span>
                      <span className="font-mono">{s.sheet_name}</span>
                      <span className="text-muted-foreground">→ {s.detected_entity_type} ({Math.round(s.confidence * 100)}%)</span>
                    </div>
                  ))}
                </div>
              )}

              {/* semantic_field_mapper */}
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={aiRunning}
                  onClick={async () => {
                    setAiRunning(true);
                    setAiStep("semantic_field_mapper");
                    try {
                      const r = await callImportAgent(batchId, "semantic_field_mapper");
                      if (r.ok) {
                        const result = r.result as { proposals: Array<{ source_column: string; suggested_target: string; confidence: number; rationale: string }> };
                        setMapperProposals(
                          (result.proposals ?? []).map((p) => ({ ...p, dismissed: false })),
                        );
                        toast.success(`${result.proposals?.length ?? 0} mapping suggestions ready`);
                      } else {
                        toast.error(r.message);
                      }
                    } finally {
                      setAiRunning(false);
                      setAiStep("");
                    }
                  }}
                >
                  {aiRunning && aiStep === "semantic_field_mapper" ? (
                    <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Suggesting…</>
                  ) : (
                    <><Sparkles className="mr-2 h-3 w-3" />Suggest Mappings</>
                  )}
                </Button>
                <span className="text-xs text-muted-foreground">AI proposes target fields for unmapped columns</span>
              </div>
            </div>
          )}
          <MappingPanel
            batchId={batchId}
            entity={batch.target_entity as ImportTargetEntity}
            mappings={mappings}
            files={files as any[]}
            busy={!!busy || aiRunning}
            onSaved={refresh}
            mapperProposals={mapperProposals}
            setMapperProposals={setMapperProposals}
            qc={qc}
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
                          <span className={cn("rounded px-1.5 py-0.5 text-2xs font-medium", rowStatusClass(row.status))}>
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
                  <p className="px-3 py-2 text-2xs text-muted-foreground">
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
                          <span className={e.severity === "error" ? "text-destructive" : "text-amber-light"}>
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
              {/* change_interpreter — only for recurring batches with a source_profile_id */}
              {batch?.status === "duplicate_review" && batch?.source_profile_id && (
                <div className="mb-4 rounded-lg border border-muted bg-muted/30 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <Sparkles className="h-4 w-4" />
                      Recurring Import Changes
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={changeRunning}
                      onClick={async () => {
                        setChangeRunning(true);
                        try {
                          const r = await callImportAgent(batchId, "change_interpreter");
                          if (r.ok) {
                            setChangeOutput(r.result as Record<string, unknown>);
                            toast.success("Change summary ready");
                          } else {
                            toast.error(r.message);
                          }
                        } finally {
                          setChangeRunning(false);
                        }
                      }}
                    >
                      {changeRunning ? (
                        <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Interpreting…</>
                      ) : (
                        <><Sparkles className="mr-2 h-3 w-3" />Interpret Changes</>
                      )}
                    </Button>
                  </div>

                  {changeOutput && (
                    <div className="space-y-2 text-sm">
                      {/* Hold warning */}
                      {changeOutput.recommended_action === "hold" && (
                        <div className="flex items-center gap-2 rounded bg-destructive/10 border border-destructive/30 px-3 py-2 text-destructive text-xs">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          AI recommends holding this import — review notable changes below before proceeding.
                        </div>
                      )}

                      <div className="text-muted-foreground text-xs">{String(changeOutput.change_summary)}</div>

                      <div className="flex gap-4 text-xs">
                        <span className="text-won">+{Number(changeOutput.new_records_count)} new</span>
                        <span className="text-info">~{Number(changeOutput.updated_records_count)} updated</span>
                        <span className="text-muted-foreground">-{Number(changeOutput.removed_records_count)} removed</span>
                      </div>

                      {(changeOutput.notable_changes as Array<{ description: string; severity: string }>).map((c, i) => (
                        <div key={i} className={cn(
                          "text-xs px-2 py-1 rounded",
                          c.severity === "critical" ? "bg-destructive/10 text-destructive" :
                          c.severity === "warning"  ? "bg-amber/10 text-amber-light" :
                                                      "bg-muted/50 text-muted-foreground",
                        )}>
                          {c.description}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

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

        {/* Commit candidates — staged per-row create/update/duplicate decisions,
            grouped by the entity type they'll land in. Nothing here is a live
            CRM write; this is the review step before that (Part 3). */}
        <TabsContent value="candidates">
          <Panel
            title="Commit candidates"
            action={
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => runStep("Analyze & Distribute", () => generateCandidates(batchId))}
              >
                {busy === "Analyze & Distribute" ? (
                  <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Analyzing…</>
                ) : (
                  <><Sparkles className="mr-2 h-3 w-3" />Analyze & Distribute</>
                )}
              </Button>
            }
          >
            <p className="text-xs text-muted-foreground mb-3">
              Each row is staged as create / update / duplicate / needs review, grouped by
              where it will land in the system. Nothing is written to live records yet —
              review and approve or reject here first.
            </p>
            {candidates.length === 0 ? (
              <EmptyState message="No candidates yet — click Analyze & Distribute above." />
            ) : (
              <div className="space-y-5">
                {Object.entries(groupByEntity(candidates)).map(([entityType, group]) => (
                  <div key={entityType}>
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {humanizeEntity(entityType)}
                      <span className="text-muted-foreground/60">({group.length})</span>
                    </div>
                    <div className="overflow-auto rounded border border-border">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border bg-muted/20">
                            <th className="px-3 py-2 text-left text-muted-foreground font-medium">Action</th>
                            <th className="px-3 py-2 text-left text-muted-foreground font-medium">Preview</th>
                            <th className="px-3 py-2 text-left text-muted-foreground font-medium">Reason</th>
                            <th className="px-3 py-2 text-left text-muted-foreground font-medium">Status</th>
                            <th className="px-3 py-2 text-right text-muted-foreground font-medium">Review</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.map((c) => (
                            <tr key={c.id} className="border-b border-border/50">
                              <td className="px-3 py-1.5">
                                <span className={cn("rounded-full px-2 py-0.5 text-2xs font-medium", candidateActionClass(c.proposed_action))}>
                                  {c.proposed_action}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 text-foreground">{previewPayload(c.proposed_payload)}</td>
                              <td className="px-3 py-1.5 text-muted-foreground">{c.reason ?? "—"}</td>
                              <td className="px-3 py-1.5">
                                <span className={cn("text-2xs", candidateStatusClass(c.review_status))}>
                                  {c.review_status}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                {(c.review_status === "pending" || c.review_status === "needs_review") && (
                                  <div className="inline-flex gap-1">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 px-2 text-2xs"
                                      disabled={reviewingCandidateId === c.id}
                                      onClick={async () => {
                                        setReviewingCandidateId(c.id);
                                        try {
                                          await updateCandidateReview(c.id, "approved");
                                          qc.invalidateQueries({ queryKey: ["import-candidates", batchId] });
                                        } catch (e) {
                                          toast.error(e instanceof Error ? e.message : "Failed to approve");
                                        } finally {
                                          setReviewingCandidateId(null);
                                        }
                                      }}
                                    >
                                      Approve
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 px-2 text-2xs text-destructive hover:text-destructive"
                                      disabled={reviewingCandidateId === c.id}
                                      onClick={async () => {
                                        setReviewingCandidateId(c.id);
                                        try {
                                          await updateCandidateReview(c.id, "rejected");
                                          qc.invalidateQueries({ queryKey: ["import-candidates", batchId] });
                                        } catch (e) {
                                          toast.error(e instanceof Error ? e.message : "Failed to reject");
                                        } finally {
                                          setReviewingCandidateId(null);
                                        }
                                      }}
                                    >
                                      Reject
                                    </Button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </TabsContent>

        {/* Approval */}
        <TabsContent value="approval">
          <ApprovalPanel
            batch={batch}
            batchId={batchId}
            canApprove={canApprove}
            busy={!!busy}
            onStep={runStep}
            reviewerOutput={reviewerOutput}
            reviewerRunning={reviewerRunning}
            setReviewerOutput={setReviewerOutput}
            setReviewerRunning={setReviewerRunning}
            approvedCandidateCount={candidates.filter((c) => c.review_status === "approved").length}
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
                "h-6 w-6 rounded-full flex items-center justify-center text-2xs font-bold border-2 shrink-0 transition-colors",
                done    && "border-won bg-won/20 text-won",
                current && !failed && "border-won bg-won/10 text-won",
                current && failed  && "border-destructive bg-destructive/20 text-destructive",
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
                "text-2xs font-medium text-center leading-tight hidden sm:block",
                done           ? "text-won"  :
                current && !failed ? "text-foreground" :
                                 "text-muted-foreground",
              )}>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn("h-px flex-1 mx-1 transition-colors", done ? "bg-won/40" : "bg-border")} />
            )}
          </div>
        );
      })}
    </nav>
  );
}

// ---------- Mapping panel -----------------------------------------------------

function MappingPanel({
  batchId, entity, mappings, files, busy, onSaved, mapperProposals, setMapperProposals, qc,
}: {
  batchId: string;
  entity: ImportTargetEntity;
  mappings: ImportMapping[];
  files: { column_names?: string[] }[];
  busy: boolean;
  onSaved: () => void;
  mapperProposals?: Array<{ source_column: string; suggested_target: string; confidence: number; rationale: string; dismissed: boolean }>;
  setMapperProposals?: React.Dispatch<React.SetStateAction<Array<{ source_column: string; suggested_target: string; confidence: number; rationale: string; dismissed: boolean }>>>;
  qc?: ReturnType<typeof useQueryClient>;
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
          <div key={srcCol} className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
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
            {/* AI mapping proposal chip */}
            {(() => {
              const proposal = mapperProposals?.find(
                (p) => p.source_column === srcCol && !p.dismissed,
              );
              if (!proposal) return null;
              return (
                <div className="ml-52 flex items-center gap-1 text-xs">
                  <Sparkles className="h-3 w-3 text-violet-400" />
                  <span className="text-muted-foreground">
                    AI suggests: <span className="text-violet-400 font-medium">{proposal.suggested_target}</span>
                    {" "}({Math.round(proposal.confidence * 100)}%)
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1 text-xs text-won"
                    onClick={() => {
                      const merged = { ...localMappings, [proposal.source_column]: proposal.suggested_target };
                      setLocalMappings(merged);
                      const toSave = Object.entries(merged)
                        .filter(([, t]) => t && t !== "__skip__")
                        .map(([source_column, target_column]) => ({
                          source_column,
                          target_table: entity,
                          target_column,
                          transform: null as string | null,
                          is_key: false,
                        }));
                      saveMappings(batchId, toSave)
                        .then(() => qc?.invalidateQueries({ queryKey: ["import-mappings", batchId] }));
                      setMapperProposals?.((prev) =>
                        prev.map((p) => p.source_column === proposal.source_column ? { ...p, dismissed: true } : p),
                      );
                    }}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1 text-xs text-muted-foreground"
                    onClick={() =>
                      setMapperProposals?.((prev) =>
                        prev.map((p) => p.source_column === proposal.source_column ? { ...p, dismissed: true } : p),
                      )
                    }
                  >
                    Dismiss
                  </Button>
                </div>
              );
            })()}
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
  batch, batchId, canApprove, busy, onStep,
  reviewerOutput, reviewerRunning, setReviewerOutput, setReviewerRunning,
  approvedCandidateCount,
}: {
  batch: ImportBatch;
  batchId: string;
  canApprove: boolean;
  busy: boolean;
  onStep: (label: string, fn: () => Promise<unknown>) => void;
  reviewerOutput: Record<string, unknown> | null;
  reviewerRunning: boolean;
  setReviewerOutput: React.Dispatch<React.SetStateAction<Record<string, unknown> | null>>;
  setReviewerRunning: React.Dispatch<React.SetStateAction<boolean>>;
  approvedCandidateCount: number;
}) {
  const [commitResult, setCommitResult] = useState<{ committed: number; failed: number; total: number } | null>(null);
  const [dryRunResult, setDryRunResult] = useState<{ would_create: number; would_skip_duplicates: number; would_skip_errors: number } | null>(null);
  const [rollbackResult, setRollbackResult] = useState<{ rolled_back: number; still_referenced: number; manual_review_required: number; total: number } | null>(null);

  const [checklist, setChecklist] = useState<ReadinessChecklist>({});
  const [checklistLoading, setChecklistLoading] = useState(true);
  const autoChecklist = deriveAutoChecklist(batch);
  const mergedChecklist = { ...autoChecklist, ...checklist };
  const manualItems = READINESS_ITEMS.filter((i) => i.manual);
  const allManualDone = manualItems.every((i) => mergedChecklist[i.key]);

  React.useEffect(() => {
    setChecklistLoading(true);
    getReadinessChecklist(batchId).then((c) => {
      setChecklist(c);
      setChecklistLoading(false);
    });
  }, [batchId]);

  async function toggleManualItem(key: string, checked: boolean) {
    const updated = { ...checklist, [key]: checked };
    setChecklist(updated);
    await saveReadinessChecklist(batchId, updated);
  }

  const isPendingApproval = batch.status === "pending_approval";
  const isApproved        = batch.status === "approved";
  const isDryRun          = batch.status === "dry_run";
  const isCommitted       = batch.status === "committed";
  const isRolledBack      = batch.status === "rolled_back";

  const hasCritical = (reviewerOutput?.findings as Array<{ severity: string }> ?? []).some(
    (f) => f.severity === "critical",
  );

  if (isCommitted) {
    return (
      <Panel title="Committed">
        <div className="flex items-center gap-2 text-won">
          <CheckCircle2 className="h-5 w-5" />
          <p className="text-sm font-medium">This batch has been committed to the CRM.</p>
        </div>
        {commitResult && (
          <p className="mt-2 text-xs text-muted-foreground">
            {commitResult.committed} created · {commitResult.failed} failed · {commitResult.total} total
          </p>
        )}

        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Roll back this batch</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Deletes records this batch created. Records it updated, or that are now
                referenced elsewhere, can't be auto-reverted and need manual review.
              </p>
            </div>
            <Button
              size="sm"
              disabled={!canApprove || busy}
              onClick={() => onStep("Roll back", async () => {
                const r = await rollbackBatch(batch.id);
                setRollbackResult(r);
              })}
              className="shrink-0 border-destructive/40 bg-destructive/10 text-destructive/80 hover:bg-destructive/20 border"
            >
              <Undo2 className="h-3.5 w-3.5 mr-1.5" />
              Roll Back
            </Button>
          </div>
        </div>
      </Panel>
    );
  }

  if (isRolledBack) {
    return (
      <Panel title="Rolled back">
        <div className="flex items-center gap-2 text-amber-light">
          <Undo2 className="h-5 w-5" />
          <p className="text-sm font-medium">This batch's CRM writes have been rolled back.</p>
        </div>
        {rollbackResult && (
          <p className="mt-2 text-xs text-muted-foreground">
            {rollbackResult.rolled_back} reverted · {rollbackResult.still_referenced} still referenced (kept) ·{" "}
            {rollbackResult.manual_review_required} need manual review · {rollbackResult.total} total
          </p>
        )}
      </Panel>
    );
  }

  return (
    <Panel title="Approval & Commit">
      {!canApprove && (
        <div className="rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-xs text-amber-light mb-4">
          You need a manager role (System Admin, Managing Director, General Manager, CEO, or Sales Manager) to approve and commit imports.
        </div>
      )}

      {/* Readiness checklist — required before commit */}
      <div className="mb-4 rounded-lg border border-border bg-surface p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          Pre-commit Readiness Checklist
        </div>
        <p className="text-xs text-muted-foreground">All manual items must be confirmed before committing data to the CRM.</p>
        {checklistLoading ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-2">
            {READINESS_ITEMS.map((item) => {
              const checked = !!mergedChecklist[item.key];
              return (
                <label
                  key={item.key}
                  className={cn(
                    "flex items-center gap-3 rounded-md border px-3 py-2 text-xs cursor-pointer transition-colors",
                    checked
                      ? "border-won/30 bg-won/[0.05] text-won"
                      : "border-border bg-transparent text-muted-foreground hover:border-border/80",
                    !item.manual && "cursor-default opacity-70",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!item.manual || isCommitted}
                    onChange={(e) => item.manual && toggleManualItem(item.key, e.target.checked)}
                    className="h-3.5 w-3.5 accent-won shrink-0"
                  />
                  <span className="flex-1">{item.label}</span>
                  {!item.manual && (
                    <span className="text-2xs text-muted-foreground/60 shrink-0">auto</span>
                  )}
                </label>
              );
            })}
          </div>
        )}
        {!allManualDone && !checklistLoading && (
          <p className="text-xs text-amber-light flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Complete all manual items above before committing.
          </p>
        )}
      </div>

      <div className="space-y-3">
        {/* import_routing_reviewer — shown in pending_approval for approve-capable users */}
        {batch?.status === "pending_approval" && canApprove && (
          <div className="mb-4 rounded-lg border border-muted bg-muted/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <ShieldCheck className="h-4 w-4" />
                Final AI Review
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={reviewerRunning}
                onClick={async () => {
                  setReviewerRunning(true);
                  try {
                    const r = await callImportAgent(batchId, "import_routing_reviewer");
                    if (r.ok) {
                      setReviewerOutput(r.result as Record<string, unknown>);
                      toast.success("Review complete");
                    } else {
                      toast.error(r.message);
                    }
                  } finally {
                    setReviewerRunning(false);
                  }
                }}
              >
                {reviewerRunning ? (
                  <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Reviewing…</>
                ) : (
                  <><ShieldCheck className="mr-2 h-3 w-3" />Run Final Review</>
                )}
              </Button>
            </div>

            {reviewerOutput && (
              <div className="space-y-2">
                <div className={cn(
                  "text-xs font-medium px-2 py-1 rounded inline-block",
                  reviewerOutput.overall_recommendation === "approve" ? "bg-won/15 text-won" :
                  reviewerOutput.overall_recommendation === "hold"    ? "bg-destructive/15 text-destructive" :
                                                                        "bg-amber/15 text-amber-light",
                )}>
                  AI: {String(reviewerOutput.overall_recommendation).toUpperCase()}
                  {" "}({Math.round(Number(reviewerOutput.confidence) * 100)}% confidence)
                </div>

                <div className="space-y-1">
                  {(reviewerOutput.findings as Array<{ severity: string; title: string; description: string }>).map((f, i) => (
                    <div key={i} className={cn(
                      "text-xs px-2 py-1.5 rounded flex gap-2",
                      f.severity === "critical" ? "bg-destructive/10 text-destructive" :
                      f.severity === "warning"  ? "bg-amber/10 text-amber-light" :
                                                  "bg-muted/50 text-muted-foreground",
                    )}>
                      <span className="font-medium shrink-0">{f.title}:</span>
                      <span>{f.description}</span>
                    </div>
                  ))}
                </div>

                {(reviewerOutput.findings as Array<{ severity: string }>).some((f) => f.severity === "critical") && (
                  <div className="text-2xs text-muted-foreground">
                    Advisory only — you may still approve. Findings are for your awareness.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 1: Approve */}
        <div className={cn("rounded-md border px-4 py-3", isPendingApproval ? "border-won/30 bg-won/[0.05]" : "border-border opacity-60")}>
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
              {hasCritical && (
                <span className="ml-1.5 rounded bg-destructive/20 px-1.5 py-0.5 text-[9px] font-medium text-destructive">
                  ⚠ Critical
                </span>
              )}
            </Button>
          </div>
        </div>

        {/* Step 2: Dry run */}
        <div className={cn("rounded-md border px-4 py-3", isApproved ? "border-amber/30 bg-amber/5" : "border-border opacity-60")}>
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

        {/* Step 3: Commit — writes every approved candidate from the
            Candidates tab to its real CRM table. Requires at least one
            approved candidate; nothing unreviewed is ever written. */}
        <div className={cn("rounded-md border px-4 py-3", isDryRun ? "border-destructive/30 bg-destructive/5" : "border-border opacity-60")}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">3. Commit to CRM</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {approvedCandidateCount > 0
                  ? `Writes ${approvedCandidateCount} approved candidate${approvedCandidateCount === 1 ? "" : "s"} to live CRM tables. This cannot be undone (Roll Back is available after).`
                  : "Approve at least one candidate in the Candidates tab before committing."}
              </p>
            </div>
            <Button
              size="sm"
              disabled={!isDryRun || !canApprove || busy || approvedCandidateCount === 0}
              onClick={() => onStep("Commit", async () => {
                const r = await commitBatch(batch.id);
                setCommitResult(r);
              })}
              className="shrink-0 border-destructive/40 bg-destructive/10 text-destructive/80 hover:bg-destructive/20 border"
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
