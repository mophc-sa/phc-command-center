import { supabase } from "@/integrations/supabase/client";

type Uuid = string;

async function currentUserId(): Promise<Uuid | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/* ---------------- Job Pipeline (Kanban) — flexible, user-defined stages ----
   Stages are plain rows a project team adds/renames/reorders/deletes
   themselves (2026-08-03 client request: no fixed stage list — "خليها
   مرنة"). Jobs are cards placed into a stage; ai_notes is reserved for the
   "processed manually or via AI later" path, unused by any agent today. */

export type ProjectJobStage = {
  id: string;
  project_id: string;
  name: string;
  position: number;
};

export type ProjectJob = {
  id: string;
  project_id: string;
  stage_id: string;
  title: string;
  description: string | null;
  assignee_id: string | null;
  due_date: string | null;
  position: number;
  ai_notes: string | null;
};

export async function listJobStages(projectId: Uuid): Promise<ProjectJobStage[]> {
  const { data, error } = await supabase
    .from("project_job_stages")
    .select("*")
    .eq("project_id", projectId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ProjectJobStage[];
}

export async function listJobs(projectId: Uuid): Promise<ProjectJob[]> {
  const { data, error } = await supabase
    .from("project_jobs")
    .select("*")
    .eq("project_id", projectId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ProjectJob[];
}

export async function createJobStage(projectId: Uuid, name: string, position: number) {
  const { data, error } = await supabase
    .from("project_job_stages")
    .insert({ project_id: projectId, name, position } as never)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function renameJobStage(stageId: Uuid, name: string) {
  const { error } = await supabase.from("project_job_stages").update({ name } as never).eq("id", stageId);
  if (error) throw error;
}

export async function reorderJobStages(stages: { id: Uuid; position: number }[]) {
  await Promise.all(
    stages.map((s) => supabase.from("project_job_stages").update({ position: s.position } as never).eq("id", s.id)),
  );
}

export async function deleteJobStage(stageId: Uuid) {
  const { error } = await supabase.from("project_job_stages").delete().eq("id", stageId);
  if (error) throw error;
}

export async function createJob(input: {
  projectId: Uuid;
  stageId: Uuid;
  title: string;
  description?: string | null;
  assigneeId?: Uuid | null;
  dueDate?: string | null;
  position: number;
}) {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from("project_jobs")
    .insert({
      project_id: input.projectId,
      stage_id: input.stageId,
      title: input.title,
      description: input.description ?? null,
      assignee_id: input.assigneeId ?? null,
      due_date: input.dueDate ?? null,
      position: input.position,
      created_by: uid,
    } as never)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateJob(
  jobId: Uuid,
  patch: Partial<{ title: string; description: string | null; assigneeId: string | null; dueDate: string | null; aiNotes: string | null }>,
) {
  const dbPatch: Record<string, unknown> = {};
  if (patch.title !== undefined) dbPatch.title = patch.title;
  if (patch.description !== undefined) dbPatch.description = patch.description;
  if (patch.assigneeId !== undefined) dbPatch.assignee_id = patch.assigneeId;
  if (patch.dueDate !== undefined) dbPatch.due_date = patch.dueDate;
  if (patch.aiNotes !== undefined) dbPatch.ai_notes = patch.aiNotes;
  const { error } = await supabase.from("project_jobs").update(dbPatch as never).eq("id", jobId);
  if (error) throw error;
}

// project_job_notes AI agent (2026-08-04) — the agent's suggestion is staged
// as a normal pending_review ai_agent_outputs row like every other agent;
// this is the one, explicit, human-triggered write that copies its
// suggested_notes into the job's own ai_notes column once a user clicks
// "Apply as note" — never written automatically by the orchestrator itself.
export async function applyJobAiNotes(jobId: Uuid, notes: string) {
  const { error } = await supabase.from("project_jobs").update({ ai_notes: notes } as never).eq("id", jobId);
  if (error) throw error;
}

export async function moveJob(jobId: Uuid, stageId: Uuid, position: number) {
  const { error } = await supabase.from("project_jobs").update({ stage_id: stageId, position } as never).eq("id", jobId);
  if (error) throw error;
}

export async function reorderJobs(jobs: { id: Uuid; position: number }[]) {
  await Promise.all(
    jobs.map((j) => supabase.from("project_jobs").update({ position: j.position } as never).eq("id", j.id)),
  );
}

export async function deleteJob(jobId: Uuid) {
  const { error } = await supabase.from("project_jobs").delete().eq("id", jobId);
  if (error) throw error;
}
