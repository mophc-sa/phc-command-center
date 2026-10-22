// Samples and drawings (manager feedback group 5).
// Tables: deal_submittals + deal_submittal_steps (20261026100000). RLS lets the
// deal's people read and record; the database refuses a step out of order and
// an approval from anyone but a commercial manager, so these calls simply pass
// the error on.
import { supabase } from "@/integrations/supabase/client";
import type { ClientResponse, SubmittalKind, SubmittalStep } from "@/lib/submittals";

type Person = { full_name: string | null; email: string | null; sales_code: string | null };

export type SubmittalStepRow = {
  id: string;
  submittal_id: string;
  revision: number;
  step: SubmittalStep;
  response: ClientResponse | null;
  actor_id: string | null;
  actor_name: string | null;
  occurred_at: string;
  notes: string | null;
  document_id: string | null;
  recorded_by: string | null;
  recorded_at: string;
  actor: Person | null;
  recorder: Person | null;
  document: { id: string; original_filename: string; title: string | null } | null;
};

export type Submittal = {
  id: string;
  opportunity_id: string;
  kind: SubmittalKind;
  title: string;
  notes: string | null;
  revision: number;
  current_step: SubmittalStep | null;
  client_response: ClientResponse | null;
  last_step_at: string | null;
  created_by: string | null;
  created_at: string;
};

const SUBMITTAL_COLUMNS =
  "id, opportunity_id, kind, title, notes, revision, current_step, client_response, last_step_at, created_by, created_at";

// created_by / actor_id point at auth.users, which PostgREST cannot embed; the
// names come from profiles in one extra read.
async function people(ids: (string | null)[]): Promise<Map<string, Person>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const map = new Map<string, Person>();
  if (unique.length === 0) return map;
  const { data } = await supabase.from("profiles").select("id, full_name, email, sales_code").in("id", unique);
  for (const p of data ?? []) map.set(p.id, { full_name: p.full_name, email: p.email, sales_code: p.sales_code });
  return map;
}

export async function listDealSubmittals(
  opportunityId: string,
): Promise<{ items: Submittal[]; steps: SubmittalStepRow[] }> {
  const { data, error } = await supabase
    .from("deal_submittals")
    .select(SUBMITTAL_COLUMNS)
    .eq("opportunity_id", opportunityId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const items = (data ?? []) as Submittal[];
  if (items.length === 0) return { items, steps: [] };

  const { data: stepRows, error: stepErr } = await supabase
    .from("deal_submittal_steps")
    .select(
      "id, submittal_id, revision, step, response, actor_id, actor_name, occurred_at, notes, document_id, recorded_by, recorded_at, documents(id, original_filename, title)",
    )
    .in("submittal_id", items.map((i) => i.id))
    .order("recorded_at", { ascending: true });
  if (stepErr) throw stepErr;
  const rows = stepRows ?? [];
  const names = await people(rows.flatMap((r) => [r.actor_id, r.recorded_by]));
  const steps = rows.map((r) => {
    const { documents, ...rest } = r as typeof r & { documents: SubmittalStepRow["document"] };
    return {
      ...rest,
      step: r.step as SubmittalStep,
      response: r.response as ClientResponse | null,
      actor: r.actor_id ? names.get(r.actor_id) ?? null : null,
      recorder: r.recorded_by ? names.get(r.recorded_by) ?? null : null,
      document: documents ?? null,
    };
  });
  return { items, steps };
}

export type SubmittalListRow = Submittal & {
  opportunities: { id: string; project_name: string | null; owner_id: string | null } | null;
};

/** Every sample and drawing the reader can see, most recently moved first. */
export async function listAllSubmittals(): Promise<SubmittalListRow[]> {
  const { data, error } = await supabase
    .from("deal_submittals")
    .select(`${SUBMITTAL_COLUMNS}, opportunities(id, project_name, owner_id)`)
    .order("last_step_at", { ascending: false, nullsFirst: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as SubmittalListRow[];
}

export type StepInput = {
  step: SubmittalStep;
  response?: ClientResponse | null;
  actorId?: string | null;
  actorName?: string | null;
  occurredAt?: string | null; // YYYY-MM-DD; today when empty
  notes?: string | null;
  documentId?: string | null;
};

/** A date picked in the dialog is a day; noon keeps it on that day in any zone. */
function toTimestamp(day: string | null | undefined): string | undefined {
  if (!day) return undefined;
  const today = new Date().toISOString().slice(0, 10);
  return day === today ? new Date().toISOString() : `${day}T12:00:00Z`;
}

export async function recordSubmittalStep(submittalId: string, input: StepInput) {
  const { error } = await supabase.from("deal_submittal_steps").insert({
    submittal_id: submittalId,
    step: input.step,
    response: input.step === "client_response" ? input.response ?? null : null,
    actor_id: input.actorId || null,
    actor_name: input.actorName?.trim() || null,
    occurred_at: toTimestamp(input.occurredAt),
    notes: input.notes?.trim() || null,
    document_id: input.documentId || null,
  });
  if (error) throw error;
}

/** Creates the item and records its first step. */
export async function createSubmittal(
  input: { opportunityId: string; kind: SubmittalKind; title: string; notes?: string | null },
  first: StepInput,
): Promise<string> {
  const { data, error } = await supabase
    .from("deal_submittals")
    .insert({
      opportunity_id: input.opportunityId,
      kind: input.kind,
      title: input.title.trim(),
      notes: input.notes?.trim() || null,
    })
    .select("id")
    .single();
  if (error) throw error;
  await recordSubmittalStep(data.id, first);
  return data.id;
}

/** The deal's live files, for attaching the one that was sent with a step. */
export async function listDealFiles(opportunityId: string): Promise<{ id: string; label: string }[]> {
  const { data, error } = await supabase
    .from("document_links")
    .select("documents(id, original_filename, title, doc_type, uploaded_at, deleted_at, superseded_by)")
    .eq("entity_type", "opportunity")
    .eq("entity_id", opportunityId)
    .is("unlinked_at", null);
  if (error) throw error;
  type Doc = {
    id: string;
    original_filename: string;
    title: string | null;
    uploaded_at: string;
    deleted_at: string | null;
    superseded_by: string | null;
  };
  return (data ?? [])
    .map((r) => (r as unknown as { documents: Doc | null }).documents)
    .filter((d): d is Doc => !!d && !d.deleted_at && !d.superseded_by)
    .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))
    .map((d) => ({ id: d.id, label: d.title || d.original_filename }));
}
