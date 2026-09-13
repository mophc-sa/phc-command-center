// =============================================================================
// Sending email from inside the system — the rules that must not drift.
//
// The unit behaviour (senders, reply threading, validation) is tested in Deno
// next to the code: supabase/functions/_shared/mail.deno-test.ts. This file holds
// the rules that are about WHERE code lives, which a unit test cannot see.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.|deno-test/.test(name)) out.push(rel);
  }
  return out;
}

const SRC = walk("src");
const FUNCTIONS = walk("supabase/functions");

describe("only an explicit click sends", () => {
  it("talks to the provider from exactly one file", () => {
    // The activities table was designed with "drafts are NEVER auto-sent". The
    // way that survives sending from inside the system is that there is one
    // door to the provider, behind a handler a person invokes.
    // The full endpoint, scheme and all, with the dots escaped. A bare
    // `.includes("api.postmarkapp.com")` would also match a comment or a longer
    // look-alike host, and it is the shape CodeQL rightly flags as URL
    // substring checking.
    const endpoint = /https:\/\/api\.postmarkapp\.com\//;
    const hits = FUNCTIONS.filter((f) => endpoint.test(read(f)));
    expect(hits).toEqual(["supabase/functions/sales-os-api/handlers/mail.ts"]);
  });

  it("reaches send_email only from the compose modal", () => {
    // An actual backend invocation, not any mention of the word: sales-ai.ts
    // names "send_email" too, in the list of things AI may never do.
    const callers = SRC.filter((f) => /callBackend(?:<[^>]*>)?\(\s*["']send_email["']/.test(read(f)));
    expect(callers).toEqual(["src/lib/mail-actions.ts"]);
    const users = SRC.filter((f) => /\bsendEmail\(/.test(read(f)) && f !== "src/lib/mail-actions.ts");
    expect(users).toEqual(["src/components/phc/EmailComposeModal.tsx"]);
  });

  it("keeps sending email on the list of things AI may never do", () => {
    // Found while building this: the AI governance list already forbade
    // "send_email" before sending existed. Now that the action is real, removing
    // it from that list would let an AI output recommend the exact thing the
    // send_email handler performs.
    const ai = read("src/lib/sales-ai.ts");
    const list = ai.slice(ai.indexOf("export const AI_FORBIDDEN_ACTIONS"), ai.indexOf("] as const;", ai.indexOf("export const AI_FORBIDDEN_ACTIONS")));
    expect(list).toContain('"send_email"');
  });

  it("is not reachable from automation or AI code", () => {
    // A scheduled job or an agent that could send client email would reverse the
    // one guarantee this feature was built on.
    const automated = FUNCTIONS.filter(
      (f) => /automation|ai-orchestrator|daily-assistant|import-pipeline/.test(f) && /send_email|postmark/i.test(read(f)),
    );
    expect(automated).toEqual([]);
  });
});

describe("the browser never holds the provider", () => {
  it("never references the provider token", () => {
    expect(SRC.filter((f) => read(f).includes("POSTMARK"))).toEqual([]);
  });

  it("never chooses the sender", () => {
    // The backend sends from the caller's own profile address. A `from` field in
    // the browser payload would be the first step to emailing as someone else.
    const actions = read("src/lib/mail-actions.ts");
    expect(actions).not.toMatch(/\bfrom\s*:/i);
    const handler = read("supabase/functions/sales-os-api/handlers/mail.ts");
    expect(handler).not.toMatch(/payload\.from\b/i);
  });
});

describe("the compose modal falls back to Phase 1", () => {
  const modal = read("src/components/phc/EmailComposeModal.tsx");

  it("shows Send only when the backend reports sending is configured", () => {
    expect(modal).toContain("mailStatus.data?.sending === true");
    expect(modal).toMatch(/\{canSendHere \? \(\s*<Button onClick=\{handleSend\}/);
  });

  it("keeps Open in Outlook available", () => {
    expect(modal).toContain("onClick={handleOpenInOutlook}");
  });
});

describe("authorization runs before the send, because the send cannot be undone", () => {
  const handler = read("supabase/functions/sales-os-api/handlers/mail.ts");
  const at = (needle: string) => {
    const i = handler.indexOf(needle);
    expect([needle, i >= 0]).toEqual([needle, true]);
    return i;
  };

  it("checks role, visibility and validity before calling the provider", () => {
    const send = at("await fetch(POSTMARK_URL");
    expect(at('rpc("is_sales_contributor"')).toBeLessThan(send);
    expect(at('.from("opportunities").select("id")')).toBeLessThan(send);
    expect(at("composeOutbound(")).toBeLessThan(send);
  });

  it("is registered on the backend", () => {
    const index = read("supabase/functions/sales-os-api/index.ts");
    expect(index).toContain('import { mailModule } from "./handlers/mail.ts";');
    expect(index).toMatch(/createHandlerRegistry\(\[[^\]]*\n\s+mailModule,\n/);
  });
});

describe("storage", () => {
  const sql = read("supabase/migrations/20260930100000_email_send_from_system.sql");

  it("keeps thread tokens away from every client role", () => {
    expect(sql).toContain("ALTER TABLE public.email_threads ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("REVOKE ALL ON public.email_threads FROM PUBLIC, anon, authenticated;");
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]*ON public\.email_threads/);
  });

  it("stores tokens only as a hash", () => {
    expect(sql).toMatch(/token_hash TEXT NOT NULL UNIQUE CHECK \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(sql).not.toMatch(/\btoken TEXT\b/);
  });

  it("makes a provider message recordable only once", () => {
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS activities_provider_message_id_key");
  });
});
