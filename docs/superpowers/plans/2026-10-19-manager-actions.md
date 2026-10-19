# Manager's Five Actions (Part A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put five action cards (Call, Meetings, Email, Follow up with the team, Approve) at the top of `/command-center`, each listing its top three items from data the system already has.

**Architecture:** The ranking and filtering are pure functions in `src/lib/manager-actions.ts`, unit-tested with bun. One new read-only backend action, `outlook_calendar_upcoming` in `sales-os-api`, reads the caller's Outlook calendar. Its date window and response mapping are pure functions in `_shared/graph.ts`; the HTTP call goes in `_shared/graph-client.ts`, the only file allowed to talk to Microsoft. A `ManagerActions` component renders the strip and owns the extra queries. The 1,280-line route only mounts it, and loses the old "Decisions awaiting approval" strip.

**Tech Stack:** React 19 + TanStack Router/Query, Tailwind, bun:test, Deno tests for edge code, Supabase.

**Spec:** `docs/superpowers/specs/2026-10-19-manager-actions-info-mail-design.md`, Part A.
**Deviation from the spec (found while planning):** Outlook actions live in `sales-os-api/handlers/outlook.ts`. `outlook-connector` is only the OAuth callback. The calendar action therefore goes in `sales-os-api`, not `outlook-connector`. The spec's role requirement is already met: `outlook_connect_start` allows anyone `is_sales_contributor`, which includes `ceo`, `general_manager`, `managing_director` and `sales_manager`. No gate change.

## Global Constraints

