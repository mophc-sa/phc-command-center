// =============================================================================
// Contract tests for the Phase 4 notifications migration.
//
// These read the migration SQL and assert the properties the application layer
// depends on. They are NOT a substitute for behaviour — the behavioural proof
// runs the migration against a real Postgres and exercises the triggers. What
// these catch is the class of regression where someone edits the SQL and the
// guarantee quietly disappears: no RLS, a missing dedupe index, an admin
// bypass, or a client-writable table.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SQL = readFileSync(
  join(import.meta.dir, "../../supabase/migrations/20260819100000_phase_4_notifications.sql"),
  "utf8",
);

/** Comments explain intent and often mention the very thing we forbid. */
function code(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
}
const CODE = code(SQL);

describe("notifications table", () => {
  it("exists with the fields the client reads", () => {
    for (const col of [
      "recipient_user_id",
      "notification_type",
      "entity_type",
      "entity_id",
      "title",
      "body",
      "severity",
      "source_event",
      "dedupe_key",
      "metadata",
      "created_at",
      "read_at",
      "dismissed_at",
    ]) {
      expect(CODE).toContain(col);
    }
  });

  it("enables row level security", () => {
    expect(CODE).toContain("ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY");
  });

  it("scopes both SELECT and UPDATE to the recipient", () => {
    const selectPolicy = CODE.slice(CODE.indexOf("FOR SELECT"));
    expect(selectPolicy).toContain("recipient_user_id = (SELECT auth.uid())");
    const updatePolicy = CODE.slice(CODE.indexOf("FOR UPDATE"));
    expect(updatePolicy).toContain("recipient_user_id = (SELECT auth.uid())");
    expect(updatePolicy).toContain("WITH CHECK");
  });

  // A client INSERT policy would let anyone forge a notification addressed to
  // someone else — the table's whole trust model is that only triggers write.
  it("grants no INSERT or DELETE policy to clients", () => {
    expect(CODE).not.toMatch(/CREATE POLICY[^;]+ON public\.notifications\s+FOR INSERT/i);
    expect(CREATE_POLICY_DELETE_RE.test(CODE)).toBe(false);
  });

  it("has no admin bypass — platform admin is not a reason to read an inbox", () => {
    const policyBlock = CODE.slice(CODE.indexOf("ENABLE ROW LEVEL SECURITY"), CODE.indexOf("CREATE OR REPLACE FUNCTION public.emit_notification("));
    expect(policyBlock).not.toContain("is_platform_admin");
    expect(policyBlock).not.toContain("system_admin");
  });
});

const CREATE_POLICY_DELETE_RE = /CREATE POLICY[^;]+ON public\.notifications\s+FOR DELETE/i;

describe("deduplication", () => {
  it("is enforced by a unique index, not only by the emitter", () => {
    expect(CODE).toContain("CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe");
    expect(CODE).toMatch(
      /notifications_dedupe[\s\S]{0,200}recipient_user_id,\s*notification_type,\s*entity_type,\s*entity_id,\s*dedupe_key/,
    );
  });

  it("the emitter absorbs duplicates instead of raising", () => {
    expect(CODE).toContain("ON CONFLICT");
    expect(CODE).toContain("DO NOTHING");
  });

  it("intake review is fingerprinted on resubmit_count so a resubmission re-notifies", () => {
    expect(CODE).toContain("'pending_review:' || COALESCE(NEW.resubmit_count, 0)::TEXT");
  });

  it("stage change is fingerprinted on the destination stage", () => {
    expect(CODE).toContain("'stage:' || COALESCE(NEW.sales_stage::TEXT, 'null')");
  });

  it("overdue is fingerprinted on (flag, due date) so it fires once, not per run", () => {
    expect(CODE).toContain("'overdue:' || _r.id::TEXT || ':' || _r.due_date::TEXT");
  });
});

describe("emitter rules", () => {
  it("never notifies the actor about their own action", () => {
    expect(CODE).toContain("IF _recipient = auth.uid() THEN");
  });

  it("skips recipients who are not active users", () => {
    expect(CODE).toContain("NOT public.is_active_user(_recipient)");
  });

  it("is not callable by clients", () => {
    expect(CODE).toMatch(/REVOKE ALL ON FUNCTION public\.emit_notification\(/);
    expect(CODE).toMatch(/REVOKE ALL ON FUNCTION public\.emit_notification_to_roles\(/);
    expect(CODE).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.emit_notification\b/);
  });

  it("only the three read-state RPCs are granted to authenticated", () => {
    const grants = [...CODE.matchAll(/GRANT EXECUTE ON FUNCTION public\.(\w+)/g)].map((m) => m[1]).sort();
    expect(grants).toEqual([
      "dismiss_notification",
      "mark_all_notifications_read",
      "mark_notifications_read",
    ]);
  });

  it("the read-state RPCs run as invoker so RLS still applies", () => {
    const rpcs = CODE.slice(CODE.indexOf("mark_notifications_read"));
    expect(rpcs).toContain("SECURITY INVOKER");
    expect(rpcs).toContain("recipient_user_id = auth.uid()");
  });
});

// Phase 1 governance: reviewing intake is commercial judgement, so the fan-out
// must not include system_admin. This is the same rule can_review_intake
// enforces; a divergence here would notify people who cannot act.
describe("governance", () => {
  it("intake review fan-out excludes system_admin", () => {
    const fanouts = [...CODE.matchAll(/ARRAY\[([^\]]*)\]::public\.app_role\[\]/g)].map((m) => m[1]);
    expect(fanouts.length).toBeGreaterThan(0);
    for (const roles of fanouts) {
      expect(roles).not.toContain("system_admin");
      expect(roles).toContain("sales_manager");
      expect(roles).toContain("bd_manager");
    }
  });

  it("content is immutable to the recipient — only read/dismiss may change", () => {
    expect(CODE).toContain("Only read_at and dismissed_at may be changed on a notification");
    expect(CODE).toContain("trg_protect_notification_content");
  });
});

describe("event coverage (PRD Phase 4 §7)", () => {
  // Intake lives on inbox_items, not opportunities — the review gate runs
  // before an opportunity exists. Getting this wrong means no intake
  // notification ever fires.
  it("intake events are triggered on inbox_items", () => {
    expect(CODE).toContain("ON public.inbox_items");
    expect(CODE).toContain("trg_notify_inbox_intake_events");
  });

  it("stage / handoff / assignment are triggered on opportunities", () => {
    expect(CODE).toContain("ON public.opportunities");
    expect(CODE).toContain("trg_notify_opportunity_events");
  });

  it("approval events are triggered on approvals", () => {
    expect(CODE).toContain("ON public.approvals");
    expect(CODE).toContain("trg_notify_approval_events");
  });

  it("emits every high-value event the PRD lists", () => {
    for (const type of [
      "intake_review_requested",
      "intake_need_information",
      "intake_resubmitted",
      "intake_approved",
      "intake_rejected",
      "intake_assigned",
      "approval_requested",
      "approval_approved",
      "approval_rejected",
      "stage_changed",
      "handoff_changed",
      "assigned",
      "item_overdue",
    ]) {
      expect(CODE).toContain(`'${type}'`);
    }
  });

  it("builds no email, WhatsApp, SMS or push channel — those are later phases", () => {
    for (const forbidden of ["smtp", "sendgrid", "whatsapp", "twilio", "firebase", "pg_net", "http_post"]) {
      expect(CODE.toLowerCase()).not.toContain(forbidden);
    }
  });
});
