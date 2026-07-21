# AI Agent Outputs Review UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `system_admin` and commercial managers accept/reject `pending_review` outputs from the 4 non-import AI agents (`opportunity_evaluation`, `smart_followup_draft`, `project_radar`, `risk_finance`) in the existing (currently read-only) "AI Outputs" tab on `agent-activity.tsx`, recording the decision as a pure audit trail.

**Architecture:** RLS policy fix (one line: `is_commercial_manager` → `is_platform_admin`, a strict superset) so `system_admin` can see rows it didn't trigger. A new `sales-os-api` action handler (`review_ai_agent_output`) does the privileged write via the service-role client, following the exact pattern `decide_approval` already establishes — role check in TypeScript, shared `audit()` helper, no new RPC or Edge Function. Frontend calls it through the existing `callBackend()` gateway.

**Tech Stack:** Supabase Postgres (RLS, pgTAP), Deno Edge Function (`sales-os-api`), React + TanStack Query + `sonner` toast, existing `ActionDialog`/`StatusPill` components.

## Global Constraints

- No free-text note field — `review_decision` stores the decision value itself (`'accepted'` / `'rejected'`), not a comment. No new column.
- No side effects beyond recording the decision — accepting `smart_followup_draft` does not open a send dialog; accepting `risk_finance` does not write back to the opportunity.
- Only the 4 target agents get action buttons: `opportunity_evaluation`, `smart_followup_draft`, `project_radar`, `risk_finance`. The other 10 (import-pipeline) agents' cards render exactly as today — read-only, no behavior change.
- No new test framework — this repo has zero React component-test infra (no `@testing-library/react`, no `.test.tsx` anywhere). Verification for UI wiring is manual, documented in Task 5.
- Every privileged mutation from the frontend goes through `sales-os-api` via `callBackend()` — never `supabase.rpc()` or a direct table write from the browser (RLS on `ai_agent_outputs` grants `authenticated` SELECT only, no UPDATE).

---

## Task 1: RLS — let `system_admin` read `ai_agent_outputs` it didn't request

**Files:**
- Create: `supabase/migrations/20260721160000_ai_agent_outputs_review_access.sql`
- Modify: `supabase/tests/rls_role_matrix.test.sql`

**Interfaces:**
- Produces: RLS `SELECT` policy `"AI outputs readable by authorized users"` on `public.ai_agent_outputs` now uses `public.is_platform_admin(auth.uid())` instead of `public.is_commercial_manager(auth.uid())`. Later tasks depend on `system_admin` being able to `SELECT` `pending_review` rows.

- [ ] **Step 1: Write the failing pgTAP test**

Open `supabase/tests/rls_role_matrix.test.sql`. Change the plan count on line 26 from:

```sql
select plan(28);
```

to:

```sql
select plan(30);
```

Then, immediately before the closing `select * from finish();` / `rollback;` lines at the very end of the file, insert a new section:

```sql
-- ════════════════════ H: ai_agent_outputs ═════════════════════════════════════
-- SELECT policy: requester OR is_platform_admin (system_admin + commercial
-- managers). Fixture row is requested_by viewer (…001) so neither reader
-- below is the requester — this isolates the is_platform_admin branch.

insert into public.ai_agent_outputs
  (id, trace_id, agent_key, output_type, entity_type, entity_id,
   requested_by, status, structured_output, summary)
values
  ('f0000000-0000-0000-0000-000000000007', gen_random_uuid(), 'risk_finance',
   'recommendation', 'opportunities', 'f0000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001', 'pending_review', '{}'::jsonb,
   'fixture output for RLS test');

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000005","role":"authenticated"}', true);

select is(
  (select count(*)::integer from public.ai_agent_outputs
     where id = 'f0000000-0000-0000-0000-000000000007'),
  1, 'H1: system_admin can read an ai_agent_outputs row it did not request');

select set_config('request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select is(
  (select count(*)::integer from public.ai_agent_outputs
     where id = 'f0000000-0000-0000-0000-000000000007'),
  0, 'H2: salesperson cannot read another user''s ai_agent_outputs row');
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
supabase start && bun run test:db
```
Expected: `supabase/tests/rls_role_matrix.test.sql` reports `H1` as `not ok` (system_admin gets 0 rows, expected 1) — the current policy only checks `is_commercial_manager`, which `system_admin` alone does not satisfy. `H2` passes already (salesperson was never going to see it).

