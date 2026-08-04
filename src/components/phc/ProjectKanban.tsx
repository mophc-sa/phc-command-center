// Job Pipeline — a flexible, user-defined Kanban board for a project
// (2026-08-03 client request). Stages are plain rows the team adds/renames/
// deletes themselves; there is deliberately no fixed stage enum.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Plus, X, Pencil, Trash2, GripVertical, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canReviewAiOutput } from "@/lib/roles";
import { getLatestAgentOutput, reviewAgentOutput, type AiAgentOutputRow } from "@/lib/ai-review-actions";
import { ActionDialog } from "@/components/phc/ActionDialog";
import {
  listJobStages,
  listJobs,
  createJobStage,
  renameJobStage,
  deleteJobStage,
  createJob,
  updateJob,
  deleteJob,
  moveJob,
  reorderJobs,
  applyJobAiNotes,
  type ProjectJob,
  type ProjectJobStage,
} from "@/lib/project-jobs-actions";
import { listTeamMembers } from "@/lib/opportunity-actions";

export function ProjectKanban({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { lang } = useI18n();
  const qc = useQueryClient();

  const stagesQ = useQuery({ queryKey: ["proj-stages", projectId], queryFn: () => listJobStages(projectId) });
  const jobsQ = useQuery({ queryKey: ["proj-jobs", projectId], queryFn: () => listJobs(projectId) });
  const teamQ = useQuery({ queryKey: ["team"], queryFn: listTeamMembers });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["proj-stages", projectId] });
    qc.invalidateQueries({ queryKey: ["proj-jobs", projectId] });
  };

  // Local column state so dragging feels instant; re-synced from the query
  // whenever it changes AND nothing is being dragged right now.
  const [columns, setColumns] = useState<Record<string, ProjectJob[]>>({});
  const [activeJob, setActiveJob] = useState<ProjectJob | null>(null);

  useEffect(() => {
    if (activeJob) return;
    const stages = stagesQ.data ?? [];
    const jobs = jobsQ.data ?? [];
    const next: Record<string, ProjectJob[]> = {};
    for (const s of stages) next[s.id] = jobs.filter((j) => j.stage_id === s.id).sort((a, b) => a.position - b.position);
    setColumns(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagesQ.data, jobsQ.data]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const [addStageOpen, setAddStageOpen] = useState(false);
  const [addJobFor, setAddJobFor] = useState<string | null>(null);
  const [editJob, setEditJob] = useState<ProjectJob | null>(null);
  const [renamingStage, setRenamingStage] = useState<ProjectJobStage | null>(null);
  const [aiJobFor, setAiJobFor] = useState<ProjectJob | null>(null);

  function findContainer(jobId: string): string | null {
    return Object.keys(columns).find((stageId) => columns[stageId].some((j) => j.id === jobId)) ?? null;
  }

  function handleDragStart(e: DragStartEvent) {
    const job = Object.values(columns).flat().find((j) => j.id === e.active.id) ?? null;
    setActiveJob(job);
  }

  function handleDragOver(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeContainer = findContainer(String(active.id));
    const overContainer = columns[String(over.id)] ? String(over.id) : findContainer(String(over.id));
    if (!activeContainer || !overContainer || activeContainer === overContainer) return;

    setColumns((prev) => {
      const activeItems = prev[activeContainer];
      const overItems = prev[overContainer];
      const activeIndex = activeItems.findIndex((j) => j.id === active.id);
      const overIndex = overItems.findIndex((j) => j.id === over.id);
      const [moved] = activeItems.splice(activeIndex, 1);
      const insertAt = overIndex >= 0 ? overIndex : overItems.length;
      overItems.splice(insertAt, 0, { ...moved, stage_id: overContainer });
      return { ...prev, [activeContainer]: [...activeItems], [overContainer]: [...overItems] };
    });
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveJob(null);
    if (!over) return;
    const container = columns[String(over.id)] ? String(over.id) : findContainer(String(over.id));
    if (!container) return;
    const items = columns[container];
    const oldIndex = items.findIndex((j) => j.id === active.id);
    const newIndex = items.findIndex((j) => j.id === over.id);
    let finalItems = items;
    if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
      finalItems = [...items];
      const [moved] = finalItems.splice(oldIndex, 1);
      finalItems.splice(newIndex, 0, moved);
      setColumns((prev) => ({ ...prev, [container]: finalItems }));
    }
    try {
      const activeJobRow = finalItems.find((j) => j.id === active.id);
      if (activeJobRow && activeJobRow.stage_id !== container) {
        await moveJob(String(active.id), container, finalItems.findIndex((j) => j.id === active.id));
      }
      await reorderJobs(finalItems.map((j, i) => ({ id: j.id, position: i })));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : (lang === "ar" ? "فشل تحديث الترتيب" : "Failed to save order"));
      invalidate();
    }
  }

  async function handleDeleteStage(stage: ProjectJobStage) {
    if (!confirm(lang === "ar" ? `حذف المرحلة "${stage.name}"؟ سيتم حذف كل البطاقات بداخلها.` : `Delete stage "${stage.name}"? All its cards will be deleted too.`)) return;
    try {
      await deleteJobStage(stage.id);
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  }

  async function handleDeleteJob(job: ProjectJob) {
    if (!confirm(lang === "ar" ? `حذف "${job.title}"؟` : `Delete "${job.title}"?`)) return;
    try {
      await deleteJob(job.id);
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  }

  const stages = stagesQ.data ?? [];
  const teamOptions = useMemo(
    () => (teamQ.data ?? []).map((m: any) => ({ value: m.id, label: m.full_name || m.email })),
    [teamQ.data],
  );

  if (stagesQ.isLoading || jobsQ.isLoading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">{lang === "ar" ? "جارٍ التحميل…" : "Loading…"}</div>;
  }

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {stages.map((stage) => (
            <KanbanColumn
              key={stage.id}
              stage={stage}
              jobs={columns[stage.id] ?? []}
              canEdit={canEdit}
              lang={lang}
              onAddJob={() => setAddJobFor(stage.id)}
              onEditJob={setEditJob}
              onDeleteJob={handleDeleteJob}
              onAiAssist={setAiJobFor}
              onRenameStage={() => setRenamingStage(stage)}
              onDeleteStage={() => handleDeleteStage(stage)}
            />
          ))}
          {canEdit ? (
            <button
              type="button"
              onClick={() => setAddStageOpen(true)}
              className="flex h-fit min-w-[220px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-transparent px-4 py-3 text-xs font-medium text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              {lang === "ar" ? "إضافة مرحلة" : "Add stage"}
            </button>
          ) : null}
        </div>
        <DragOverlay>
          {activeJob ? <JobCard job={activeJob} lang={lang} dragging canEdit={false} onEdit={() => {}} onDelete={() => {}} /> : null}
        </DragOverlay>
      </DndContext>

      {canEdit ? (
        <ActionDialog
          open={addStageOpen}
          onOpenChange={setAddStageOpen}
          title={lang === "ar" ? "إضافة مرحلة" : "Add stage"}
          submitLabel={lang === "ar" ? "إضافة" : "Add"}
          fields={[{ key: "name", type: "text", label: lang === "ar" ? "اسم المرحلة" : "Stage name", required: true }]}
          onSubmit={async (v) => {
            await createJobStage(projectId, v.name, stages.length);
            invalidate();
          }}
        />
      ) : null}

      {canEdit && renamingStage ? (
        <ActionDialog
          open={!!renamingStage}
          onOpenChange={(o) => !o && setRenamingStage(null)}
          title={lang === "ar" ? "إعادة تسمية المرحلة" : "Rename stage"}
          submitLabel={lang === "ar" ? "حفظ" : "Save"}
          fields={[{ key: "name", type: "text", label: lang === "ar" ? "اسم المرحلة" : "Stage name", required: true, defaultValue: renamingStage.name }]}
          onSubmit={async (v) => {
            await renameJobStage(renamingStage.id, v.name);
            setRenamingStage(null);
            invalidate();
          }}
        />
      ) : null}

      {canEdit && addJobFor ? (
        <ActionDialog
          open={!!addJobFor}
          onOpenChange={(o) => !o && setAddJobFor(null)}
          title={lang === "ar" ? "إضافة بطاقة" : "Add job"}
          submitLabel={lang === "ar" ? "إضافة" : "Add"}
          fields={[
            { key: "title", type: "text", label: lang === "ar" ? "العنوان" : "Title", required: true },
            { key: "description", type: "textarea", label: lang === "ar" ? "الوصف" : "Description" },
            { key: "assigneeId", type: "select", label: lang === "ar" ? "المسؤول" : "Assignee", options: [{ value: "", label: "—" }, ...teamOptions] },
            { key: "dueDate", type: "date", label: lang === "ar" ? "تاريخ الاستحقاق" : "Due date" },
          ]}
          onSubmit={async (v) => {
            await createJob({
              projectId,
              stageId: addJobFor,
              title: v.title,
              description: v.description || null,
              assigneeId: v.assigneeId || null,
              dueDate: v.dueDate || null,
              position: (columns[addJobFor] ?? []).length,
            });
            setAddJobFor(null);
            invalidate();
          }}
        />
      ) : null}

      {canEdit && editJob ? (
        <ActionDialog
          open={!!editJob}
          onOpenChange={(o) => !o && setEditJob(null)}
          title={lang === "ar" ? "تعديل البطاقة" : "Edit job"}
          submitLabel={lang === "ar" ? "حفظ" : "Save"}
          fields={[
            { key: "title", type: "text", label: lang === "ar" ? "العنوان" : "Title", required: true, defaultValue: editJob.title },
            { key: "description", type: "textarea", label: lang === "ar" ? "الوصف" : "Description", defaultValue: editJob.description ?? "" },
            { key: "assigneeId", type: "select", label: lang === "ar" ? "المسؤول" : "Assignee", defaultValue: editJob.assignee_id ?? "", options: [{ value: "", label: "—" }, ...teamOptions] },
            { key: "dueDate", type: "date", label: lang === "ar" ? "تاريخ الاستحقاق" : "Due date", defaultValue: editJob.due_date ?? "" },
            { key: "aiNotes", type: "textarea", label: lang === "ar" ? "ملاحظات (AI)" : "Notes (AI)", defaultValue: editJob.ai_notes ?? "" },
          ]}
          onSubmit={async (v) => {
            await updateJob(editJob.id, {
              title: v.title,
              description: v.description || null,
              assigneeId: v.assigneeId || null,
              dueDate: v.dueDate || null,
              aiNotes: v.aiNotes || null,
            });
            setEditJob(null);
            invalidate();
          }}
        />
      ) : null}

      {aiJobFor ? (
        <Dialog open={!!aiJobFor} onOpenChange={(o) => !o && setAiJobFor(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{aiJobFor.title}</DialogTitle>
            </DialogHeader>
            <AiJobNotesPanel
              job={aiJobFor}
              lang={lang}
              onApplied={() => {
                setAiJobFor(null);
                invalidate();
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function KanbanColumn({
  stage,
  jobs,
  canEdit,
  lang,
  onAddJob,
  onEditJob,
  onDeleteJob,
  onAiAssist,
  onRenameStage,
  onDeleteStage,
}: {
  stage: ProjectJobStage;
  jobs: ProjectJob[];
  canEdit: boolean;
  lang: "en" | "ar";
  onAddJob: () => void;
  onEditJob: (job: ProjectJob) => void;
  onDeleteJob: (job: ProjectJob) => void;
  onAiAssist: (job: ProjectJob) => void;
  onRenameStage: () => void;
  onDeleteStage: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div className="flex w-[260px] shrink-0 flex-col rounded-lg border border-border/70 bg-surface/60">
      <header className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="min-w-0 truncate text-[12px] font-semibold text-foreground">{stage.name}</div>
        <div className="flex items-center gap-1">
          <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">{jobs.length}</span>
          {canEdit ? (
            <>
              <button type="button" onClick={onRenameStage} className="text-muted-foreground hover:text-foreground" aria-label="Rename">
                <Pencil className="h-3 w-3" />
              </button>
              <button type="button" onClick={onDeleteStage} className="text-muted-foreground hover:text-destructive" aria-label="Delete">
                <X className="h-3 w-3" />
              </button>
            </>
          ) : null}
        </div>
      </header>
      <div ref={setNodeRef} className={`flex min-h-[80px] flex-1 flex-col gap-2 p-2 transition-colors ${isOver ? "bg-amber/[0.05]" : ""}`}>
        <SortableContext items={jobs.map((j) => j.id)} strategy={verticalListSortingStrategy}>
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} lang={lang} canEdit={canEdit} onEdit={() => onEditJob(job)} onDelete={() => onDeleteJob(job)} onAiAssist={() => onAiAssist(job)} />
          ))}
        </SortableContext>
        {canEdit ? (
          <button
            type="button"
            onClick={onAddJob}
            className="flex items-center justify-center gap-1 rounded-md border border-dashed border-border/70 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
          >
            <Plus className="h-3 w-3" /> {lang === "ar" ? "إضافة" : "Add"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function JobCard({
  job,
  lang,
  canEdit,
  dragging,
  onEdit,
  onDelete,
  onAiAssist,
}: {
  job: ProjectJob;
  lang: "en" | "ar";
  canEdit: boolean;
  dragging?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onAiAssist?: () => void;
}) {
  const sortable = useSortable({ id: job.id, disabled: !canEdit });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={`group rounded-md border border-border/70 bg-background px-2.5 py-2 shadow-sm ${dragging ? "rotate-1 shadow-md" : ""} ${sortable.isDragging ? "opacity-40" : ""}`}
    >
      <div className="flex items-start gap-1.5">
        {canEdit ? (
          <button type="button" {...sortable.attributes} {...sortable.listeners} className="mt-0.5 shrink-0 cursor-grab text-muted-foreground/50 hover:text-muted-foreground" aria-label="Drag">
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-start" disabled={!canEdit}>
          <div className="truncate text-[12px] font-medium text-foreground">{job.title}</div>
          {job.description ? <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{job.description}</div> : null}
          {job.due_date ? (
            <div className="mt-1 text-[10px] text-muted-foreground">
              {lang === "ar" ? "الاستحقاق: " : "Due: "}
              {new Date(job.due_date).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US")}
            </div>
          ) : null}
        </button>
        {canEdit && onAiAssist ? (
          <button type="button" onClick={onAiAssist} className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-amber-light group-hover:opacity-100" aria-label="AI Assist">
            <Sparkles className="h-3 w-3" />
          </button>
        ) : null}
        {canEdit ? (
          <button type="button" onClick={onDelete} className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100" aria-label="Delete">
            <Trash2 className="h-3 w-3" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

// project_job_notes AI agent (2026-08-04) — run + review + "Apply as note".
// Applying is a separate, explicit, human-triggered write (applyJobAiNotes)
// distinct from Accept/Reject (which only records a review decision on the
// ai_agent_outputs audit row) — a user can apply a note without formally
// reviewing it, or review it without applying it to the card.
function AiJobNotesPanel({
  job,
  lang,
  onApplied,
}: {
  job: ProjectJob;
  lang: "en" | "ar";
  onApplied: () => void;
}) {
  const { roles } = useAuth();
  const canReview = canReviewAiOutput(roles);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const outputQ = useQuery({
    queryKey: ["ai-output", "project_jobs", job.id, "project_job_notes"],
    queryFn: () => getLatestAgentOutput("project_jobs", job.id, "project_job_notes"),
  });

  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("ai-orchestrator", {
        body: { agent: "project_job_notes", entityType: "project_jobs", entityId: job.id },
      });
      if (invokeError || !data?.ok) throw new Error(data?.message ?? invokeError?.message ?? "Failed");
      outputQ.refetch();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }

  async function handleDecide(output: AiAgentOutputRow, decision: "accepted" | "rejected") {
    setReviewingId(output.id);
    try {
      await reviewAgentOutput({ outputId: output.id, decision });
      outputQ.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setReviewingId(null);
    }
  }

  async function handleApply(notes: string) {
    setApplying(true);
    try {
      await applyJobAiNotes(job.id, notes);
      toast.success(lang === "ar" ? "تم تطبيق الملاحظة" : "Note applied");
      onApplied();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setApplying(false);
    }
  }

  const output = outputQ.data;
  const display = output?.structured_output as any;

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={handleRun}
        disabled={running}
        className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-2.5 py-1 text-[11px] font-medium text-amber-light transition-colors hover:bg-amber/20 disabled:opacity-50"
      >
        <Sparkles className="h-3 w-3" />
        {running ? (lang === "ar" ? "جارٍ التحليل…" : "Analyzing…") : (lang === "ar" ? "اقتراح ملاحظة" : "Suggest a note")}
      </button>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
      )}

      {display && (
        <div className="space-y-3 text-sm">
          {display.summary && <div className="text-foreground">{display.summary}</div>}
          {display.suggested_notes && (
            <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">
              {display.suggested_notes}
            </div>
          )}
          {display.risk_flags?.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{lang === "ar" ? "تنبيهات" : "Risk Flags"}</div>
              <ul className="space-y-1">
                {display.risk_flags.map((f: string, i: number) => (
                  <li key={i} className="rounded-md border border-amber/30 bg-amber/10 px-2.5 py-1.5 text-xs text-amber-light">{f}</li>
                ))}
              </ul>
            </div>
          )}
          {display.suggested_next_steps?.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{lang === "ar" ? "خطوات مقترحة" : "Next Steps"}</div>
              <ul className="space-y-1">
                {display.suggested_next_steps.map((s: string, i: number) => (
                  <li key={i} className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-muted-foreground">{s}</li>
                ))}
              </ul>
            </div>
          )}
          {display.disclaimer && <div className="text-[11px] italic text-muted-foreground">{display.disclaimer}</div>}

          {display.suggested_notes && (
            <button
              type="button"
              disabled={applying}
              onClick={() => handleApply(display.suggested_notes)}
              className="rounded-md border border-won/40 bg-won/10 px-2.5 py-1 text-[11px] font-medium text-won transition-colors hover:bg-won/[0.16] disabled:opacity-50"
            >
              {lang === "ar" ? "تطبيق كملاحظة" : "Apply as note"}
            </button>
          )}

          {output && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3 text-xs">
              <span className="text-muted-foreground">
                {output.status === "pending_review"
                  ? (lang === "ar" ? "بانتظار المراجعة" : "Pending review")
                  : output.status === "accepted"
                  ? (lang === "ar" ? "تم القبول" : "Accepted")
                  : (lang === "ar" ? "تم الرفض" : "Rejected")}
              </span>
              {output.status === "pending_review" && canReview ? (
                <>
                  <button
                    type="button"
                    disabled={reviewingId === output.id}
                    onClick={() => handleDecide(output, "accepted")}
                    className="rounded-md border border-won/40 bg-won/10 px-2.5 py-1 text-[11px] font-medium text-won transition-colors hover:bg-won/[0.16] disabled:opacity-50"
                  >
                    {lang === "ar" ? "قبول" : "Accept"}
                  </button>
                  <button
                    type="button"
                    disabled={reviewingId === output.id}
                    onClick={() => handleDecide(output, "rejected")}
                    className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-[11px] font-medium text-destructive/90 transition-colors hover:bg-destructive/[0.16] disabled:opacity-50"
                  >
                    {lang === "ar" ? "رفض" : "Reject"}
                  </button>
                </>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
