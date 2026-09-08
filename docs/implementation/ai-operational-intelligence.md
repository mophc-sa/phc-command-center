# PHC AI operational intelligence

## Delivered behavior

AI sales reports use the same canonical stages and opportunity values as the application. All rows are paginated; failed reads abort analysis. Missing values remain unknown, currencies stay separate, and the UI labels the snapshot time. Automatic request reuse includes source content and prompt/model configuration. Historical reports without canonical facts require regeneration.

Recommendation creation includes evidence atomically. Caller-authorized decisions create a real linked task or a pending commercial approval in one transaction, with repeat-click protection. The legacy acceptance route receives the same atomic treatment. AI never approves the commercial decision or sends a message.

Company knowledge is extracted from reference projects and searchable PDF, spreadsheet/CSV or plain-text documents. Each source requires approval of its exact content hash. Publication replaces only that source's chunks atomically. Retrieval uses caller RLS and rechecks the source version and document permissions; revocation or source changes hide the index immediately. Embeddings use one fixed multilingual model/vector space: text-embedding-3-small, 384 dimensions. Scanned PDFs and unsupported formats require a searchable or reviewed text copy. Source updates require extraction/review again, not silent approval.

The employee assistant refreshes its record-derived priorities every minute. It prepares meeting briefs with source excerpts, identifies RFQ/BOQ gaps without exposing restricted prices, and presents editable task/draft suggestions for review. Task approval rechecks source permissions/version and reuses an existing open task. Outbound messages are not sent.

Quality evaluation runs Arabic and English PHC cases for pipeline numbers, RFQ completeness, evidence-based abstention and reference citations. Current OpenAI configuration is compared with gpt-4.1-mini and the configured Anthropic candidate when available. Exact structured facts, reference IDs, abstention, latency, tokens and estimated known-model cost are recorded; human usefulness scores remain a separate review. These checks do not prove every prose claim is correct. The production model is unchanged until measured results support a change. No subscription upgrade.

## Validation and release

- Full local `bun run verify`: 2,693 tests passed, TypeScript/lint/build passed (existing lint warnings remain); rerun for final release commit.
- Deno runtime tests: 20 passed, including actual PDF extraction and Arabic text.
- Database migration replay and behavioral checks: 993 passed on the initial final replay; final replay includes the additional legacy decision restrictions.
- Production schema metadata review found and fixed missing import-row header columns and restricted BOQ cost reads.
- Production project is exclusively `lrfdtoexyeghrzynapyn`.
- Pending migrations: `20260929100000`, `20260929110000`, `20260929120000`.
- Named function deployments: `ai-orchestrator`, `sales-os-api` only.
- Production indexing, live bilingual evaluation, canary/frontend release and user UAT: pending. Do not describe these as completed until release evidence is recorded.

## Rollback

Previous frontend source: `181573202587e5c43b68413c3a9981a3dd268d65`; previous functions: ai-orchestrator v28, sales-os-api v49. Retain migrations and audit data. The old knowledge handler relied on revoked broad access and the old recommendation handler violated the repaired decision boundary, so do not blindly roll back those functions against the new schema. Prefer a forward function fix; temporarily hide new controls or restore the previous Worker if needed while preserving the hardened API. No database reset, role changes, CRM cleanup or commercial record deletion is part of this release.
