// =============================================================================
// info_mail_triage: no person may run it, only a service call; its context is
// the one unclassified info@ message, delimited and capped.
// =============================================================================

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_REGISTRY } from "./ai-agent-registry.ts";
import { InfoMailTriageOutputSchema } from "./ai-schemas.ts";
import { MAX_CONTEXT_CHARS, scanForGuardrailViolations } from "./ai-guardrails.ts";

const MAIL_ID = "2d0000a0-0000-0000-0000-000000000001";

// The loader asks for one row: from("info_mail").select().eq("id").maybeSingle().throwOnError().
function fakeDb(row: Record<string, unknown> | null) {
  const asked: string[] = [];
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) c[m] = () => c;
  c.maybeSingle = () => ({ throwOnError: () => Promise.resolve({ data: row }) });
  return { db: { from: (t: string) => (asked.push(t), c) } as never, asked };
}

const MAIL = {
  id: MAIL_ID, category: "unclassified", from_email: "sara@acme.example", from_name: "Sara",
  subject: "RFQ - Diriyah villas", received_at: "2026-10-20T08:00:00Z",
  body_text: "x".repeat(9000), attachment_names: ["BOQ.xlsx"],
};

Deno.test("only a service call may run the triage", () => {
  const a = AGENT_REGISTRY.info_mail_triage;
  assertEquals(a.allowedEntityTypes, ["info_mail"]);
  assertEquals(a.serviceCallable, true);
  assertEquals(a.hasRole(["sales_manager"]), false);
  assertEquals(a.hasRole(["system_admin"]), false);
  assertEquals(a.hasRole([]), false);
  for (const [key, def] of Object.entries(AGENT_REGISTRY)) {
    if (key !== "info_mail_triage") assert(!def.serviceCallable, `${key} must not be service-callable`);
  }
});

Deno.test("the context is the one message, its text delimited and capped", async () => {
  const { db, asked } = fakeDb(MAIL);
  const r = await AGENT_REGISTRY.info_mail_triage.loadContext(db, "info_mail", MAIL_ID, {});
  assertEquals(asked, ["info_mail"]);
  assert(r.ok);
  if (!r.ok) return;
  const ctx = JSON.parse(r.contextText);
  assertEquals(ctx.from, "Sara <sara@acme.example>");
  assertEquals(ctx.subject, "RFQ - Diriyah villas");
  assertEquals(ctx.attachments, ["BOQ.xlsx"]);
  assert(ctx.text.length <= 6000);
  assertEquals(r.recordCount, 1);
  assert(r.recordCount <= AGENT_REGISTRY.info_mail_triage.maxContextRecords);
  const prompt = AGENT_REGISTRY.info_mail_triage.buildPrompt(r.contextText);
  assert(prompt.userPrompt.startsWith("<<<CONTEXT:info_mail>>>"));
  assert(prompt.userPrompt.endsWith("<<<END_CONTEXT:info_mail>>>"));
});

Deno.test("a message that escapes badly still fits the orchestrator's context cap", async () => {
  const { db } = fakeDb({
    ...MAIL,
    subject: "S".repeat(5000),
    body_text: "\"\n".repeat(6000),
    attachment_names: Array.from({ length: 50 }, (_, i) => `${i}-${"a".repeat(500)}.pdf`),
  });
  const r = await AGENT_REGISTRY.info_mail_triage.loadContext(db, "info_mail", MAIL_ID, {});
  assert(r.ok);
  if (!r.ok) return;
  assert(r.contextText.length <= MAX_CONTEXT_CHARS, `context ${r.contextText.length}`);
  assertEquals(JSON.parse(r.contextText).attachments.length, 20);
});

Deno.test("a message that was already classified is not sent to the model", async () => {
  const r = await AGENT_REGISTRY.info_mail_triage.loadContext(fakeDb({ ...MAIL, category: "hr" }).db, "info_mail", MAIL_ID, {});
  assertEquals(r.ok, false);
  const missing = await AGENT_REGISTRY.info_mail_triage.loadContext(fakeDb(null).db, "info_mail", MAIL_ID, {});
  assertEquals(missing.ok, false);
});

Deno.test("the output schema takes a request with nulls and refuses extra fields", () => {
  const good = {
    category: "rfq", confidence: 0.9, summary_en: "Signage for 40 villas", summary_ar: "لوحات إرشادية لأربعين فيلا",
    request: { company: "Acme", contact_name: null, phone: null, email: null, project_name: "Diriyah villas",
      location: "Diriyah", client_rfq_ref: "RFQ-ACM-77", estimated_value: 1200000, currency: "SAR", scope: "Signage", deadline: "2026-11-01" },
  };
  assert(InfoMailTriageOutputSchema.safeParse(good).success);
  assert(InfoMailTriageOutputSchema.safeParse({ ...good, request: null, category: "spam" }).success);
  assertEquals(InfoMailTriageOutputSchema.safeParse({ ...good, extra: 1 }).success, false);
  assertEquals(InfoMailTriageOutputSchema.safeParse({ ...good, category: "send_email" }).success, false);
  assertEquals(InfoMailTriageOutputSchema.safeParse({ ...good, request: { ...good.request, deadline: "1 Nov" } }).success, false);
  assertEquals(InfoMailTriageOutputSchema.safeParse({ ...good, request: { ...good.request, extra: 1 } }).success, false);
  // A normal triage output passes the guardrail scan, whatever its category.
  assertEquals(scanForGuardrailViolations(good), []);
  for (const category of InfoMailTriageOutputSchema.shape.category.options) {
    assertEquals(scanForGuardrailViolations({ ...good, category }), [], category);
  }
});

// index.ts serves on import, so its service-caller rules are pinned from source.
Deno.test("the orchestrator's service caller is limited to serviceCallable agents and has no admin override", async () => {
  const src = await Deno.readTextFile(new URL("../ai-orchestrator/index.ts", import.meta.url));
  assert(src.includes('req.headers.get("x-phc-service-key")'));
  assert(src.includes('svc.rpc("outlook_sync_key_matches", { _key: key })'));
  assert(src.includes("caller.service ? agentDef.serviceCallable === true : agentDef.hasRole(caller.roles)"));
  // No admin provider override: the service caller has no roles at all.
  assert(src.includes("return { userId: profile.id as string, roles: [], service: true };"));
  assert(src.includes("const adminOverrideAllowed = isSystemAdmin(caller.roles);"));
  assert(/caller\.service\s*\?\s*"mailbox"/.test(src));
  // One generic 401 for every authentication failure, service or user.
  assertEquals(src.match(/errorEnvelope\("AI_UNAUTHENTICATED"/g)?.length, 1);
});
