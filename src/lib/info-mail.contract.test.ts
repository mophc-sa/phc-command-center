// =============================================================================
// The info@ mailbox — where its code lives and what it never does.
// Unit behaviour: supabase/functions/_shared/info-mail.deno-test.ts,
// ai-info-mail.deno-test.ts; database: supabase/tests/info_mailbox.test.sql.
// =============================================================================
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const PASS = read("supabase/functions/outlook-sync/info-pass.ts");
const SYNC = read("supabase/functions/outlook-sync/index.ts");

describe("the info@ pass", () => {
  it("runs only behind the cron key, before anything else", () => {
    const keyCheck = SYNC.indexOf("outlook_sync_key_matches");
    const dispatch = SYNC.indexOf("syncInfoMailbox(");
    expect(keyCheck).toBeGreaterThan(-1);
    expect(dispatch).toBeGreaterThan(keyCheck);
  });

  it("is off until INFO_MAILBOX is set", () => {
    expect(SYNC).toContain('Deno.env.get("INFO_MAILBOX")');
  });

  it("classifies through the orchestrator, never a provider", () => {
    expect(PASS).toContain("/functions/v1/ai-orchestrator");
    expect(PASS).toContain('"x-phc-service-key"');
    expect(PASS).not.toMatch(/generateStructured|OPENAI_API_KEY|ANTHROPIC_API_KEY|api\.openai\.com|api\.anthropic\.com/);
  });

  it("spends a triage attempt only when the message itself failed", () => {
    // reply binding failed, pending outage row, message fault, apply error,
    // a lone held-back row at the end of a run in which the AI answered
    expect(PASS.match(/info_mail_triage_failed/g)?.length).toBe(5);
    const outage = PASS.slice(PASS.indexOf('r.kind === "outage"'), PASS.indexOf("if (pendingOutage) {"));
    expect(outage).not.toContain("info_mail_triage_failed");
    expect(outage).toContain("break");
  });

  it("never classifies a reply whose binding failed", () => {
    const bind = PASS.slice(PASS.indexOf("const bound = await recordReplyIfKnown("), PASS.indexOf("const left = opts.budgetMs"));
    expect(bind).toContain('bound !== "none"');
    expect(bind).toContain('"reply binding failed"');
    expect(bind).toContain("info_mail_triage_failed");
    expect(bind).toContain("continue");
    expect(PASS).toContain("parentErr");
  });

  it("charges a held-back outage row only when the next row gets an answer", () => {
    expect(PASS).toContain("pendingOutage: { id: string; code: string } | null = null");
    const charge = PASS.slice(PASS.indexOf("if (pendingOutage) {"), PASS.indexOf('if (r.kind === "message")'));
    expect(charge).toContain("info_mail_triage_failed");
    expect(charge).toContain("_mail_id: pendingOutage.id");
  });

  it("gives the orchestrator call a deadline", () => {
    const call = PASS.slice(PASS.indexOf("await fetch("), PASS.indexOf("const j = await res.json"));
    expect(call).toContain("signal: AbortSignal.timeout(");
  });

  it("never forwards or sends from the pass", () => {
    expect(PASS).not.toMatch(/forwardMailboxMessage|sendAsMe|sendMail/);
  });

  it("logs counts, never addresses, subjects or bodies", () => {
    for (const line of PASS.split("\n").filter((l) => l.includes("log("))) {
      expect(line).not.toMatch(/fromEmail|subject|body|from_email/);
    }
  });
});

describe("routing info@ mail", () => {
  const H = read("supabase/functions/sales-os-api/handlers/info-mail.ts");
  const A = read("src/lib/info-mail-actions.ts");

  it("checks the router role as the caller before touching Graph", () => {
    const gate = H.slice(H.indexOf("async function routerGate"), H.indexOf("function mailbox"));
    expect(gate).toContain('ctx.asCaller.rpc("is_pipeline_operator"');
    for (const fn of ["info_mail_forward", "info_mail_mark_rfq"]) {
      const body = H.slice(H.indexOf(`async function ${fn}`));
      const role = body.indexOf("routerGate(ctx)");
      const graph = body.indexOf("appAccess(");
      expect(role).toBeGreaterThan(-1);
      expect(graph).toBeGreaterThan(role);
    }
  });

  it("forwards only to an active colleague on the company domain", () => {
    expect(H).toMatch(/status !== "active"/);
    expect(H).toMatch(/@phc-sa\.com/);
  });

  it("claims the row before it forwards", () => {
    const body = H.slice(H.indexOf("async function info_mail_forward"), H.indexOf("async function info_mail_mark_rfq"));
    const claim = body.indexOf("handled_at.is.null,handled_at.lt.");
    expect(claim).toBeGreaterThan(-1);
    expect(body.indexOf("forwardMailboxMessage(")).toBeGreaterThan(claim);
  });

  it("the browser never calls Graph and never sees the cron key", () => {
    expect(A).not.toMatch(/graph\.microsoft\.com|x-phc-sync-key|outlook_sync_key/);
    expect(A).toContain('callBackend("info_mail_forward"');
    expect(A).toContain('supabase.rpc("info_mail_dismiss"');
  });
});

