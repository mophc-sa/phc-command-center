// =============================================================================
// Connecting Outlook — where the code lives, what it checks first, and who may
// touch a token. Unit behaviour: supabase/functions/_shared/graph.deno-test.ts.
// Database behaviour: supabase/tests/outlook_connect_access.test.sql.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const MAIL = read("supabase/functions/sales-os-api/handlers/mail.ts");
const START = read("supabase/functions/sales-os-api/handlers/outlook.ts");
const CALLBACK = read("supabase/functions/outlook-connector/index.ts");
const SQL = read("supabase/migrations/20261002100000_outlook_connect.sql");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

describe("Microsoft is reached from one file", () => {
  it("only graph-client.ts names Graph or the sign-in endpoints for API calls", () => {
    const offenders = [...walk("supabase/functions"), ...walk("src")].filter(
      (p) => !p.endsWith("graph-client.ts") && !p.includes(".test.") && !p.includes("deno-test") &&
        /graph\.microsoft\.com/.test(read(p)),
    );
    expect(offenders).toEqual([]);
  });

  it("no browser code ever sees a Microsoft secret or token", () => {
    const offenders = walk("src").filter(
      (p) => !p.includes(".test.") && /MS_CLIENT_SECRET|mail_refresh_token|mail_connections|code_verifier/.test(read(p)),
    );
    expect(offenders).toEqual([]);
  });
});

describe("sending through Outlook keeps the send_email order", () => {
  it("the Graph send happens after the role check, the deal check and validation", () => {
    const send = MAIL.indexOf("await sendAsMe(");
    expect(send).toBeGreaterThan(-1);
    for (const before of ['rpc("is_sales_contributor"', '.from("opportunities")', "composeOutbound("]) {
      expect(MAIL.indexOf(before)).toBeLessThan(send);
    }
  });

  it("an expired connection is refused, never rerouted to Postmark", () => {
    expect(MAIL).toMatch(/invalid_grant[\s\S]*?needs_reconnect[\s\S]*?return err\(RECONNECT, 409\)/);
    expect(MAIL).toContain('conn.status !== "active"');
  });

  it("the sender is still never taken from the payload", () => {
    expect(MAIL).not.toMatch(/payload\.from\b/);
  });
});

describe("the sign-in cannot be hijacked or pointed at another mailbox", () => {
  it("only sales contributors may start a connection", () => {
    expect(START.indexOf('rpc("is_sales_contributor"')).toBeLessThan(START.indexOf("mail_oauth_pending"));
  });

  it("the state is stored only as a hash, with the PKCE verifier", () => {
    expect(START).toContain("state_hash: await hashState(state)");
    expect(START).not.toMatch(/state:\s*state/);
  });

  it("the callback consumes the one-time state before exchanging the code", () => {
    const consume = CALLBACK.indexOf('.from("mail_oauth_pending")\n    .delete()');
    expect(consume).toBeGreaterThan(-1);
    expect(consume).toBeLessThan(CALLBACK.indexOf("exchangeCode("));
  });

  it("the mailbox must be the caller's own before anything is saved", () => {
    expect(CALLBACK.indexOf("sameMailbox(")).toBeLessThan(CALLBACK.indexOf('rpc("save_mail_connection"'));
  });

  it("never logs or redirects with a token", () => {
    const logs = CALLBACK.match(/console\.(log|error)\([^;]*\);/g) ?? [];
    for (const l of logs) expect(l).not.toMatch(/tok|code|mail|refresh/);
    expect(CALLBACK).not.toMatch(/outlook=\$\{(tok|code|me)/);
  });

  it("is deployed without JWT verification and type-checked in CI", () => {
    expect(read("supabase/config.toml")).toMatch(/\[functions\.outlook-connector\]\s*\nverify_jwt = false/);
    expect(read(".github/workflows/ci.yml")).toContain("supabase/functions/outlook-connector/index.ts");
  });
});

describe("the database keeps tokens to the service role", () => {
  it("tables and functions are revoked from every client role", () => {
    expect(SQL).toContain("REVOKE ALL ON public.mail_connections, public.mail_oauth_pending FROM PUBLIC, anon, authenticated;");
    for (const fn of ["save_mail_connection", "mail_refresh_token", "rotate_mail_refresh_token", "mark_mail_connection", "delete_mail_connection"]) {
      expect(SQL).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
      expect(SQL).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`));
    }
  });

  it("the token lives in Vault, not in a column", () => {
    expect(SQL).toContain("vault.create_secret(");
    expect(SQL).not.toMatch(/^\s+refresh_token\s+TEXT/im);
  });

  it("the actions are registered", () => {
    expect(read("supabase/functions/sales-os-api/index.ts")).toContain("outlookModule,");
  });
});

describe("the interface offers only what the backend allows", () => {
  it("the Settings card renders only when Outlook is available to this person", () => {
    const card = read("src/components/phc/OutlookConnectionCard.tsx");
    expect(card).toContain("if (!o?.available) return null;");
    expect(read("src/routes/_authenticated/settings.tsx")).toContain("<OutlookConnectionCard />");
  });

  it("the compose window names the mailbox the email will leave from", () => {
    const modal = read("src/components/phc/EmailComposeModal.tsx");
    expect(modal).toContain("mailStatus.data?.outlook.connected === true");
    expect(modal).toContain('t("email_sends_from_outlook")');
  });

  it("the browser only starts the sign-in; it never builds the Microsoft URL", () => {
    const actions = read("src/lib/mail-actions.ts");
    expect(actions).toContain('callBackend<{ url?: string }>("outlook_connect_start"');
    expect(actions).not.toMatch(/login\.microsoftonline\.com/);
  });
});