- Work in `~/dev/phc-g3`, branch `feat/manager-actions` (Task 0 sets it up). Push via the `mophc-sa` gh account, then switch back to `moalagab`.
- Bilingual UI: every string has an Arabic and an English form, chosen with `lang === "ar" ? … : …` as `command-center.tsx` does.
- **No Arabic-Indic digits (٠–٩) anywhere in source**, and never a bare `"ar"`/`"ar-SA"` locale. Use `formatNumber(n, lang)` and `localeFor(lang)` from `@/lib/i18n`. `src/lib/arabic-digits.test.ts` enforces this.
- Only `supabase/functions/_shared/graph-client.ts` may contain `graph.microsoft.com` (`src/lib/outlook-connect.contract.test.ts`).
- No browser code may mention `mail_refresh_token`, `mail_connections`, `MS_CLIENT_SECRET` or `code_verifier`.
- No migration in this part. Nothing auto-deploys on merge (`docs/deployment-governance.md`). `sales-os-api` is deployed only with Mo's approval.
- Card thresholds: quiet = **14 days** without client contact; the command center reads **30 days** of activity, so a deal with no contact in that window shows "30+ days".
- Each card shows at most **3** items; the count is the full number.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/manager-actions.ts` (new) | Pure rules: which deals to call, which contact, which reps to chase, which approvals are manager decisions, the meeting day label |
| `src/lib/manager-actions.test.ts` (new) | bun tests for the above |
| `supabase/functions/_shared/graph.ts` | + `calendarWindow`, `CalendarEvent`, `toCalendarEvents` |
| `supabase/functions/_shared/graph-client.ts` | + `calendarView` (the HTTP call) |
| `supabase/functions/_shared/graph.deno-test.ts` | + tests for the three |
| `supabase/functions/sales-os-api/handlers/outlook.ts` | + `outlook_calendar_upcoming` |
| `src/lib/mail-actions.ts` | + `upcomingMeetings()` browser call |
| `src/lib/outlook-connect.contract.test.ts` | + one contract test for the new action |
| `src/components/phc/ManagerActions.tsx` (new) | The five-card strip, its queries and its two small dialogs |
| `src/routes/_authenticated/command-center.tsx` | Mount the strip; fetch stakeholder phone; drop the old approvals strip and its query |
| `docs/USER_GUIDE.md`, `docs/CHANGELOG.md`, `docs/AI_HANDOFF.md`, `tasks/current.md` | Docs in the same PR |

---

### Task 0: Branch on top of PR #349

PR #349 (`fix/manager-feedback-oct20`, still open) adds `isManagerDecision` in `src/lib/approval-labels.ts`, which this part needs.

- [ ] **Step 1: Rename the branch and rebase onto #349**

```bash
cd ~/dev/phc-g3
git fetch origin
git branch -m feat/manager-actions-info-mail feat/manager-actions
git rebase --onto origin/fix/manager-feedback-oct20 origin/main feat/manager-actions
git log --oneline -3
```
Expected: the spec and plan commits sit on top of #349's tip (`ba77e59` or later).

- [ ] **Step 2: Confirm the dependency exists and the suite is green before any change**

```bash
grep -n "export function isManagerDecision" src/lib/approval-labels.ts
bun install --frozen-lockfile
bun run test 2>&1 | tail -3
```
Expected: the grep prints one line, and the tests pass (record the pass count).

If #349 has merged into `main` by the time you run this, use `git rebase origin/main` instead. The PR in Task 6 then targets `main`.

---

### Task 1: Pure card rules

**Files:**
- Create: `src/lib/manager-actions.ts`
- Test: `src/lib/manager-actions.test.ts`

**Interfaces:**
- Consumes: `AttentionItem`, `daysBetween` from `@/lib/attention`; `StakeholderRow`, `effectiveRole` from `@/lib/stakeholder-roles`; `RepDay` (type) from `@/lib/daily-tasks`; `UnifiedApproval` (type) from `@/lib/approvals-center`; `isManagerDecision` from `@/lib/approval-labels`.
- Produces:
  - `QUIET_DAYS = 14`, `ACTIVITY_WINDOW_DAYS = 30`
  - `type CallItem = { opportunityId: string; projectName: string; contactName: string | null; phone: string | null; quietDays: number | null; score: number }`
  - `pickContact(rows: ContactRow[]): { name: string | null; phone: string | null } | null`, where `type ContactRow = StakeholderRow & { contact_order?: number | null }`
  - `callItems(attention: AttentionItem[], stakeholdersByOpp: Map<string, ContactRow[]>, today: string): CallItem[]`
  - `teamItems(rows: RepDay[]): RepDay[]`
  - `approveItems(list: UnifiedApproval[]): UnifiedApproval[]`
  - `meetingDay(startLocal: string, today: string): "today" | "tomorrow" | "later"`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/manager-actions.test.ts
import { describe, expect, it } from "bun:test";
import type { AttentionItem } from "@/lib/attention";
import type { RepDay } from "@/lib/daily-tasks";
import type { UnifiedApproval } from "@/lib/approvals-center";
import { approveItems, callItems, meetingDay, pickContact, teamItems, type ContactRow } from "@/lib/manager-actions";

const TODAY = "2026-10-20";

function att(p: Partial<AttentionItem> & { opportunityId: string }): AttentionItem {
  return {
    label: `Deal ${p.opportunityId}`,
    ownerId: null,
    stage: null,
    value: null,
    priority: "high",
    score: 10,
    reasons: [],
    primaryReason: {} as AttentionItem["primaryReason"],
    issueCount: 1,
    oldestOverdueDays: null,
    lastClientActivity: null,
    nextAction: { text: null, due: null, status: "missing" },
    aging: {} as AttentionItem["aging"],
    atRisk: false,
    stalled: false,
    closingSoon: false,
    ...p,
  };
}

describe("callItems", () => {
  it("keeps only at-risk, stalled or closing-soon deals", () => {
    const out = callItems(
      [
        att({ opportunityId: "a", atRisk: true }),
        att({ opportunityId: "b", stalled: true }),
        att({ opportunityId: "c", closingSoon: true }),
        att({ opportunityId: "d" }),
      ],
      new Map(),
      TODAY,
    );
    expect(out.map((c) => c.opportunityId).sort()).toEqual(["a", "b", "c"]);
  });

  it("drops a deal contacted within 14 days and keeps one quiet for 14 or with no contact", () => {
    const out = callItems(
      [
        att({ opportunityId: "recent", atRisk: true, lastClientActivity: "2026-10-10T09:00:00Z" }),
        att({ opportunityId: "edge", atRisk: true, lastClientActivity: "2026-10-06T09:00:00Z" }),
        att({ opportunityId: "never", atRisk: true, lastClientActivity: null }),
      ],
      new Map(),
      TODAY,
    );
    expect(out.map((c) => [c.opportunityId, c.quietDays])).toEqual([
      ["edge", 14],
      ["never", null],
    ]);
  });

  it("ranks by attention score, highest first", () => {
    const out = callItems(
      [
        att({ opportunityId: "low", atRisk: true, score: 20 }),
        att({ opportunityId: "high", atRisk: true, score: 80 }),
      ],
      new Map(),
      TODAY,
    );
    expect(out.map((c) => c.opportunityId)).toEqual(["high", "low"]);
  });

  it("names the deal and its contact", () => {
    const rows: ContactRow[] = [{ id: "s1", name: "Ahmed", role_code: "decision_maker", phone: "0500000001" }];
    const [c] = callItems([att({ opportunityId: "a", atRisk: true, label: "NEOM tower" })], new Map([["a", rows]]), TODAY);
    expect(c).toMatchObject({ projectName: "NEOM tower", contactName: "Ahmed", phone: "0500000001" });
  });
});

describe("pickContact", () => {
  it("prefers a decision maker with a phone", () => {
    const rows: ContactRow[] = [
      { id: "1", name: "Sara", phone: "0501", contact_order: 1 },
      { id: "2", name: "Omar", role_code: "decision_maker", phone: "0502", contact_order: 2 },
    ];
    expect(pickContact(rows)).toEqual({ name: "Omar", phone: "0502" });
  });

  it("falls back to the first stakeholder with a phone when the decision maker has none", () => {
    const rows: ContactRow[] = [
      { id: "1", name: "Omar", role_code: "decision_maker", phone: null, contact_order: 1 },
      { id: "2", name: "Sara", phone: "0501", contact_order: 2 },
    ];
    expect(pickContact(rows)).toEqual({ name: "Sara", phone: "0501" });
  });

  it("returns the first stakeholder without a phone when nobody has one", () => {
    const rows: ContactRow[] = [
      { id: "2", name: "Later", contact_order: 2 },
      { id: "1", name: "First", contact_order: 1 },
    ];
    expect(pickContact(rows)).toEqual({ name: "First", phone: null });
  });

  it("returns null with no stakeholders", () => {
    expect(pickContact([])).toBeNull();
  });
});

describe("teamItems", () => {
  const rep = (p: Partial<RepDay> & { user_id: string }): RepDay => ({
    full_name: p.user_id,
    done: 0,
    open_due: 0,
    overdue: 0,
    buckets: {},
    ...p,
  });

  it("keeps reps with overdue work, or due work and nothing done", () => {
    const out = teamItems([
      rep({ user_id: "late", overdue: 2 }),
      rep({ user_id: "stuck", open_due: 3, done: 0 }),
      rep({ user_id: "moving", open_due: 3, done: 1 }),
      rep({ user_id: "clear" }),
    ]);
    expect(out.map((r) => r.user_id)).toEqual(["late", "stuck"]);
  });

  it("orders by overdue, then open due, then name", () => {
    const out = teamItems([
      rep({ user_id: "b", full_name: "Bader", overdue: 1, open_due: 1 }),
      rep({ user_id: "a", full_name: "Adel", overdue: 1, open_due: 1 }),
      rep({ user_id: "c", full_name: "Cyrus", overdue: 1, open_due: 4 }),
      rep({ user_id: "d", full_name: "Dana", overdue: 5 }),
    ]);
    expect(out.map((r) => r.user_id)).toEqual(["d", "c", "a", "b"]);
  });
});

describe("approveItems", () => {
  const ap = (p: Partial<UnifiedApproval> & { id: string }): UnifiedApproval => ({
    kind: "record",
    sourceRecordId: p.id,
    approvalType: "discount",
    step: null,
    entityLabel: null,
    entityId: null,
    clientContext: null,
    requesterId: null,
    requiredRole: "sales_manager",
    state: "pending",
    submittedAt: "2026-10-01T00:00:00Z",
    decidedAt: null,
    notes: null,
    evidence: null,
    href: "/approvals",
    ...p,
  });

  it("keeps pending manager decisions only, oldest first", () => {
    const out = approveItems([
      ap({ id: "new-discount", submittedAt: "2026-10-18T00:00:00Z" }),
      ap({ id: "old-bafo", kind: "bafo", approvalType: "bafo", submittedAt: "2026-10-02T00:00:00Z" }),
      ap({ id: "routine", approvalType: "ai_recommendation" }),
      ap({ id: "intake", kind: "intake", approvalType: "intake_review" }),
      ap({ id: "done", state: "approved" }),
    ]);
    expect(out.map((a) => a.id)).toEqual(["old-bafo", "new-discount"]);
  });
});

describe("meetingDay", () => {
  it("labels today, tomorrow and later by the Riyadh calendar date", () => {
    expect(meetingDay("2026-10-20T10:00", TODAY)).toBe("today");
    expect(meetingDay("2026-10-21T09:30", TODAY)).toBe("tomorrow");
    expect(meetingDay("2026-10-22T09:30", TODAY)).toBe("later");
    expect(meetingDay("2026-10-31T23:00", "2026-10-30")).toBe("tomorrow");
  });
});
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `bun test src/lib/manager-actions.test.ts`
Expected: FAIL, `Cannot find module "@/lib/manager-actions"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/manager-actions.ts
// =============================================================================
// The manager's five actions — the rules behind each card on /command-center.
//
// Asked for 2026-10-19: a home page that steers the manager to the top five
// actions — call, meeting, email, follow up with the team, approve. Each card
// shows what the system already knows; nothing here writes or guesses.
// Spec: docs/superpowers/specs/2026-10-19-manager-actions-info-mail-design.md
// =============================================================================

import { daysBetween, type AttentionItem } from "@/lib/attention";
import { effectiveRole, type StakeholderRow } from "@/lib/stakeholder-roles";
import { isManagerDecision } from "@/lib/approval-labels";
import type { RepDay } from "@/lib/daily-tasks";
import type { UnifiedApproval } from "@/lib/approvals-center";

/** A deal is quiet after this many days without verified client contact. */
export const QUIET_DAYS = 14;
/** How far back the command center reads activity; older contact shows as "30+". */
export const ACTIVITY_WINDOW_DAYS = 30;

export type ContactRow = StakeholderRow & { contact_order?: number | null };

export type CallItem = {
  opportunityId: string;
  projectName: string;
  contactName: string | null;
  phone: string | null;
  /** Days since the last client contact; null = none in the activity window. */
  quietDays: number | null;
  score: number;
};

const hasPhone = (s: ContactRow) => Boolean(s.phone?.trim());

