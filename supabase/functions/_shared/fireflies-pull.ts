// =============================================================================
// Pulling meetings from a Fireflies account by API key.
//
// Three callers share this: the 30-minute scheduled pull in meetings-inbound
// (every connected salesperson's own key), "Connect Fireflies" in Settings
// (checks the key and fetches the last two weeks at once), and the "Fetch
// from Fireflies" button. Every meeting goes through the same ingest_meeting
// as the webhook, so a meeting seen twice is stored once.
//
// WHAT THIS FILE REFUSES TO DO
//
// - Accept another person's key. A key is only saved when the Fireflies
//   account it opens has the caller's own sign-in email (sameAccount). Without
//   that, pasting the company key would make every company meeting "yours".
//
// - Log anything about a meeting or a key. Callers log counts and outcome
//   codes only.
// =============================================================================

import {
  FIREFLIES_GRAPHQL_URL,
  type FirefliesTranscript,
  ingestableTranscripts,
  RECENT_TRANSCRIPTS_QUERY,
  type TeamMember,
  toIngestPayload,
} from "./fireflies.ts";

export const ACCOUNT_QUERY = `query Me { user { email name } }`;

/** How far back a first pull, and the button, look. */
export const WINDOW_DAYS = 14;
/** Meetings asked for per account per pull. */
export const PULL_LIMIT = 25;

type FetchFn = (input: string, init: RequestInit) => Promise<Response>;
export type PullFailure = "unauthorized" | "upstream" | "store";
export type Result<T> = { ok: true; value: T } | { ok: false; reason: PullFailure };

/** A Fireflies API key as pasted: one token, no spaces. */
export function readApiKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim();
  return /^[A-Za-z0-9._-]{16,200}$/.test(key) ? key : null;
}

/** The key opens the caller's own Fireflies account (emails compared without case). */
export function sameAccount(firefliesEmail: string | null | undefined, profileEmail: string | null | undefined): boolean {
  const a = (firefliesEmail ?? "").trim().toLowerCase();
  const b = (profileEmail ?? "").trim().toLowerCase();
  return a !== "" && a === b;
}

/**
 * Where a scheduled pull starts: a day before the last successful one (a
 * meeting can finish processing after it started), never more than two weeks
 * back, and two weeks the first time.
 */
export function pullSince(lastSyncedAt: string | null | undefined, now: number): string {
  const floor = now - WINDOW_DAYS * 86_400_000;
  const last = lastSyncedAt ? Date.parse(lastSyncedAt) : Number.NaN;
  const from = Number.isNaN(last) ? floor : Math.max(floor, last - 86_400_000);
  return new Date(from).toISOString();
}

const AUTH_ERROR = /auth|api[ _-]?key|token|forbidden|unauthori[sz]ed/i;

async function graphql(apiKey: string, query: string, variables: Record<string, unknown>, f: FetchFn): Promise<Result<Record<string, unknown>>> {
  let res: Response;
  try {
    res = await f(FIREFLIES_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    return { ok: false, reason: "upstream" };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: "unauthorized" };
  let body: { data?: Record<string, unknown> | null; errors?: Array<{ message?: string; extensions?: { code?: string } }> };
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: "upstream" };
  }
  // Fireflies answers a bad key with HTTP 200 (or 400) and an errors[] entry.
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  if (errors.some((e) => AUTH_ERROR.test(`${e?.extensions?.code ?? ""} ${e?.message ?? ""}`))) {
    return { ok: false, reason: "unauthorized" };
  }
  if (!res.ok || !body?.data) return { ok: false, reason: "upstream" };
  return { ok: true, value: body.data };
}

/** Whose Fireflies account a key opens. */
export async function firefliesAccount(apiKey: string, f: FetchFn = fetch): Promise<Result<{ email: string; name: string | null }>> {
  const r = await graphql(apiKey, ACCOUNT_QUERY, {}, f);
  if (!r.ok) return r;
  const user = r.value.user as { email?: unknown; name?: unknown } | null | undefined;
  if (!user || typeof user.email !== "string" || !user.email.trim()) return { ok: false, reason: "unauthorized" };
  return { ok: true, value: { email: user.email.trim(), name: typeof user.name === "string" ? user.name : null } };
}

