# Fireflies Meetings → Reviewed Tasks — Design

Date: 2026-09-28 · Status: approved by user ("نفذ ما توصي به") · Supersedes stations 1–4 of the
2026-09-24 meetings design (artifact "آلية اجتماعات PHC").

## Why this changed from the 2026-09-24 design

The earlier design recorded audio in-app, diarized with pyannoteAI and identified speakers by
voiceprint. PHC now records meetings with Fireflies.ai, which already records, transcribes,
separates speakers, summarises and lists action items per speaker. So stations 1–4 (record,
store, transcribe, voiceprints) are dropped; stations 5–7 (analyse, human gate, distribute)
remain. Phase 0 (accuracy trial), audio retention and microphone decisions no longer apply.

Option chosen (C): **v1 uses Fireflies' own action items**; a `meeting_analyst` agent through
`ai-orchestrator` is a later phase, only if Fireflies' items prove insufficient.

## Flow

1. Fireflies finishes processing → POSTs `{meetingId, eventType, clientReferenceId}` to the new
   Edge Function `meetings-inbound`, signed with `x-hub-signature` = hex HMAC-SHA256 of the raw
   body under the shared secret.
2. `meetings-inbound` verifies the signature (constant time), fetches the transcript via the
   Fireflies GraphQL API (`FIREFLIES_API_KEY`), parses `summary.action_items`, matches speaker
   labels to active team members, and stores one `meetings` row plus its
   `meeting_action_items` rows through the service-only RPC `ingest_meeting`.
3. A pipeline operator opens **Meetings** (`/meetings`), reviews each item — edits title, owner,
   due date, opportunity — and approves or dismisses it (dismiss needs a reason).
4. Approve → `decide_meeting_action_item` creates a `tasks` row (`source='meeting_action:<id>'`,
   owner, opportunity, due date) and notifies the owner. The task then appears where tasks
   already appear: My Workspace / TodayPanel, Action Center, calendar feed, and the
   opportunity's next action.

## Decisions (recommended defaults, user may override)

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| 1 | Transport | Signed webhook, not pg_cron polling | Fireflies signs payloads; `mail-inbound` is the in-repo precedent for a `verify_jwt=false` receiver that authenticates itself. |
| 2 | Extraction | Parse Fireflies `action_items` deterministically | No extra AI cost or orchestrator service-path problem; the human gate corrects names. |
| 3 | Who sees/reviews meetings | Pipeline operators + system_admin | Matches `tasks` write RLS and `canReviewAiOutput`. Attendee-level visibility needs reliable attendee→user mapping, which Fireflies does not give for in-room meetings. |
| 4 | Approval granularity | Per item, plus "approve all ready" in the UI | One wrong name must not block the rest. |
| 5 | Unmatched speakers ("Speaker 3") | Item stays pending with no owner; approve requires an owner | Never auto-assign a guess. |
| 6 | Due date | Optional, set by the reviewer | Fireflies gives timestamps, not deadlines. |

## Data model (migration `20261001100000_fireflies_meetings.sql`)

`meetings`: `id`, `provider` ('fireflies'), `provider_meeting_id` (unique with provider — the
idempotency key), `title`, `occurred_at`, `duration_minutes`, `organizer_email`,
`participants text[]`, `summary_short`, `summary_overview`, `keywords text[]`,
`action_items_raw`, `transcript_url`, `related_opportunity_id` (nullable), `status`
('pending_review' | 'reviewed'), `created_at`, `updated_at`.

`meeting_action_items`: `id`, `meeting_id`, `position`, `speaker_label`, `title`,
`at_seconds`, `suggested_owner_id`, `owner_id`, `related_opportunity_id`, `due_date`,
`status` ('pending' | 'approved' | 'dismissed'), `task_id`, `decided_by`, `decided_at`,
`decision_note`.

- RLS on both: SELECT for `is_pipeline_operator(auth.uid()) OR has_role(auth.uid(),'system_admin')`.
  No INSERT/UPDATE/DELETE for `authenticated`; writes only via SECURITY DEFINER functions.
- `ingest_meeting(_meeting jsonb, _items jsonb)` — service_role only. `ON CONFLICT DO NOTHING`
  on `(provider, provider_meeting_id)`; returns `{ok, duplicate}`.
- `decide_meeting_action_item(_id, _action, _title, _owner_id, _due_date, _opportunity_id, _note)`
  — `approve` | `dismiss`. Row lock, replay-safe (same decision by same user returns prior
  result), requires active assignable owner for approve, reason for dismiss. Inserts task,
  writes `audit_log`, calls `emit_notification` (entity_type check extended with `'task'`),
  and flips the meeting to `reviewed` once no item is pending.
- `REVOKE UPDATE` on both tables from `authenticated`.

## Edge Function `meetings-inbound`

Sequencing only; rules in `_shared/fireflies.ts` (pure, Deno-tested):
`verifySignature(rawBody, header, secret)`, `parseActionItems(markdown)`,
`matchSpeaker(label, members)`, `toIngestPayload(transcript, members)`.

Status codes (instructions to Fireflies): 403 bad signature · 503 not configured
(secret or API key missing) · 200 ignored/duplicate/stored · 502 Fireflies API failure (retry) ·
500 database failure (retry). Logs carry outcome codes only, never meeting content.

Speaker matching: exact email → exact full name → unique first-name match among active,
non-display profiles (case/diacritic-insensitive). Anything ambiguous → no suggestion.

## Frontend

- `/meetings`: list (title, date, pending count), newest first.
- `/meetings/$id`: summary, keywords, "Open in Fireflies" link; one card per item with editable
  title, owner select (assignable members), due date, opportunity search (existing
  `command-search` helper), timestamp deep link (`?t=`), Approve / Dismiss(reason).
- Decisions go through `sales-os-api` action `meeting_action_decision` (keeps MFA gating via
  `resolveCaller`), which calls the RPC as the caller.
- Nav entry visible to the same roles; en/ar strings in `i18n.tsx`.

## Out of scope (v1)

`meeting_analyst` agent, emailing summaries to attendees, Teams/Zoom sources, attendee-level
visibility, commitments (client promises) — all later phases.

## Testing

Deno: signature (valid/invalid/missing), action-item parser on the two real 2026-09-28 samples,
speaker matching. pgTAP: RLS (non-operator sees nothing), ingest idempotency, decide rules
(approve w/o owner fails, dismiss w/o reason fails, replay, task created with source).
Contract tests for config (`verify_jwt=false`) and migration grants. `bun run verify`.

## Rollout (approval-gated per deployment-governance.md)

PR → CI → user approves `db push` → user approves deploy of `meetings-inbound` and
`sales-os-api` → user sets secrets `FIREFLIES_WEBHOOK_SECRET`, `FIREFLIES_API_KEY` and pastes
the function URL + secret in Fireflies → Developer Settings → end-to-end test with one meeting.