/** Who to call on a deal: the decision maker with a phone, else anyone with a phone, else the first listed. */
export function pickContact(rows: ContactRow[]): { name: string | null; phone: string | null } | null {
  const ordered = [...rows].sort((a, b) => (a.contact_order ?? 999) - (b.contact_order ?? 999));
  const chosen =
    ordered.find((s) => effectiveRole(s) === "decision_maker" && hasPhone(s)) ??
    ordered.find(hasPhone) ??
    ordered[0];
  if (!chosen) return null;
  return { name: chosen.name?.trim() || null, phone: chosen.phone?.trim() || null };
}

/** Top-priority deals (at risk, stalled, closing soon) that have gone quiet, highest score first. */
export function callItems(
  attention: AttentionItem[],
  stakeholdersByOpp: Map<string, ContactRow[]>,
  today: string,
): CallItem[] {
  return attention
    .filter((a) => a.atRisk || a.stalled || a.closingSoon)
    .map((a) => ({ a, quiet: a.lastClientActivity ? daysBetween(a.lastClientActivity, today) : null }))
    .filter(({ quiet }) => quiet === null || quiet >= QUIET_DAYS)
    .sort((x, y) => y.a.score - x.a.score)
    .map(({ a, quiet }) => {
      const contact = pickContact(stakeholdersByOpp.get(a.opportunityId) ?? []);
      return {
        opportunityId: a.opportunityId,
        projectName: a.label,
        contactName: contact?.name ?? null,
        phone: contact?.phone ?? null,
        quietDays: quiet,
        score: a.score,
      };
    });
}

/** Reps who need a nudge today: anything overdue, or work due and nothing done yet. */
export function teamItems(rows: RepDay[]): RepDay[] {
  return rows
    .filter((r) => r.overdue > 0 || (r.open_due > 0 && r.done === 0))
    .sort(
      (a, b) =>
        b.overdue - a.overdue ||
        b.open_due - a.open_due ||
        (a.full_name ?? "").localeCompare(b.full_name ?? ""),
    );
}