describe("@mentions on a sent email", () => {
  const MAIL = read("supabase/functions/sales-os-api/handlers/mail.ts");
  it("notifies through notify_mentions as the caller, after the email is recorded", () => {
    const insert = MAIL.indexOf('from("activities").insert(');
    const mention = MAIL.indexOf('ctx.asCaller.rpc("notify_mentions"');
    expect(insert).toBeGreaterThan(-1);
    expect(mention).toBeGreaterThan(insert);
  });
  it("mentions are read only after the email is recorded, so they can never reach the recipients", () => {
    const fn = MAIL.slice(MAIL.indexOf("async function send_email"));
    const insert = fn.indexOf('from("activities").insert(');
    expect(insert).toBeGreaterThan(-1);
    expect(fn.indexOf("payload.mentions")).toBeGreaterThan(insert);
  });
});

describe("the router list and its helpers", () => {
  const H = read("supabase/functions/sales-os-api/handlers/info-mail.ts");
  const A = read("src/lib/info-mail-actions.ts");
  const PANEL = read("src/components/phc/InfoMailPanel.tsx");
  const MODAL = read("src/components/phc/EmailComposeModal.tsx");
  const ACTIVITY = read("src/routes/_authenticated/agent-activity.tsx");

  it("lists the newest 200 without spam, and clears spam through one RPC", () => {
    const list = A.slice(A.indexOf("export async function listOpenInfoMail"), A.indexOf("export async function countOpenInfoSpam"));
    expect(list).toContain('.neq("category", "spam")');
    expect(list).toContain(".limit(200)");
    expect(A).toContain('"info_mail_dismiss_spam"');
    expect(A).toContain("triage_attempts");
  });

  it("asks before Dismiss and before Dismiss all, and labels unsorted mail", () => {
    expect(PANEL.match(/window\.confirm\(/g)?.length).toBeGreaterThanOrEqual(3); // forward, dismiss, dismiss all
    expect(PANEL).toContain("dismissOpenInfoSpam");
    expect(PANEL).toContain("Not sorted — route by hand");
    expect(PANEL).toContain("لم يُفرز — وجّهه يدويًا");
    expect(PANEL).toContain("triage_attempts >= 3");
  });

  it("offers only people who can open the deal, and reports n of m", () => {
    expect(A).toContain('"mentionable_colleagues"');
    expect(MODAL).toContain("mentionableColleagues(");
    expect(MODAL).not.toContain("listColleagues");
    expect(MODAL).toMatch(/of \$\{formatNumber\(picked, lang\)\} notified/);
  });

  it("the forward claim may take a claim older than five minutes", () => {
    const body = H.slice(H.indexOf("async function info_mail_forward"), H.indexOf("async function info_mail_mark_rfq"));
    expect(body).toContain("5 * 60_000");
    expect(body).toContain(".or(`handled_at.is.null,handled_at.lt.${staleBefore}`)");
  });

  it("keeps the info@ sorter out of Agent Activity", () => {
    expect(ACTIVITY.match(/\.neq\("agent_key", "info_mail_triage"\)/g)?.length).toBe(2);
  });
});

describe("the info@ pass after the final review (F2)", () => {
  const GRAPH_CLIENT = read("supabase/functions/_shared/graph-client.ts");
  const fn = (name: string) => GRAPH_CLIENT.slice(GRAPH_CLIENT.indexOf(`export async function ${name}`)).split("\n}\n")[0];

  it("stores mail from before the first pass header only, never sent to the AI", () => {
    const first = PASS.indexOf("started_at: startedAt");
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(PASS.indexOf('from("info_mail").insert('));
    expect(PASS).toContain("Date.parse(m.receivedAt) < startedMs");
    expect(PASS).toContain("body_text: isBulk || isOld ? null : capBody(detail.body)");
    expect(PASS).toContain("triage_attempts: NO_MORE_ATTEMPTS");
    expect(PASS).toContain('.lt("triage_attempts", NO_MORE_ATTEMPTS)');
  });

  it("files newsletters as spam without the AI and without their text", () => {
    expect(PASS).toContain("isBulkMail(detail.headers)");
    expect(PASS).toContain('...(isBulk ? { category: "spam" } : {})');
  });

  it("sorts newest first", () => {
    expect(PASS).toContain('.order("received_at", { ascending: false }).limit(TRIAGE_PER_RUN)');
  });

  it("backs off after an outage, skips sorting until then, and probes one row", () => {
    const skip = PASS.indexOf("if (backingOff) {");
    expect(skip).toBeGreaterThan(PASS.indexOf("await saveState(")); // storing still runs
    expect(skip).toBeLessThan(PASS.indexOf("await classify("));
    expect(PASS).toContain("BACKOFF_FIRST_MIN = 30");
    expect(PASS).toContain("BACKOFF_MAX_MIN = 120");
    expect(PASS).toContain("Math.min(backoffMin * 2, BACKOFF_MAX_MIN)");
    expect(PASS).toContain("triage_retry_at: null, triage_backoff_minutes: 0");
    expect(PASS).toContain("if (probing) break;");
    expect(PASS).toMatch(/if \(!probing && !pendingOutage\)/);
  });

  it("gives every info@ Graph call a deadline", () => {
    for (const name of ["deltaPage", "getMailboxMessage", "forwardMailboxMessage"]) {
      expect(fn(name)).toContain("signal: AbortSignal.timeout(");
    }
    expect(fn("getMailboxMessage").match(/AbortSignal\.timeout\(/g)?.length).toBe(2);
    expect(GRAPH_CLIENT).toMatch(/export function appAccess[\s\S]*?GRAPH_TIMEOUT_MS\);/);
  });

  it("only graph-client.ts names Microsoft Graph", () => {
    expect(PASS).not.toContain("graph.microsoft.com");
    expect(read("supabase/functions/_shared/info-mail.ts")).not.toContain("graph.microsoft.com");
  });
});