If port 54322 is already in use by another local Supabase project, stop it first or run `supabase stop --no-backup` in this repo, then retry `supabase start`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260721160000_ai_agent_outputs_review_access.sql`:

```sql
-- =========================================================
-- Let system_admin read ai_agent_outputs it didn't personally request
--
-- is_platform_admin() (system_admin, managing_director, general_manager,
-- ceo, sales_manager) is already a strict superset of is_commercial_manager()
-- (managing_director, general_manager, ceo, sales_manager) — same helper
-- already used for audit_log visibility. Replacing is simpler and correct;
-- no need for a redundant third OR branch.
--
-- Without this, system_admin can't see ai_agent_outputs rows to review them
-- (the upcoming review_ai_agent_output sales-os-api handler role-gates on
-- the same admin set, but the row must be visible to the caller first).
-- =========================================================

DROP POLICY IF EXISTS "AI outputs readable by authorized users" ON public.ai_agent_outputs;

CREATE POLICY "AI outputs readable by authorized users" ON public.ai_agent_outputs
  FOR SELECT TO authenticated
  USING (
    (requested_by = auth.uid() AND (entity_id IS NULL OR public.ai_output_entity_still_owned(entity_type, entity_id, auth.uid())))
    OR public.is_platform_admin(auth.uid())
  );
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
bun run test:db
```
Expected: all 30 pgTAP assertions pass, including `H1` and `H2`.

Then stop the local instance:
```bash
supabase stop --no-backup
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260721160000_ai_agent_outputs_review_access.sql supabase/tests/rls_role_matrix.test.sql
git commit -m "feat(ai-outputs): let system_admin read ai_agent_outputs it didn't request"
```

---

## Task 2: `canReviewAiOutput` role helper

**Files:**
- Modify: `src/lib/roles.ts`
- Modify: `supabase/functions/_shared/roles.ts`
- Modify: `src/lib/roles.capabilities.test.ts`

**Interfaces:**
- Consumes: `AppRole`, `RoleInput`, `inGroup`, `ROLE_GROUPS`, `COMMERCIAL_MANAGERS` (all already defined in both `roles.ts` files).
- Produces: `canReviewAiOutput(r: RoleInput): boolean` — exported from both `src/lib/roles.ts` (frontend) and `supabase/functions/_shared/roles.ts` (Edge Function). Task 3's handler imports this from the Edge Function copy.

- [ ] **Step 1: Write the failing test**

Open `src/lib/roles.capabilities.test.ts`. Add `canReviewAiOutput` to the existing import block from `"./roles"` (find the block that currently imports `canViewSalesAdmin, canManageTeam, ...` and add `canReviewAiOutput` to it), then add a new test:

```ts
test("system_admin and commercial managers can review AI outputs; nobody else can", () => {
  for (const role of ["system_admin", "managing_director", "general_manager", "ceo", "sales_manager"] as AppRole[]) {
    expect(canReviewAiOutput(role), role).toBe(true);
  }
  for (const role of ["bd_manager", "sales_ops", "salesperson", "viewer"] as AppRole[]) {
    expect(canReviewAiOutput(role), role).toBe(false);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/roles.capabilities.test.ts`
Expected: FAIL — `canReviewAiOutput` is not exported from `./roles` (TypeScript/import error).

- [ ] **Step 3: Implement in both role files**

In `src/lib/roles.ts`, immediately after the existing `canManageTeam` export (the two lines):
```ts
export const canManageTeam = (r: RoleInput) =>
  inGroup(r, [...ROLE_GROUPS.systemAdmin, ...COMMERCIAL_MANAGERS]);
```
add:
```ts

// AI output review authority — system_admin (platform oversight) plus
// commercial managers (the people the outputs are actually for). Same role
// set as canViewSalesAdmin/canManageTeam, kept as its own named helper for
// call-site clarity, matching this file's existing pattern.
export const canReviewAiOutput = (r: RoleInput) =>
  inGroup(r, [...ROLE_GROUPS.systemAdmin, ...COMMERCIAL_MANAGERS]);
```

Make the identical addition in `supabase/functions/_shared/roles.ts` immediately after its own `canManageTeam` export (same two-line definition found earlier at that file's lines 79-80).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/roles.capabilities.test.ts src/lib/roles.contract.test.ts`
Expected: PASS — the new test passes, and `roles.contract.test.ts` still passes unaffected (it only checks `ALL_ROLES` array equality, not individual capability helpers).

- [ ] **Step 5: Commit**

```bash
git add src/lib/roles.ts src/lib/roles.capabilities.test.ts supabase/functions/_shared/roles.ts
git commit -m "feat(ai-outputs): add canReviewAiOutput role helper"
```

---

## Task 3: `sales-os-api` handler — `review_ai_agent_output`

**Files:**
- Create: `supabase/functions/sales-os-api/handlers/ai-outputs.ts`
- Modify: `supabase/functions/sales-os-api/index.ts`

**Interfaces:**
- Consumes: `HandlerModule`, `SalesOsContext` (from `../contracts.ts`); `json`, `err`, `canReviewAiOutput` (from `../shared.ts`, after Step 1 adds `canReviewAiOutput` to that file's re-export list).
- Produces: action name `"review_ai_agent_output"`, payload shape `{ outputId: string, decision: "accepted" | "rejected" }`, response shape `{ ok: true, output: <ai_agent_outputs row> }` on success. Task 4's frontend action calls this by name through `callBackend()`.

- [ ] **Step 1: Add `canReviewAiOutput` to `shared.ts`'s re-exports**

Open `supabase/functions/sales-os-api/shared.ts`. In the `import { ... } from "../_shared/roles.ts";` block (the one currently importing `canApproveCommercialAction, canAssignOwner, canChangeCommercialStage, canCreateSalesRecords, canExecuteDelete, canManageSalesPipeline, canRunSensitiveSalesAction`), add `canReviewAiOutput` to the list. Then find the `export { json, err, ... }` block further down in the same file and add `canReviewAiOutput` to it too, so handler modules can import it from `../shared.ts` like they do the other role helpers.

- [ ] **Step 2: Write the handler**

Create `supabase/functions/sales-os-api/handlers/ai-outputs.ts`:

```ts
import type { HandlerModule, SalesOsContext } from "../contracts.ts";
import { json, err, canReviewAiOutput } from "../shared.ts";

const VALID_DECISIONS = new Set(["accepted", "rejected"]);

// Records a human decision on an ai_agent_outputs row. Pure audit trail —
// no side effect on any other table. Accept/reject only, and only once:
// the .eq("status", "pending_review") guard means a second call on an
// already-decided row updates 0 rows, which this treats as a 404 rather
// than silently overwriting a prior reviewer's decision.
async function review_ai_agent_output(
  payload: Record<string, unknown>,
  ctx: SalesOsContext,
): Promise<Response> {
  const { caller, audit: auditLog } = ctx;
  if (!canReviewAiOutput(caller.roles)) {
    return err("AI output review authority required", 403);
  }
  const outputId = String(payload.outputId ?? "");
  const decision = String(payload.decision ?? "");
  if (!outputId) return err("outputId is required");
  if (!VALID_DECISIONS.has(decision)) return err("decision must be 'accepted' or 'rejected'");

  const svc = ctx.svc;
  const nowIso = new Date().toISOString();
  const { data, error } = await svc
    .from("ai_agent_outputs")
    .update({
      status: decision,
      reviewed_by: caller.userId,
      reviewed_at: nowIso,
      review_decision: decision,
    })
    .eq("id", outputId)
    .eq("status", "pending_review")
    .select()
    .single();

  if (error || !data) {
    return err("Output not found, or already reviewed by someone else", 404);
  }

  await auditLog(
    svc,
    caller.userId,
    "ai_output.reviewed",
    "ai_agent_output",
    outputId,
    { agent_key: data.agent_key, decision },
    caller.roles,
  );

  return json({ ok: true, output: data });
}

export const aiOutputsModule: HandlerModule = {
  name: "ai-outputs",
  handlers: {
    review_ai_agent_output,
  },
};
```

- [ ] **Step 3: Register the module**

Open `supabase/functions/sales-os-api/index.ts`. Add an import alongside the other handler module imports:

```ts
import { aiOutputsModule } from "./handlers/ai-outputs.ts";
```

Add `aiOutputsModule` to the `createHandlerRegistry([...])` array (alongside `approvalsModule, pipelineModule, intelligenceModule, automationModule, lifecycleModule`):

```ts
const registry = createHandlerRegistry([
  approvalsModule,
  pipelineModule,
  intelligenceModule,
  automationModule,
  lifecycleModule,
  aiOutputsModule,
]);
```

- [ ] **Step 4: Verify**

If Deno is installed locally, run:
```bash
deno check --import-map supabase/functions/import_map.json supabase/functions/sales-os-api/index.ts
```
Expected: no type errors.

If Deno is not installed locally, skip this and rely on CI's `typecheck-build` job (`.github/workflows/ci.yml`, step "Supabase Edge Function check") to catch it after pushing — this matches how the same check was verified earlier in this project when Deno wasn't available locally.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/sales-os-api/handlers/ai-outputs.ts supabase/functions/sales-os-api/index.ts supabase/functions/sales-os-api/shared.ts
git commit -m "feat(ai-outputs): add review_ai_agent_output sales-os-api handler"
```

---

## Task 4: Frontend action — `reviewAgentOutput`

**Files:**
- Create: `src/lib/ai-review-actions.ts`

**Interfaces:**
- Consumes: `callBackend<T>(action: string, payload: Record<string, unknown>): Promise<T>` from `@/lib/backend`.
- Produces: `reviewAgentOutput(input: { outputId: Uuid; decision: "accepted" | "rejected" }): Promise<AiAgentOutputRow>` and the exported constant `REVIEWABLE_AGENT_KEYS: readonly string[]`. Task 5's UI imports both.

- [ ] **Step 1: Write the file**

Create `src/lib/ai-review-actions.ts`:

```ts
import { callBackend } from "@/lib/backend";

type Uuid = string;

// The 4 agents whose outputs get a review action in the "AI Outputs" tab.
// The other 10 (import-pipeline) agents already have their own dedicated
// review/commit flow in data-import.$batchId.tsx against separate tables —
// deliberately not wired to this action.
export const REVIEWABLE_AGENT_KEYS = [
  "opportunity_evaluation",
  "smart_followup_draft",
  "project_radar",
  "risk_finance",
] as const;

export type AiAgentOutputRow = {
  id: Uuid;
  agent_key: string;
  status: string;
  entity_type: string | null;
  entity_id: Uuid | null;
  summary: string | null;
  created_at: string;
  output_type: string;
  client_request_id: string | null;
  reviewed_by: Uuid | null;
  reviewed_at: string | null;
  review_decision: string | null;
};

export async function reviewAgentOutput(input: {
  outputId: Uuid;
  decision: "accepted" | "rejected";
}): Promise<AiAgentOutputRow> {
  const res = await callBackend<{ output: AiAgentOutputRow }>("review_ai_agent_output", {
    outputId: input.outputId,
    decision: input.decision,
  });
  return res.output;
}
```

- [ ] **Step 2: Verify**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai-review-actions.ts
git commit -m "feat(ai-outputs): add reviewAgentOutput frontend action"
```

---

## Task 5: UI — Accept/Reject buttons on the "AI Outputs" tab

**Files:**
- Modify: `src/lib/i18n.tsx`
- Modify: `src/routes/_authenticated/agent-activity.tsx`

**Interfaces:**
- Consumes: `reviewAgentOutput`, `REVIEWABLE_AGENT_KEYS`, `AiAgentOutputRow` (from Task 4's `@/lib/ai-review-actions`); `canReviewAiOutput` (from Task 2's `@/lib/roles`); `useAuth` (from `@/hooks/useSupabaseAuth`, existing); `ActionDialog` (existing, `@/components/phc/ActionDialog`).

- [ ] **Step 1: Add translation keys**

Open `src/lib/i18n.tsx`. Immediately after the existing `action_approve: { en: "Approve", ar: "اعتماد" },` entry (line 524), add:

```ts
  action_accept: { en: "Accept", ar: "قبول" },
  action_reject: { en: "Reject", ar: "رفض" },
```

Immediately after the existing `dialog_field_required: { ... }` entry (line 1127), add:

```ts
  dialog_reject_ai_output_title: { en: "Reject AI output", ar: "رفض مخرج الذكاء الاصطناعي" },
  dialog_reject_ai_output_desc: {
    en: "This marks the output as rejected. It has no effect on any other record.",
    ar: "هذا يسجّل رفض المخرج فقط، ولا يؤثر على أي بيانات أخرى.",
  },
```

Immediately after the existing `toast_approve_ok: { ... }` entry (line 719), add:

```ts
  toast_ai_output_accepted: { en: "Output accepted", ar: "تم قبول المخرج" },
  toast_ai_output_rejected: { en: "Output rejected", ar: "تم رفض المخرج" },
```

- [ ] **Step 2: Wire up the UI**

Open `src/routes/_authenticated/agent-activity.tsx`.

Add these imports alongside the existing ones (after the `StatusPill` import on line 12):

```ts
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canReviewAiOutput } from "@/lib/roles";
import { reviewAgentOutput, REVIEWABLE_AGENT_KEYS } from "@/lib/ai-review-actions";
```

Inside `function AgentActivityPage() {`, immediately after the existing `const { t, lang } = useI18n();` line (line 39), add:

```ts
  const { roles } = useAuth();
  const canReview = canReviewAiOutput(roles);
  const qc = useQueryClient();
  const [rejectFor, setRejectFor] = useState<{ id: string } | null>(null);
```

Add this handler function inside `AgentActivityPage`, after the `hasTrendData` line (line 108) and before the `return (` (line 110):

```ts
  async function acceptOutput(id: string) {
    try {
      await reviewAgentOutput({ outputId: id, decision: "accepted" });
      toast.success(t("toast_ai_output_accepted"));
      qc.invalidateQueries({ queryKey: ["ai-agent-outputs"] });
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    }
  }
```

Now find the "AI Outputs" tab card rendering (the `.map((o: any) => (...))` block inside `<TabsContent value="outputs">`, lines 226-250). Replace the whole `<li key={o.id} ...>...</li>` block with:

```tsx
                <li key={o.id} className="rounded-xl border border-border/70 bg-surface/60 px-5 py-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill tone={o.status === "accepted" ? "positive" : o.status === "rejected" ? "danger" : "attention"}>
                          {o.status?.replaceAll("_", " ") ?? "—"}
                        </StatusPill>
                        <span className="truncate text-sm font-medium text-foreground">{o.agent_key}</span>
                        {o.output_type ? <StatusPill tone="muted">{o.output_type}</StatusPill> : null}
                      </div>
                      {o.summary ? <div className="mt-1 text-xs text-muted-foreground">{o.summary}</div> : null}
                      {o.entity_type || o.entity_id ? (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {o.entity_type} {o.entity_id ? `· ${String(o.entity_id).slice(0, 8)}…` : ""}
                          {o.client_request_id ? ` · req: ${String(o.client_request_id).slice(0, 8)}…` : ""}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {canReview && o.status === "pending_review" && (REVIEWABLE_AGENT_KEYS as readonly string[]).includes(o.agent_key) ? (
                        <>
                          <button
                            className="rounded-md border border-won/40 bg-won/10 px-3 py-1.5 text-xs font-medium text-won hover:bg-won/[0.16] transition-colors duration-150"
                            onClick={() => acceptOutput(o.id)}
                          >
                            {t("action_accept")}
                          </button>
                          <button
                            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive/90 hover:bg-destructive/[0.16] transition-colors duration-150"
                            onClick={() => setRejectFor({ id: o.id })}
                          >
                            {t("action_reject")}
                          </button>
                        </>
                      ) : null}
                      <span className="text-xs text-muted-foreground num" data-tabular="true">
                        {fmtTime(o.created_at, lang)}
                      </span>
                    </div>
                  </div>
                </li>
```

Finally, add the reject confirmation dialog right after the closing `</Tabs>` tag (line 254) and before the closing `</div>` of the page (line 255):

```tsx
      <ActionDialog
        open={!!rejectFor}
        onOpenChange={(v) => !v && setRejectFor(null)}
        title={t("dialog_reject_ai_output_title")}
        description={t("dialog_reject_ai_output_desc")}
        submitLabel={t("action_reject")}
        destructive
        fields={[]}
        onSubmit={async () => {
          try {
            await reviewAgentOutput({ outputId: rejectFor!.id, decision: "rejected" });
            toast.success(t("toast_ai_output_rejected"));
            qc.invalidateQueries({ queryKey: ["ai-agent-outputs"] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
```

- [ ] **Step 3: Verify — automated**

Run:
```bash
bun run typecheck && bun run lint && bun run build
```
Expected: all three pass with no new errors.

- [ ] **Step 4: Verify — manual**

This repo has no component-test framework (see Global Constraints), so verify by hand:

1. `bun run dev`, log in as a `system_admin` account (or temporarily grant yourself the role in a local/dev database).
2. Navigate to Agent Activity → "AI Outputs" tab.
3. If there's at least one row with `status = 'pending_review'` and `agent_key` in `opportunity_evaluation`/`smart_followup_draft`/`project_radar`/`risk_finance`: confirm `[Accept]`/`[Reject]` buttons appear on that card, and do NOT appear on any card whose `agent_key` is one of the 10 import agents, nor on any card already `accepted`/`rejected`.
4. Click `[Accept]` on a target card: confirm a success toast appears, the card's status pill updates to "accepted", and the action buttons disappear from that card (since it's no longer `pending_review`).
5. Click `[Reject]` on another target card: confirm the confirmation dialog opens, submitting it shows a success toast and updates the card to "rejected".
6. Log in as a `salesperson` (or any non-reviewer role) and confirm no Accept/Reject buttons appear anywhere on the tab, even on `pending_review` target-agent cards.
7. If no `pending_review` row exists for one of the 4 target agents in your test data, trigger one first (e.g. open an opportunity and run the risk assessment action, which calls `risk_finance` and leaves a `pending_review` row behind).

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n.tsx src/routes/_authenticated/agent-activity.tsx
git commit -m "feat(ai-outputs): accept/reject buttons on the AI Outputs tab"
```

---

## Self-Review Notes

- **Spec coverage:** §3.1 RLS → Task 1. §3.2 write path → Tasks 2 (role helper) + 3 (handler). §4 UI → Task 5. §5 Error handling (permission error, already-reviewed race, generic network error) → all three toast branches are present in Task 5's `acceptOutput` and the reject `ActionDialog.onSubmit` (the handler's 403/404/generic errors all surface through the same `catch` → `toast.error` path, since `callBackend` throws with the server's message per `src/lib/backend.ts`). §6 Testing → Task 1 (pgTAP) + Task 2 (unit test) + Task 5 Step 4 (manual, since no component-test infra exists).
- **Type consistency checked:** `reviewAgentOutput({ outputId, decision })` (Task 4) matches the call in Task 5 Step 2. `REVIEWABLE_AGENT_KEYS` (Task 4) matches the `.includes(o.agent_key)` check in Task 5. `canReviewAiOutput` (Task 2) is imported with the same name in both Task 3's handler (via `shared.ts`) and Task 5's UI (via `@/lib/roles`). The `review_ai_agent_output` action name (Task 3) matches the string passed to `callBackend` in Task 4.
