// =============================================================================
// Fireflies.ai meetings — the pure core of meetings-inbound.
//
// Fireflies posts {meetingId, eventType} when a meeting is processed, signed
// with x-hub-signature = hex HMAC-SHA256 of the raw body under a shared secret.
// The function then fetches the transcript and hands it here to be turned into
// one meetings row and its action items.
//
// WHAT THIS FILE REFUSES TO DO
//
// - Trust an unsigned caller. No secret, a short secret, or a signature that
//   does not match the exact bytes received, and the request is refused.
//
// - Guess an owner. A speaker label becomes a suggested owner only on an exact
//   email, exact full name, or a first name that exactly one active person has.
//   "Speaker 3", "All Team Members", a near miss ("Mary" for "Marie") — no
//   suggestion. A reviewer names the owner before any task exists.
// =============================================================================

import { safeEqual } from "./mail-inbound.ts";
import { normalizeArabic } from "./company-normalize.ts";

export const FIREFLIES_GRAPHQL_URL = "https://api.fireflies.ai/graphql";

export const TRANSCRIPT_QUERY = `query Transcript($id: String!) {
  transcript(id: $id) {
    id title dateString duration organizer_email participants transcript_url
    summary { action_items overview short_summary keywords }
  }
}`;

/** Verify Fireflies' x-hub-signature over the raw request body. */
export async function verifySignature(
  rawBody: string,
  header: string | null,
  secret: string | undefined,
): Promise<boolean> {
  const key = (secret ?? "").trim();
  // Fireflies lets an admin pick 16–32 characters; anything shorter is not a secret.
  if (key.length < 16 || !header) return false;
  const given = header.trim().replace(/^sha256=/i, "").toLowerCase();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
  return safeEqual(given, expected);
}

/** The webhook body: only a meeting id of sane shape is accepted. */
export function readWebhook(payload: unknown): { ok: true; meetingId: string } | { ok: false; reason: string } {
  if (!payload || typeof payload !== "object") return { ok: false, reason: "not_object" };
  const p = payload as Record<string, unknown>;
  const id = typeof p.meetingId === "string" ? p.meetingId.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) return { ok: false, reason: "bad_meeting_id" };
  const event = typeof p.eventType === "string" ? p.eventType : "";
  if (event && event !== "Transcription completed") return { ok: false, reason: "other_event" };
  return { ok: true, meetingId: id };
}

export interface ParsedActionItem {
  speaker_label: string | null;
  title: string;
  at_seconds: number | null;
}

const HEADER = /^\*\*(.+?)\*\*:?$/;
const STAMP = /\s*\((?:(\d{1,2}):)?(\d{1,2}):(\d{2})\)\s*$/;
const NO_SPEAKER = new Set(["unassigned", "unknown", "none"]);

/**
 * Parse Fireflies' summary.action_items markdown:
 *
 *   **Faisal**
 *   Follow up on Sidra 345 pre-qualification (04:48)
 *
 * Header lines name the speaker; each following line is one item, with an
 * optional (mm:ss) or (h:mm:ss) timestamp. Bullets and blank lines are ignored.
 */
export function parseActionItems(markdown: string | null | undefined): ParsedActionItem[] {
  if (!markdown) return [];
  const items: ParsedActionItem[] = [];
  let speaker: string | null = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*•]\s+/, "");
    if (!line) continue;
    const h = HEADER.exec(line);
    if (h) {
      const name = h[1].trim();
      speaker = NO_SPEAKER.has(name.toLowerCase()) ? null : name.slice(0, 200);
      continue;
    }
    const s = STAMP.exec(line);
    const at = s ? Number(s[1] ?? 0) * 3600 + Number(s[2]) * 60 + Number(s[3]) : null;
    const title = (s ? line.slice(0, s.index) : line).replace(/\*\*/g, "").trim().slice(0, 500);
    if (title) items.push({ speaker_label: speaker, title, at_seconds: at });
  }
  return items;
}

export interface TeamMember {
  id: string;
  email: string | null;
  full_name: string | null;
}

const norm = (v: string) => normalizeArabic(v.toLowerCase()).normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** Resolve a speaker label to one active member, or null when not certain. */
export function matchSpeaker(label: string | null, members: TeamMember[]): string | null {
  if (!label) return null;
  const l = norm(label);
  if (!l || /^speaker \d+$/.test(l)) return null;

  const unique = (hits: TeamMember[]) => (hits.length === 1 ? hits[0].id : null);

  const byEmail = members.filter((m) => {
    const e = norm(m.email ?? "");
    return e !== "" && (e === l || e.split("@")[0] === l);
  });
  if (byEmail.length) return unique(byEmail);

  const byName = members.filter((m) => norm(m.full_name ?? "") === l);
  if (byName.length) return unique(byName);

  if (!l.includes(" ")) {
    return unique(members.filter((m) => norm(m.full_name ?? "").split(" ")[0] === l));
  }
  return null;
}

export interface FirefliesTranscript {
  id: string;
  title?: string | null;
  dateString?: string | null;
  duration?: number | null;
  organizer_email?: string | null;
  participants?: string[] | null;
  transcript_url?: string | null;
  summary?: {
    action_items?: string | null;
    overview?: string | null;
    short_summary?: string | null;
    keywords?: string[] | null;
  } | null;
}

/** Shape the transcript into the ingest_meeting(_meeting, _items) arguments. */
export function toIngestPayload(t: FirefliesTranscript, members: TeamMember[]) {
  const s = t.summary ?? {};
  const occurred = t.dateString && !Number.isNaN(Date.parse(t.dateString)) ? t.dateString : null;
  const meeting = {
    provider_meeting_id: t.id,
    title: (t.title ?? "").slice(0, 500),
    occurred_at: occurred,
    duration_minutes: typeof t.duration === "number" && Number.isFinite(t.duration) ? Math.round(t.duration * 100) / 100 : null,
    organizer_email: t.organizer_email ?? null,
    participants: (t.participants ?? []).filter((p) => typeof p === "string").slice(0, 100),
    summary_short: s.short_summary ?? null,
    summary_overview: s.overview ?? null,
    keywords: (s.keywords ?? []).filter((k) => typeof k === "string").slice(0, 50),
    action_items_raw: s.action_items ?? null,
    transcript_url: t.transcript_url ?? null,
  };
  const items = parseActionItems(s.action_items).slice(0, 200).map((i) => ({
    ...i,
    suggested_owner_id: matchSpeaker(i.speaker_label, members),
  }));
  return { meeting, items };
}
