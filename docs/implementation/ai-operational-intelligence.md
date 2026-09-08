# PHC AI operational intelligence

## Delivered behavior

AI sales reports use the same canonical stages and opportunity values as the application. All rows are paginated; failed reads abort analysis. Missing values remain unknown, currencies stay separate, and the UI labels the snapshot time. Automatic request reuse includes source content and prompt/model configuration. Historical reports without canonical facts require regeneration.

Recommendation creation includes evidence atomically. Caller-authorized decisions create a real linked task or a pending commercial approval in one transaction, with repeat-click protection. The legacy acceptance route receives the same atomic treatment. AI never approves the commercial decision or sends a message.

Company knowledge is extracted from reference projects and searchable PDF, spreadsheet/CSV or plain-text documents. Each source requires approval of its exact content hash. Publication replaces only that source's chunks atomically. Retrieval uses caller RLS and rechecks the source version and document permissions; revocation or source changes hide the index immediately. Embeddings use one fixed multilingual model/vector space: text-embedding-3-small, 384 dimensions. Scanned PDFs and unsupported formats require a searchable or reviewed text copy. Source updates require extraction/review again, not silent approval.

The employee assistant refreshes its record-derived priorities every minute. It prepares meeting briefs with source excerpts, identifies RFQ/BOQ gaps without exposing restricted prices, and presents editable task/draft suggestions for review. Task approval rechecks source permissions/version and reuses an existing open task. Outbound messages are not sent.

Quality evaluation runs Arabic and English PHC cases for pipeline numbers, RFQ completeness, evidence-based abstention and reference citations. Current OpenAI configuration is compared with gpt-4.1-mini and the configured Anthropic candidate when available. Exact structured facts, reference IDs, abstention, latency, tokens and estimated known-model cost are recorded; human usefulness scores remain a separate review. These checks do not prove every prose claim is correct. Measured routing changes are limited to company knowledge as described below. No subscription upgrade.

## Validation and release

- Full local `bun run verify`: 2,698 tests passed; TypeScript, lint and build passed. Existing lint warnings remain.
- Deno runtime tests: 21 passed, including actual PDF extraction and Arabic text. Both named function entrypoints passed Deno type checking.
- Complete disposable database migration replay and behavioral checks: 995 passed, including MFA, source permission revocation, atomic decisions, repeated approvals, quotas and legacy recommendation restrictions.
- Applied migrations on PHC project `lrfdtoexyeghrzynapyn`: `20260929100000`, `20260929110000`, `20260929120000`.
- PR295 merged as `2647f7922b051ce5ed40c48fc279159d8590650b`; canary, canary readiness, production release and post-production readiness all passed (runs 34211014587 attempt 2, 34211606204, 34212163604, 34212317704).
- Named functions deployed: `ai-orchestrator` and `sales-os-api`. Follow-up UAT repairs are tracked in PR296; its frontend release requires its own canary and readiness receipts.

## Production acceptance evidence — 2026-09-08

- Independently recomputed every permitted live opportunity and matched the accepted AI report exactly. Actual production counts and amounts are retained in the private release evidence, not this public repository.
- Indexed all 45 current reference projects and the three current readable documents: one PDF quotation and two XLSX BOQs. Their 48 approved current sources contain 124 chunks. Document text approval is permission to use that version as internal evidence, not commercial approval or a correctness certification of the underlying quotation.
- Created one real self-owned follow-up task; repeated approval returned the same task. Its identity and business details are retained in the private release evidence. It remains open for the employee; no outbound message was sent.
- Live follow-up testing found and fixed confusion between opportunity and quotation states, overdue and future dates, and an unsupported claim of prior submission. Prompt v4 and grounded v4 keep record states/deadlines distinct, frame unverified submissions as questions, and reject common unsupported completion assertions in drafts.
- Company retrieval balances project and document evidence so a long BOQ does not crowd out all project references. Arabic questions receive Arabic answers. A reference year is not evidence of a completion date. A final live Arabic check exposed an unsupported completion statement despite prompt instructions; grounded v4 rejects completion claims cited only to reference metadata and returns attributed source excerpts with insufficient-evidence status, without model-proposed tasks or drafts. Arabic/English regressions cover the guard and evidence fallback.
- The configured Claude model had surrounding whitespace. Configuration is normalized without changing provider/model selection. Sonnet 4.6 uses its supported constrained JSON output; original Zod bounds remain enforced. Evaluation v2 gives every candidate the same bounded 60-second budget and records schema errors without source content or secrets. Interactive deadlines are unchanged.
- Completed all four evaluation cases in Arabic and English for all three candidates: 24 final attempts, with 12 earlier diagnostic attempts retained. All candidates passed both numerical snapshot and no-evidence abstention cases. Raw RFQ counting/field-set compliance failed for every candidate; actual operational counts therefore remain deterministic server results. Citation cases passed in both languages for gpt-4.1-mini, English only for Claude, and neither for gpt-4o-mini under the strict combined rubric.
- Full-rubric results: gpt-4.1-mini 6/8 (2.75s mean, $0.0036912 total); Claude 5/8 (9.70s, $0.079137); gpt-4o-mini 4/8 (2.07s, $0.0013224). This small dated sample is directional evidence, not a population guarantee. The UI displays overall pass/fail separately from provider completion and individual checks.
- Based on this evidence, company knowledge routes an existing OpenAI gpt-4o-mini configuration to gpt-4.1-mini; meeting drafts and other agents retain their configured model. Explicit alternative model/provider configurations are preserved. Both the route and actual model are visible and traced. The same existing API account is used; no subscription upgrade.
- Live Arabic project-name lookup cites the Misk Art Institute reference and correctly describes Riyadh, recorded signage scope and recorded year 2025. A broader Arabic question initially abstained; query wording can still affect retrieval, and unsupported parts must remain unknown. All citations remain permission-filtered.

## Interpretation and operating limits

Evidence citations and exact structured checks reduce error; they do not certify every generated prose claim. Review the displayed excerpt before approving a suggested task or using a draft. Human usefulness ratings remain distinct from automated checks and should be supplied by PHC employees; no synthetic human ratings are entered.

PDF extraction reads the text layer; embedded pictures, scans, drawings and image-only price tables require a searchable or reviewed text copy. Missing prices remain unknown. Spreadsheet extraction preserves existing cell values and does not certify formulas or commercial totals. Changed, superseded, deleted or revoked sources stop being retrievable; updated content must be extracted and approved again.

Cost estimates use actual returned tokens with standard uncached rates verified 2026-09-08: gpt-4o-mini $0.15/$0.60, gpt-4.1-mini $0.40/$1.60, Claude Sonnet 4.6 $3/$15 per million input/output tokens. Unknown usage is not shown as zero; timeouts may still have incurred provider charges. Estimates are not invoices. The base model remains gpt-4o-mini; the measured company-knowledge route uses gpt-4.1-mini. No subscription upgrade.

Official provider references: [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Claude Sonnet 4.6](https://platform.claude.com/docs/en/models/sonnet-4-6/overview).

## Rollback

Previous frontend source: `181573202587e5c43b68413c3a9981a3dd268d65`; previous functions: ai-orchestrator v28, sales-os-api v49. Retain migrations and audit data. The old knowledge handler relied on revoked broad access and the old recommendation handler violated the repaired decision boundary, so do not blindly roll back those functions against the new schema. Prefer a forward function fix; temporarily hide new controls or restore the previous Worker if needed while preserving the hardened API. No database reset, role changes, CRM cleanup or commercial record deletion is part of this release.