/** Processed meetings since a moment, already filtered to the ones worth storing. */
export async function recentTranscripts(apiKey: string, sinceIso: string, f: FetchFn = fetch): Promise<Result<FirefliesTranscript[]>> {
  const r = await graphql(apiKey, RECENT_TRANSCRIPTS_QUERY, { from: sinceIso, limit: PULL_LIMIT }, f);
  if (!r.ok) return r;
  return { ok: true, value: ingestableTranscripts(r.value.transcripts) };
}

/** The one write a pull makes: ingest_meeting, as the service role. */
export interface MeetingStore {
  rpc(fn: "ingest_meeting", args: { _meeting: unknown; _items: unknown }): PromiseLike<{ data: unknown; error: unknown }>;
}

export type PullCounts = { found: number; added: number; already: number };

/** Store each transcript; connectedUserId marks whose own account it came from. */
export async function storeTranscripts(
  store: MeetingStore,
  list: FirefliesTranscript[],
  members: TeamMember[],
  connectedUserId: string | null,
): Promise<Result<PullCounts>> {
  let added = 0;
  let already = 0;
  for (const t of list) {
    const { meeting, items } = toIngestPayload(t, members);
    const { data, error } = await store.rpc("ingest_meeting", {
      _meeting: connectedUserId ? { ...meeting, connected_user_id: connectedUserId } : meeting,
      _items: items,
    });
    if (error) return { ok: false, reason: "store" };
    if ((data as { duplicate?: boolean } | null)?.duplicate) already++;
    else added++;
  }
  return { ok: true, value: { found: list.length, added, already } };
}

/** Fetch, then store: one account's pull. */
export async function pullAccount(
  store: MeetingStore,
  apiKey: string,
  sinceIso: string,
  members: TeamMember[],
  connectedUserId: string | null,
  f: FetchFn = fetch,
): Promise<Result<PullCounts>> {
  const listed = await recentTranscripts(apiKey, sinceIso, f);
  if (!listed.ok) return listed;
  return storeTranscripts(store, listed.value, members, connectedUserId);
}

export type Connection = { user_id: string; last_synced_at: string | null };

/** What the scheduled pull needs from the database, so it can be tested without one. */
export interface ScheduledPullDeps {
  store: MeetingStore;
  connections(): Promise<Connection[]>;
  apiKey(userId: string): Promise<string | null>;
  members(): Promise<TeamMember[]>;
  mark(userId: string, status: "active" | "needs_reconnect", error: string | null): Promise<void>;
  fetch?: FetchFn;
  now?: () => number;
  budgetMs?: number;
}

export type ScheduledPullReport = { accounts: number; pulled: number; added: number; failed: number; reconnect: number };

/**
 * Every connected account in turn, within a time budget (the next run picks up
 * whoever was skipped). A key Fireflies refuses is marked needs_reconnect —
 * the person sees it in Settings — and is not tried again until reconnected.
 */
export async function runScheduledPull(deps: ScheduledPullDeps): Promise<ScheduledPullReport> {
  const now = deps.now ?? Date.now;
  const started = now();
  const budget = deps.budgetMs ?? 45_000;
  const report: ScheduledPullReport = { accounts: 0, pulled: 0, added: 0, failed: 0, reconnect: 0 };
  const conns = await deps.connections();
  report.accounts = conns.length;
  if (conns.length === 0) return report;
  const members = await deps.members();

  for (const c of conns) {
    if (now() - started > budget) break;
    const key = await deps.apiKey(c.user_id);
    if (!key) {
      report.failed++;
      continue;
    }
    const r = await pullAccount(deps.store, key, pullSince(c.last_synced_at, now()), members, c.user_id, deps.fetch ?? fetch);
    if (r.ok) {
      report.pulled++;
      report.added += r.value.added;
      await deps.mark(c.user_id, "active", null);
    } else if (r.reason === "unauthorized") {
      report.reconnect++;
      await deps.mark(c.user_id, "needs_reconnect", "Fireflies refused the API key");
    } else {
      report.failed++;
      await deps.mark(c.user_id, "active", r.reason === "store" ? "Could not store a meeting" : "Fireflies did not answer");
    }
  }
  return report;
}