/** Pending decisions that are genuinely the manager's (see approval-labels.ts), oldest first. */
export function approveItems(list: UnifiedApproval[]): UnifiedApproval[] {
  return list
    .filter((a) => a.state === "pending" && isManagerDecision(a.kind, a.approvalType))
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

/** `startLocal` is Outlook's Riyadh-time "YYYY-MM-DDTHH:mm"; `today` is the Riyadh date. */
export function meetingDay(startLocal: string, today: string): "today" | "tomorrow" | "later" {
  const day = startLocal.slice(0, 10);
  if (day === today) return "today";
  const next = new Date(`${today}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return day === next.toISOString().slice(0, 10) ? "tomorrow" : "later";
}
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `bun test src/lib/manager-actions.test.ts`
Expected: PASS, all 12 tests.

If the `approveItems` test fails on `old-bafo`, read `fromBafo` in `src/lib/approvals-center.ts`. `approvalType` there may be a label rather than `"bafo"`; `isManagerDecision("bafo", …)` returns true for any type, so the kind alone decides it. Fix the test data, not the rule.

- [ ] **Step 5: Commit**

```bash
git add src/lib/manager-actions.ts src/lib/manager-actions.test.ts
git commit -m "feat(home): rules for the manager's five action cards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Read the caller's Outlook calendar (backend)

**Files:**
- Modify: `supabase/functions/_shared/graph.ts` (append at the end)
- Modify: `supabase/functions/_shared/graph-client.ts` (append at the end)
- Modify: `supabase/functions/sales-os-api/handlers/outlook.ts`
- Test: `supabase/functions/_shared/graph.deno-test.ts` (append), `src/lib/outlook-connect.contract.test.ts` (append)

**Interfaces:**
- Produces (Deno):
  - `calendarWindow(now: Date): { start: string; end: string }`: ISO `YYYY-MM-DDTHH:mm:ssZ`, from now to Riyadh midnight at the end of tomorrow.
  - `type CalendarEvent = { id: string; subject: string; start: string; end: string; location: string | null; webLink: string | null }`: `start`/`end` are Riyadh local `YYYY-MM-DDTHH:mm`.
  - `toCalendarEvents(value: unknown): CalendarEvent[]`
  - `calendarView(access: string, startIso: string, endIso: string, f?: typeof fetch): Promise<{ ok: true; value: unknown } | { ok: false; status: number }>`
  - Backend action `outlook_calendar_upcoming` → `{ connected: boolean; reconnect?: boolean; events: CalendarEvent[] }`

- [ ] **Step 1: Write the failing Deno tests** (append to `graph.deno-test.ts`; also add the new names to its two import lines)

```ts
// at the top, extend the existing imports:
//   from "./graph.ts":        add calendarWindow, toCalendarEvents
//   from "./graph-client.ts": add calendarView

Deno.test("calendar window runs from now to the end of tomorrow in Riyadh", () => {
  // 2026-10-20 08:15 UTC = 11:15 Riyadh → end is 2026-10-22 00:00 Riyadh = 2026-10-21 21:00 UTC
  assertEquals(calendarWindow(new Date("2026-10-20T08:15:30.123Z")), {
    start: "2026-10-20T08:15:30Z",
    end: "2026-10-21T21:00:00Z",
  });
  // 22:30 UTC is already the next day in Riyadh (01:30)
  assertEquals(calendarWindow(new Date("2026-10-20T22:30:00Z")).end, "2026-10-22T21:00:00Z");
});

Deno.test("calendar events drop cancelled and private ones and keep Riyadh local times", () => {
  const out = toCalendarEvents([
    {
      id: "e1",
      subject: " NEOM review ",
      start: { dateTime: "2026-10-20T10:00:00.0000000" },
      end: { dateTime: "2026-10-20T11:00:00.0000000" },
      location: { displayName: "HQ" },
      webLink: "https://outlook.office365.com/owa/?itemid=1",
      isCancelled: false,
      sensitivity: "normal",
    },
    { id: "e2", subject: "x", start: { dateTime: "2026-10-20T12:00:00" }, end: { dateTime: "2026-10-20T13:00:00" }, isCancelled: true },
    { id: "e3", subject: "x", start: { dateTime: "2026-10-20T12:00:00" }, end: { dateTime: "2026-10-20T13:00:00" }, sensitivity: "private" },
    { id: "e4", subject: "", start: { dateTime: "2026-10-21T09:30:00" }, end: { dateTime: "2026-10-21T10:00:00" }, webLink: "https://evil.example/x" },
    { subject: "no id", start: { dateTime: "2026-10-21T09:30:00" } },
  ]);
  assertEquals(out, [
    { id: "e1", subject: "NEOM review", start: "2026-10-20T10:00", end: "2026-10-20T11:00", location: "HQ", webLink: "https://outlook.office365.com/owa/?itemid=1" },
    { id: "e4", subject: "", start: "2026-10-21T09:30", end: "2026-10-21T10:00", location: null, webLink: null },
  ]);
  assertEquals(toCalendarEvents(null), []);
});

Deno.test("calendarView asks Graph for the window in Riyadh time and reads only the listed fields", async () => {
  let seenUrl = "";
  let seenHeaders: Record<string, string> = {};
  const fake = ((url: string, init?: RequestInit) => {
    seenUrl = url;
    seenHeaders = init?.headers as Record<string, string>;
    return Promise.resolve(new Response(JSON.stringify({ value: [{ id: "e1" }] }), { status: 200 }));
  }) as typeof fetch;
  const r = await calendarView("tok", "2026-10-20T08:15:30Z", "2026-10-21T21:00:00Z", fake);
  assertEquals(r, { ok: true, value: [{ id: "e1" }] });
  assert(seenUrl.startsWith("https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=2026-10-20T08:15:30Z&endDateTime=2026-10-21T21:00:00Z"));
  assert(seenUrl.includes("$select=subject,start,end,location,webLink,isCancelled,sensitivity"));
  assertEquals(seenHeaders.Authorization, "Bearer tok");
  assertEquals(seenHeaders.Prefer, 'outlook.timezone="Arab Standard Time"');
  assertEquals(await calendarView("tok", "bad", "2026-10-21T21:00:00Z", fake), { ok: false, status: 400 });
  const failing = (() => Promise.resolve(new Response("{}", { status: 403 }))) as typeof fetch;
  assertEquals(await calendarView("tok", "2026-10-20T08:15:30Z", "2026-10-21T21:00:00Z", failing), { ok: false, status: 403 });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `bun run test:deno 2>&1 | tail -5`
Expected: FAIL. The module has no export named `calendarWindow`.

- [ ] **Step 3: Implement the pure rules** (append to `supabase/functions/_shared/graph.ts`)

```ts
// ---- Calendar (read-only): the manager's home page Meetings card ----------

/** Riyadh is UTC+3 all year; Saudi Arabia keeps no daylight saving. */
const RIYADH_OFFSET_MS = 3 * 3_600_000;
const isoSeconds = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

/** From now to midnight (Riyadh) at the end of tomorrow. */
export function calendarWindow(now: Date): { start: string; end: string } {
  const riyadh = new Date(now.getTime() + RIYADH_OFFSET_MS);
  const todayStartUtc =
    Date.UTC(riyadh.getUTCFullYear(), riyadh.getUTCMonth(), riyadh.getUTCDate()) - RIYADH_OFFSET_MS;
  return { start: isoSeconds(now), end: isoSeconds(new Date(todayStartUtc + 2 * 86_400_000)) };
}

export type CalendarEvent = {
  id: string;
  subject: string;
  /** Riyadh local time, "YYYY-MM-DDTHH:mm" (asked for with Prefer: outlook.timezone). */
  start: string;
  end: string;
  location: string | null;
  webLink: string | null;
};

const OUTLOOK_LINK = /^https:\/\/outlook\.office(365)?\.com\//;

/** Graph calendarView items → what the card shows. Cancelled and private events never leave the server. */
export function toCalendarEvents(value: unknown): CalendarEvent[] {
  if (!Array.isArray(value)) return [];
  const out: CalendarEvent[] = [];
  for (const raw of value) {
    const e = (raw ?? {}) as {
      id?: unknown;
      subject?: unknown;
      start?: { dateTime?: unknown };
      end?: { dateTime?: unknown };
      location?: { displayName?: unknown };
      webLink?: unknown;
      isCancelled?: unknown;
      sensitivity?: unknown;
    };
    if (e.isCancelled === true) continue;
    if (e.sensitivity === "private" || e.sensitivity === "confidential") continue;
    const start = typeof e.start?.dateTime === "string" ? e.start.dateTime.slice(0, 16) : "";
    if (typeof e.id !== "string" || !e.id || start.length !== 16) continue;
    const end = typeof e.end?.dateTime === "string" ? e.end.dateTime.slice(0, 16) : start;
    const location = typeof e.location?.displayName === "string" ? e.location.displayName.trim() : "";
    out.push({
      id: e.id,
      subject: typeof e.subject === "string" ? e.subject.trim() : "",
      start,
      end,
      location: location || null,
      webLink: typeof e.webLink === "string" && OUTLOOK_LINK.test(e.webLink) ? e.webLink : null,
    });
  }
  return out;
}
```

- [ ] **Step 4: Implement the HTTP call** (append to `supabase/functions/_shared/graph-client.ts`)

```ts
/** The caller's own calendar between two instants, times returned in Riyadh time. Read-only. */
export async function calendarView(
  access: string,
  startIso: string,
  endIso: string,
  f: typeof fetch = fetch,
): Promise<{ ok: true; value: unknown } | { ok: false; status: number }> {
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
  if (!iso.test(startIso) || !iso.test(endIso)) return { ok: false, status: 400 };
  const url = `${GRAPH}/me/calendarView?startDateTime=${startIso}&endDateTime=${endIso}` +
    `&$select=subject,start,end,location,webLink,isCancelled,sensitivity&$orderby=start/dateTime&$top=20`;
  try {
    const res = await f(url, {
      headers: { Authorization: `Bearer ${access}`, Prefer: 'outlook.timezone="Arab Standard Time"' },
    });
    if (!res.ok) return { ok: false, status: res.status };
    const j = await res.json() as { value?: unknown };
    return { ok: true, value: j.value ?? [] };
  } catch {
    return { ok: false, status: 502 };
  }
}
```

- [ ] **Step 5: Run the Deno tests to make sure they pass**

Run: `bun run test:deno 2>&1 | tail -5`
Expected: PASS (the previous total + 3).

- [ ] **Step 6: Add the backend action.** In `supabase/functions/sales-os-api/handlers/outlook.ts`, change the graph import line and add the handler above `export const outlookModule`:

```ts
import {
  authorizeUrl,
  calendarWindow,
  hashState,
  newOAuthState,
  newPkce,
  readGraphConfig,
  toCalendarEvents,
} from "../../_shared/graph.ts";
import { calendarView, refreshAccess } from "../../_shared/graph-client.ts";
```

```ts
/**
 * The caller's own meetings, now to the end of tomorrow, for the Meetings card
 * on the manager's home page. Read-only: nothing is stored or written back.
 * Not connected (or the sign-in expired) is an answer, not an error.
 */
async function outlook_calendar_upcoming(_payload: Record<string, unknown>, ctx: SalesOsContext) {
  const cfg = readGraphConfig(env);
  if (!cfg.configured) return json({ connected: false, events: [] });
  const { data: refresh } = await ctx.svc.rpc("mail_refresh_token", { _user: ctx.caller.userId });
  if (typeof refresh !== "string" || !refresh) return json({ connected: false, events: [] });
  const tok = await refreshAccess(cfg, refresh);
  if (!tok.ok) {
    if (tok.reason === "invalid_grant") {
      await ctx.svc.rpc("mark_mail_connection", {
        _user: ctx.caller.userId,
        _status: "needs_reconnect",
        _error: "refresh token rejected",
      });
      return json({ connected: false, reconnect: true, events: [] });
    }
    return err("Outlook could not be reached", 502);
  }
  if (tok.refresh) {
    await ctx.svc.rpc("rotate_mail_refresh_token", { _user: ctx.caller.userId, _refresh_token: tok.refresh });
  }
  const { start, end } = calendarWindow(new Date());
  const r = await calendarView(tok.access, start, end);
  if (!r.ok) return err("Your Outlook calendar could not be read", 502);
  return json({ connected: true, events: toCalendarEvents(r.value) });
}
```

Then register it:

```ts
export const outlookModule: HandlerModule = {
  name: "outlook",
  handlers: { outlook_connect_start, outlook_disconnect, bind_email_to_deal, outlook_calendar_upcoming },
};
```

- [ ] **Step 7: Add the browser call** (append to `src/lib/mail-actions.ts`)

```ts
export type UpcomingMeeting = {
  id: string;
  subject: string;
  start: string;
  end: string;
  location: string | null;
  webLink: string | null;
};
export type UpcomingMeetings = { connected: boolean; reconnect?: boolean; events: UpcomingMeeting[] };

/** The caller's own Outlook meetings, now to the end of tomorrow (read-only). */
export async function upcomingMeetings(): Promise<UpcomingMeetings> {
  return await callBackend<UpcomingMeetings>("outlook_calendar_upcoming", {});
}
```

- [ ] **Step 8: Contract test** (append a `describe` block to `src/lib/outlook-connect.contract.test.ts`)

```ts
describe("the Meetings card reads the caller's calendar, never anyone else's", () => {
  it("the action is keyed to the caller and only reads", () => {
    expect(START).toContain("outlook_calendar_upcoming");
    const body = START.slice(START.indexOf("async function outlook_calendar_upcoming"));
    const fn = body.slice(0, body.indexOf("\n}\n"));
    expect(fn).toContain("ctx.caller.userId");
    expect(fn).not.toMatch(/payload\.(userId|user|mailbox)/);
    expect(fn).not.toMatch(/\.insert\(|\.update\(|\.upsert\(/);
  });

  it("the browser asks the backend; it never calls Graph itself", () => {
    expect(read("src/lib/mail-actions.ts")).toContain('callBackend<UpcomingMeetings>("outlook_calendar_upcoming"');
  });
});
```

- [ ] **Step 9: Run both suites**

Run: `bun test src/lib/outlook-connect.contract.test.ts && bun run test:deno 2>&1 | tail -3`
Expected: both PASS. The existing test "only graph-client.ts names Graph" still passes.

- [ ] **Step 10: Typecheck the edge function**

Run: `deno check --config supabase/functions/deno.json supabase/functions/sales-os-api/index.ts`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add supabase/functions/_shared/graph.ts supabase/functions/_shared/graph-client.ts \
  supabase/functions/_shared/graph.deno-test.ts supabase/functions/sales-os-api/handlers/outlook.ts \
  src/lib/mail-actions.ts src/lib/outlook-connect.contract.test.ts
git commit -m "feat(outlook): read the caller's meetings for today and tomorrow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The five-card strip

**Files:**
- Create: `src/components/phc/ManagerActions.tsx`

**Interfaces:**
- Consumes: everything in Task 1; `upcomingMeetings`, `UpcomingMeeting` from `@/lib/mail-actions` (Task 2); `logActivity` from `@/lib/activity-actions`; `createTask`, `riyadhDay`, `teamDay` from `@/lib/daily-tasks`; `fromBafo`, `fromRecordApproval`, `ageDays`, `BafoRowIn`, `RecordApprovalRowIn` from `@/lib/approvals-center`; `approvalTypeLabel` from `@/lib/approval-labels`; `getLatestAgentOutput` from `@/lib/ai-review-actions`; `isFromToday` from `@/components/phc/DailyEmailBrief`; `ActionDialog`, `DialogField` from `@/components/phc/ActionDialog`.
- Produces: `export function ManagerActions(props: { attention: AttentionItem[]; stakeholdersByOpp: Map<string, ContactRow[]>; loading: boolean })`

- [ ] **Step 1: Write the component**

```tsx
// src/components/phc/ManagerActions.tsx
// =============================================================================
// The manager's five actions, at the top of /command-center (2026-10-19):
// call, meetings, email, follow up with the team, approve. Each card shows
// its count and its top three items; the rules are in src/lib/manager-actions.ts.
// Call reuses the page's own attention list; the other four fetch their own
// small read so a failure in one never takes the page down.
// =============================================================================

import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, CalendarDays, CheckSquare, ExternalLink, Mail, Phone, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n, formatNumber } from "@/lib/i18n";
import { ActionDialog, type DialogField } from "@/components/phc/ActionDialog";
import { isFromToday } from "@/components/phc/DailyEmailBrief";
import type { AttentionItem } from "@/lib/attention";
import { logActivity } from "@/lib/activity-actions";
import { createTask, riyadhDay, teamDay } from "@/lib/daily-tasks";
import { ageDays, fromBafo, fromRecordApproval, type BafoRowIn, type RecordApprovalRowIn } from "@/lib/approvals-center";
import { approvalTypeLabel } from "@/lib/approval-labels";
import { getLatestAgentOutput } from "@/lib/ai-review-actions";
import { upcomingMeetings } from "@/lib/mail-actions";
import {
  ACTIVITY_WINDOW_DAYS,
  approveItems,
  callItems,
  meetingDay,
  teamItems,
  type CallItem,
  type ContactRow,
} from "@/lib/manager-actions";

const SHOWN = 3;
const OUTLOOK_CALENDAR = "https://outlook.office.com/calendar/";

type BriefItem = { activity_id: string; priority: "action" | "important" | "info"; line1: string; line2: string };

function ActionCard({
  icon,
  title,
  count,
  state,
  onRetry,
  empty,
  footer,
  children,
}: {
  icon: ReactNode;
  title: string;
  count: number | null;
  state: "loading" | "error" | "ready";
  onRetry?: () => void;
  empty: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  const { lang } = useI18n();
  return (
    <section aria-label={title} className="flex min-w-0 flex-col rounded-xl border border-border bg-surface p-4">
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </h3>
        <span className="num text-lg font-semibold leading-none" data-tabular="true">
          {state === "ready" && count !== null ? formatNumber(count, lang) : "—"}
        </span>
      </header>
      <div className="mt-3 flex-1 space-y-2 text-sm">
        {state === "loading" ? (
          <p className="text-muted-foreground">{lang === "ar" ? "جارٍ التحميل…" : "Loading…"}</p>
        ) : state === "error" ? (
          <button type="button" onClick={onRetry} className="text-destructive underline underline-offset-2">
            {lang === "ar" ? "تعذّر التحميل — أعد المحاولة" : "Could not load — try again"}
          </button>
        ) : count === 0 ? (
          <p className="text-muted-foreground">{empty}</p>
        ) : (
          children
        )}
      </div>
      <footer className="mt-3 border-t border-border/70 pt-2 text-xs text-muted-foreground">{footer}</footer>
    </section>
  );
}

// Typed routes: a plain `string` is rejected by TanStack Router's Link.
function ViewAll({ to, label }: { to: "/action-center" | "/my-workspace" | "/approvals"; label: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 hover:text-foreground">
      {label} <ArrowRight className="h-3 w-3 rtl:rotate-180" aria-hidden="true" />
    </Link>
  );
}

export function ManagerActions({
  attention,
  stakeholdersByOpp,
  loading,
}: {
  attention: AttentionItem[];
  stakeholdersByOpp: Map<string, ContactRow[]>;
  loading: boolean;
}) {
  const { lang } = useI18n();
  const { user } = useAuth();
  const qc = useQueryClient();
  const uid = user?.id ?? "";
  const today = riyadhDay();
  const ar = lang === "ar";
  const viewAll = ar ? "عرض الكل" : "View all";

  const [callFor, setCallFor] = useState<CallItem | null>(null);
  const [taskFor, setTaskFor] = useState<{ id: string; name: string } | null>(null);

  // ── Call: from the page's own attention list ─────────────────────────────
  const calls = callItems(attention, stakeholdersByOpp, today);

  // ── Meetings: the manager's Outlook calendar ─────────────────────────────
  const meetingsQ = useQuery({ queryKey: ["manager-meetings", uid], enabled: !!uid, staleTime: 5 * 60_000, queryFn: upcomingMeetings });
  const connected = meetingsQ.data?.connected ?? true;

  // ── Email: today's stored brief; never runs the AI from here ─────────────
  const briefQ = useQuery({
    queryKey: ["ai-output", "my_email", uid, "daily_email_brief"],
    enabled: !!uid,
    queryFn: () => getLatestAgentOutput("my_email", uid, "daily_email_brief"),
  });
  const briefToday = isFromToday(briefQ.data?.created_at);
  const briefItems = briefToday
    ? (((briefQ.data?.structured_output ?? null) as { items?: BriefItem[] } | null)?.items ?? [])
    : [];

  // ── Team: counts only, as the team panel shows them ──────────────────────
  const teamQ = useQuery({ queryKey: ["manager-team", today], staleTime: 60_000, queryFn: () => teamDay(today) });
  const team = teamItems(teamQ.data ?? []);

  // ── Approve: pending manager decisions ───────────────────────────────────
  const approveQ = useQuery({
    queryKey: ["manager-decisions-pending"],
    staleTime: 60_000,
    queryFn: async () => {
      const [recs, bafos] = await Promise.all([
        supabase
          .from("approvals")
          .select("*, opportunities(id, project_name, client)")
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .limit(200),
        supabase.from("bafo_requests").select("*").order("created_at", { ascending: false }).limit(200),
      ]);
      if (recs.error) throw recs.error;
      if (bafos.error) throw bafos.error;
      const bafoRows = (bafos.data ?? []) as unknown as BafoRowIn[];
      const oppIds = [...new Set(bafoRows.map((b) => b.opportunity_id).filter(Boolean) as string[])];
      const names = new Map<string, string | null>();
      if (oppIds.length) {
        const { data: opps } = await supabase.from("opportunities").select("id, project_name").in("id", oppIds);
        for (const o of opps ?? []) names.set(o.id, o.project_name);
      }
      return approveItems([
        ...((recs.data ?? []) as unknown as RecordApprovalRowIn[]).map(fromRecordApproval),
        ...bafoRows.map((b) => fromBafo(b, b.opportunity_id ? names.get(b.opportunity_id) : null)),
      ]);
    },
  });
  const decisions = approveQ.data ?? [];

  const stateOf = (q: { isLoading: boolean; isError: boolean }) =>
    q.isLoading ? "loading" : q.isError ? "error" : "ready";
  const connectOutlook = (
    <Link to="/settings" className="font-medium text-foreground underline underline-offset-2">
      {ar ? "اربط Outlook" : "Connect Outlook"}
    </Link>
  );

  return (
    <section aria-labelledby="manager-actions-title" className="space-y-3">
      <h2 id="manager-actions-title" className="text-xl font-semibold">
        {ar ? "إجراءات اليوم" : "Today's actions"}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {/* Call */}
        <ActionCard
          icon={<Phone className="h-4 w-4" aria-hidden="true" />}
          title={ar ? "اتصال" : "Call"}
          count={calls.length}
          state={loading ? "loading" : "ready"}
          empty={ar ? "لا مشاريع مهمة بلا تواصل" : "No quiet priority deals"}
          footer={<ViewAll to="/action-center" label={viewAll} />}
        >
          {calls.slice(0, SHOWN).map((c) => (
            <div key={c.opportunityId} className="space-y-1">
              <Link to="/opportunities/$id" params={{ id: c.opportunityId }} className="block truncate font-medium hover:underline">
                {c.projectName}
              </Link>
              <p className="truncate text-xs text-muted-foreground">
                {c.contactName ?? (ar ? "لا جهة اتصال مسجلة" : "No contact recorded")} ·{" "}
                {c.quietDays === null
                  ? ar
                    ? `بلا تواصل منذ ${formatNumber(ACTIVITY_WINDOW_DAYS, lang)}+ يومًا`
                    : `quiet ${formatNumber(ACTIVITY_WINDOW_DAYS, lang)}+ days`
                  : ar
                    ? `بلا تواصل منذ ${formatNumber(c.quietDays, lang)} يومًا`
                    : `quiet ${formatNumber(c.quietDays, lang)} days`}
              </p>
              <div className="flex items-center gap-2 text-xs">
                {c.phone ? (
                  <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="num underline underline-offset-2" dir="ltr">
                    {c.phone}
                  </a>
                ) : null}
                <button type="button" onClick={() => setCallFor(c)} className="rounded-md border border-border px-2 py-0.5 hover:text-foreground">
                  {ar ? "سجّل المكالمة" : "Log call"}
                </button>
              </div>
            </div>
          ))}
        </ActionCard>

        {/* Meetings */}
        <ActionCard
          icon={<CalendarDays className="h-4 w-4" aria-hidden="true" />}
          title={ar ? "اجتماعات" : "Meetings"}
          count={connected ? (meetingsQ.data?.events.length ?? 0) : null}
          state={stateOf(meetingsQ)}
          onRetry={() => void meetingsQ.refetch()}
          empty={ar ? "لا اجتماعات اليوم أو غدًا" : "No meetings today or tomorrow"}
          footer={
            connected ? (
              <a href={OUTLOOK_CALENDAR} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                {ar ? "تقويم Outlook" : "Outlook calendar"} <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            ) : (
              connectOutlook
            )
          }
        >
          {connected ? (
            (meetingsQ.data?.events ?? []).slice(0, SHOWN).map((e) => {
              const day = meetingDay(e.start, today);
              const when = `${day === "today" ? (ar ? "اليوم" : "Today") : ar ? "غدًا" : "Tomorrow"} ${e.start.slice(11, 16)}`;
              const subject = e.subject || (ar ? "(بلا عنوان)" : "(no subject)");
              return (
                <div key={e.id} className="min-w-0">
                  <p className="num text-xs text-muted-foreground" data-tabular="true">{when}</p>
                  {e.webLink ? (
                    <a href={e.webLink} target="_blank" rel="noreferrer" className="block truncate font-medium hover:underline">{subject}</a>
                  ) : (
                    <p className="truncate font-medium">{subject}</p>
                  )}
                  {e.location ? <p className="truncate text-xs text-muted-foreground">{e.location}</p> : null}
                </div>
              );
            })
          ) : (
            <p className="text-muted-foreground">
              {meetingsQ.data?.reconnect
                ? ar ? "انتهى ربط Outlook — أعد الربط من الإعدادات." : "Your Outlook sign-in expired — reconnect in Settings."
                : ar ? "اربط Outlook لترى اجتماعاتك هنا." : "Connect Outlook to see your meetings here."}
            </p>
          )}
        </ActionCard>

        {/* Email */}
        <ActionCard
          icon={<Mail className="h-4 w-4" aria-hidden="true" />}
          title={ar ? "البريد" : "Email"}
          count={briefToday ? briefItems.length : null}
          state={stateOf(briefQ)}
          onRetry={() => void briefQ.refetch()}
          empty={ar ? "لا بريد عملاء يحتاجك اليوم" : "No client email needs you today"}
          footer={connected ? <ViewAll to="/my-workspace" label={viewAll} /> : connectOutlook}
        >
          {briefToday ? (
            briefItems.slice(0, SHOWN).map((i) => (
              <Link key={i.activity_id} to="/my-workspace" className="block min-w-0 hover:underline">
                <p className="truncate font-medium">{i.line1}</p>
                <p className="truncate text-xs text-muted-foreground">{i.line2}</p>
              </Link>
            ))
          ) : (
            <p className="text-muted-foreground">
              {ar ? "افتح مساحتي لتجهيز بريد اليوم." : "Open My Workspace to prepare today's email."}
            </p>
          )}
        </ActionCard>

        {/* Follow up with the team */}
        <ActionCard
          icon={<Users className="h-4 w-4" aria-hidden="true" />}
          title={ar ? "متابعة الفريق" : "Follow up with the team"}
          count={team.length}
          state={stateOf(teamQ)}
          onRetry={() => void teamQ.refetch()}
          empty={ar ? "الفريق على المسار اليوم" : "The team is on track today"}
          footer={<ViewAll to="/my-workspace" label={viewAll} />}
        >
          {team.slice(0, SHOWN).map((r) => (
            <div key={r.user_id} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{r.full_name ?? "—"}</p>
                <p className="text-xs text-muted-foreground">
                  {r.overdue > 0
                    ? ar ? `${formatNumber(r.overdue, lang)} متأخرة` : `${formatNumber(r.overdue, lang)} overdue`
                    : ar ? `${formatNumber(r.open_due, lang)} مستحقة · لم يُنجز شيء` : `${formatNumber(r.open_due, lang)} due · none done`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTaskFor({ id: r.user_id, name: r.full_name ?? "" })}
                className="shrink-0 rounded-md border border-border px-2 py-0.5 text-xs hover:text-foreground"
              >
                {ar ? "أعطه مهمة" : "Give a task"}
              </button>
            </div>
          ))}
        </ActionCard>

        {/* Approve */}
        <ActionCard
          icon={<CheckSquare className="h-4 w-4" aria-hidden="true" />}
          title={ar ? "اعتماد" : "Approve"}
          count={decisions.length}
          state={stateOf(approveQ)}
          onRetry={() => void approveQ.refetch()}
          empty={ar ? "لا قرارات بانتظارك" : "No decisions waiting for you"}
          footer={<ViewAll to="/approvals" label={ar ? "قرارات المدير" : "Manager decisions"} />}
        >
          {decisions.slice(0, SHOWN).map((a) => {
            const days = ageDays(a.submittedAt);
            return (
              <Link key={`${a.kind}-${a.id}`} to="/approvals" className="block min-w-0 hover:underline">
                <p className="truncate font-medium">{approvalTypeLabel(a.approvalType, lang)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {a.entityLabel ?? "—"}
                  {days !== null ? ` · ${ar ? `منذ ${formatNumber(days, lang)} يوم` : `${formatNumber(days, lang)}d waiting`}` : ""}
                </p>
              </Link>
            );
          })}
        </ActionCard>
      </div>

      <ActionDialog
        open={callFor !== null}
        onOpenChange={(o) => !o && setCallFor(null)}
        title={ar ? `تسجيل مكالمة — ${callFor?.projectName ?? ""}` : `Log call — ${callFor?.projectName ?? ""}`}
        submitLabel={ar ? "حفظ" : "Save"}
        fields={[{ key: "summary", type: "text", label: ar ? "ما الذي اتُّفق عليه؟" : "What was agreed?" }] satisfies DialogField[]}
        onSubmit={async (v) => {
          if (!callFor) return;
          try {
            await logActivity({ type: "call", summary: v.summary || undefined, opportunityId: callFor.opportunityId });
            toast.success(ar ? "سُجّلت المكالمة" : "Call logged");
            await qc.invalidateQueries({ queryKey: ["cc-core"] });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
            throw e;
          }
        }}
      />

      <ActionDialog
        open={taskFor !== null}
        onOpenChange={(o) => !o && setTaskFor(null)}
        title={ar ? `مهمة لـ ${taskFor?.name ?? ""}` : `Task for ${taskFor?.name ?? ""}`}
        submitLabel={ar ? "إسناد" : "Assign"}
        fields={
          [
            { key: "title", type: "text", label: ar ? "المهمة" : "Task", required: true },
            { key: "dueDate", type: "date", label: ar ? "تاريخ الاستحقاق" : "Due date" },
          ] satisfies DialogField[]
        }
        onSubmit={async (v) => {
          if (!taskFor) return;
          try {
            await createTask({ title: v.title, dueDate: v.dueDate || null, ownerId: taskFor.id });
            toast.success(ar ? "أُسندت المهمة" : "Task assigned");
            await qc.invalidateQueries({ queryKey: ["manager-team", today] });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
            throw e;
          }
        }}
      />
    </section>
  );
}
```

- [ ] **Step 2: Check the names this file assumes**

Run:
```bash
grep -n "export function ActionDialog\|export type DialogField\|type: \"text\"\|\"date\"" src/components/phc/ActionDialog.tsx | head
grep -n "opportunity_id" src/lib/approvals-center.ts | head -3
grep -n "path: \"/opportunities/\$id\"\|createFileRoute(\"/_authenticated/opportunities/\$id\")" src/routes/_authenticated/opportunities.\$id.tsx
grep -n "export async function getLatestAgentOutput" -A3 src/lib/ai-review-actions.ts
```
Expected: `ActionDialog` takes `open`, `onOpenChange`, `title`, `submitLabel`, `fields` and `onSubmit` (the same props `CommunicationActions.tsx` passes), and `DialogField` supports `text` and `date`. `BafoRowIn` has `opportunity_id`. The route `/opportunities/$id` exists. If any prop or name differs, change the component to match the source; don't change the shared component.

- [ ] **Step 3: Typecheck and lint**

Run: `bun run typecheck && bunx eslint src/components/phc/ManagerActions.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/phc/ManagerActions.tsx
git commit -m "feat(home): the five action cards component

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Mount the strip on /command-center

**Files:**
- Modify: `src/routes/_authenticated/command-center.tsx`

Match the snippets below by text, not by line number: #349 and #351 may have shifted lines.

- [ ] **Step 1: Fetch the stakeholder phone and order**

```ts
// before
const STAKEHOLDER_COLS = "id, opportunity_id, name, role, organization, last_interaction_at";
// after
const STAKEHOLDER_COLS = "id, opportunity_id, name, role, organization, last_interaction_at, phone, contact_order";
```

- [ ] **Step 2: Mount the component.** Add the import next to the other `@/components/phc` imports:

```ts
import { ManagerActions } from "@/components/phc/ManagerActions";
```

Directly after the closing `/>` of `<PageHeader … />` and before the `<div className="flex flex-wrap items-center justify-between gap-3 border-y …">` section nav, insert:

```tsx
      <ManagerActions
        attention={attention}
        stakeholdersByOpp={stakeholdersByOpp}
        loading={isLoading}
      />
```

- [ ] **Step 3: Remove the old "Decisions awaiting approval" strip.** The Approve card replaces it. Delete the whole `<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-5 py-4">` block that contains `"قرارات بانتظار الاعتماد" : "Decisions awaiting approval"` and the `nav({ to: "/approvals" })` button.

- [ ] **Step 4: Remove the now-unused approvals query** in `cc-core`:
  - In `const [opps, followUps, approvals, activities, rfqs, quotations, transitions, stakeholders] =` remove `approvals, `.
  - Delete the line `supabase.from("approvals").select("*").eq("status", "pending"),`.
  - Replace
    ```ts
    for (const result of [approvals, activities]) {
      if (result.error) throw result.error;
    }
    ```
    with
    ```ts
    if (activities.error) throw activities.error;
    ```
  - Delete `approvals: approvals.data ?? [],` from the returned object and `const approvals = data?.approvals ?? [];`.

  Then run `grep -n "approvals" src/routes/_authenticated/command-center.tsx`. Expected: no remaining use of an `approvals` variable (comments are fine).

- [ ] **Step 5: Verify**

Run: `bun run verify 2>&1 | tail -15`
Expected: typecheck, lint, tests and build all pass.

- [ ] **Step 6: Look at it in the browser.** Start the dev server with the preview tool (`.claude/launch.json`; add a `bun run dev` entry on port 8080 if none exists). Sign in as a manager on the dev Supabase and open `/command-center`. Check:
  - Five cards at desktop width; two columns at 768px; one column at 375px with no horizontal scroll.
  - Arabic (RTL): the card order mirrors, the arrows point the right way, and all digits are Western.
  - Without Outlook connected, the Meetings and Email cards show "Connect Outlook".
  - Log call opens the dialog. Saving it adds a `call` activity, and after a refetch the deal leaves the Call card.

  Take a screenshot of each language for the PR.

- [ ] **Step 7: Commit**

```bash
git add src/routes/_authenticated/command-center.tsx .claude/launch.json
git commit -m "feat(home): five action cards at the top of the command center

Replaces the 'Decisions awaiting approval' strip; the Approve card now shows
manager decisions only.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Docs in the same PR

**Files:**
- Modify: `docs/USER_GUIDE.md`, `docs/CHANGELOG.md`, `docs/AI_HANDOFF.md`, `tasks/current.md`

- [ ] **Step 1: USER_GUIDE, section 7 "Home".** In the `/command-center` table row, insert this sentence right after `Org-wide executive view.`:

```
It now opens with **Today's actions** — five cards: **Call** (top-priority deals — at risk, stalled or closing soon — with no client contact for 14 days or more, with the contact's number and a **Log call** button), **Meetings** (your Outlook meetings today and tomorrow; connect Outlook in Settings first), **Email** (today's client emails from My daily assistant), **Follow up with the team** (reps with overdue work or nothing done yet today, with **Give a task**) and **Approve** (manager decisions waiting for you, oldest first). Each card shows its count and the top three; **View all** opens the full list.
```

- [ ] **Step 2: USER_GUIDE, section 8.** Replace steps 1–2 of "Sales Manager — مدير المبيعات" with:

```
1. Open **Command Center** and start with **Today's actions** — the five cards are your day: call, meet, answer email, chase the team, decide.
2. Clear **Approve** first — your team is blocked behind it.
```
and replace step 1 of "General Manager / Managing Director" with:
```
1. **Command Center** — **Today's actions** first, then target, pipeline, what needs a decision.
```

- [ ] **Step 3: USER_GUIDE, section 10.** Add this as the first subsection under `## 10. Current limitations`:

```
### Today's actions on the Command Center (2026-10-20)

- **Call** counts client contact from the last 30 days only; a deal with older contact shows "quiet 30+ days".
  A deal with no stakeholder shows "No contact recorded" — add one on the deal page.
- **Meetings** reads your own Outlook calendar and changes nothing in it. Private and cancelled meetings are not shown.
- **Email** shows the brief My daily assistant made today. If it has not been made yet, open My Workspace once.
- **Follow up with the team** shows counts only; a rep's task titles stay with the rep.
```

Then update the footer line at the end of the file:
```
<!-- last reviewed 2026-10-20 · Today's actions: five cards on the Command Center · previous: Connect Outlook, 2026-09-29 -->
```

- [ ] **Step 4: CHANGELOG** (new top entry under the title)

```
## 2026-10-20 — Today's actions on the Command Center (group 3, part A; not deployed)

- `src/lib/manager-actions.ts` (+ tests): Call (at risk / stalled / closing soon, quiet ≥ 14 days, ranked by attention score;
  contact = decision maker with a phone, else anyone with a phone), Team (overdue, or due and none done), Approve
  (`isManagerDecision`, oldest first), meeting day label.
- `sales-os-api` action `outlook_calendar_upcoming`: the caller's own calendarView, now → end of tomorrow (Riyadh),
  cancelled/private dropped, read-only (`calendarWindow`, `toCalendarEvents`, `calendarView`).
- `ManagerActions` strip at the top of `/command-center`; replaces the "Decisions awaiting approval" strip and its query.
  The stakeholder read now includes `phone, contact_order`.
- No migration. Release: deploy `sales-os-api`, then the UI.
```

- [ ] **Step 5: AI_HANDOFF** (new top entry)

```
## 2026-10-20 — Manager feedback group 3, part A: Today's actions (branch `feat/manager-actions`)

Spec `docs/superpowers/specs/2026-10-19-manager-actions-info-mail-design.md`, plan
`docs/superpowers/plans/2026-10-19-manager-actions.md`. Stacked on #349 (needs `isManagerDecision`).
Five cards on `/command-center`; one new read-only `sales-os-api` action (`outlook_calendar_upcoming`).
Release: `sales-os-api` deploy (approval-gated) before the UI. Part B (info@ mailbox) follows in its own PR.
The phc-sa.com "Staff login" link is a separate task in the website repo.
```

- [ ] **Step 6: tasks/current.md** (new top item)

```
## بند فعّال — ملاحظات المدير، المجموعة 3، الجزء أ: إجراءات اليوم في مركز القيادة (2026-10-20)

الفرع `feat/manager-actions` (فوق #349). خمس بطاقات: اتصال، اجتماعات، البريد، متابعة الفريق، اعتماد. المتبقي: CI، نشر `sales-os-api` بموافقة، كناري، إنتاج. الجزء ب (بريد info@) في PR مستقل.
```

- [ ] **Step 7: Check the digit rule and commit**

Run: `bun test src/lib/arabic-digits.test.ts`
Expected: PASS. (All new text, docs included, uses Western digits.)

```bash
git add docs/USER_GUIDE.md docs/CHANGELOG.md docs/AI_HANDOFF.md tasks/current.md
git commit -m "docs: Today's actions on the Command Center

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Push and open the PR (stacked on #349)

- [ ] **Step 1: Final verification**

Run: `bun run verify 2>&1 | tail -5 && bun run test:deno 2>&1 | tail -3`
Expected: all green.

- [ ] **Step 2: Push as mophc-sa**

```bash
gh auth switch -u mophc-sa
git -c credential.helper= -c credential.helper='!gh auth git-credential' push -u origin feat/manager-actions
```

- [ ] **Step 3: Open the PR.** Use base `fix/manager-feedback-oct20` while #349 is open, otherwise `main`:

```bash
gh pr create --repo mophc-sa/phc-command-center --base fix/manager-feedback-oct20 --head feat/manager-actions \
  --title "Today's actions: five manager cards on the Command Center (group 3, part A)" \
  --body "$(cat <<'EOF'
Manager feedback 2026-10-19, group 3 ★: a home page that steers the manager to the top five actions.

- Five cards at the top of /command-center: Call, Meetings, Email, Follow up with the team, Approve.
- Approve shows manager decisions only (stacked on #349's split).
- One new read-only backend action, `outlook_calendar_upcoming` (the caller's own calendar).
- Replaces the old "Decisions awaiting approval" strip.
- USER_GUIDE updated (sections 7, 8 and 10).

Release: deploy `sales-os-api` (approval-gated), then the UI. No migration.
Stacked on #349: retarget to main once #349 merges.

Screenshots: (attach the EN and AR screenshots from Task 4 Step 6)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh auth switch -u moalagab
```

- [ ] **Step 4:** Bind the PR with the ccd_pr tools (`get_status`, then `bind_pr` if needed) and read its CI.
