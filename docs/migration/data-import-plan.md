# Data import plan — old backend → PHC AGENT (`lrfdtoexyeghrzynapyn`)

Status: **planning only, nothing executed.** This plan is built from the live
schema of PHC AGENT (queried read-only on 2026-07-09) — 52 tables, full FK
graph, and a confirmed clean slate (0 rows everywhere except 1 pre-existing
`auth.users` row: `moalagab@phc-sa.com`, already `system_admin` per
`docs/security/phase-b-checklist.md`).

---

## 0. Inspection findings — 2026-07-09

**`PHC Command Center.zip` is a source-code export, not a data export.**
Extracted (read-only, git-ignored) to
`exports-inspected/lovable-export-2026-07-09/` — 246 files, 0 CSV/JSON/SQL
*data* files. Breakdown: 104 `.tsx`, 75 `.ts`, 36 `.sql` (all schema
migrations — DDL, no `INSERT`-of-real-rows beyond one clearly-labelled
fictional seed file), 13 `.json` (all config or Lovable asset-pointer
metadata for fonts/logos — zero business-data rows), plus lockfile/config/CI
files. **There is nothing to import from this archive.**

Notable finds inside it:

- **`docs/migration/MIGRATION_RUNBOOK.md`** — the canonical runbook this
  whole migration was based on (explains the original `export NEW_REF=...` /
  `scripts/migrate.sh` command from the start of this process). Section 5.1
  confirms the *actual* data export step is separate and hasn't been done
  yet: **Lovable product → Cloud → Advanced settings → Export data** (CSV
  per table). That's the file we still need.
- **`supabase/seed.sql`** — explicitly labelled `OPTIONAL demo seed ...
  NOT a migration; never run on live data ... all values, contacts and
  statuses here are fictional placeholders` (King Salman Park, Diriyah Gate,
  etc. are sample/demo opportunities, not real PHC pipeline data). Confirmed
  fictional — excluded from the import entirely.
- **`.env` in the export** confirms `xpoduufwoklvsbuhywsv` — the ref we've
  seen throughout this session in our repo's committed `.env` — **is indeed
  the Lovable-managed project's own ref**, i.e. "the old backend." This
  settles the open question from earlier in the session.
- **2 migrations we don't have yet**, present in the export but not in our
  repo/PHC AGENT:
  - `20260708180230_cca18789-...sql` — content-identical (byte-for-byte
    DDL) to our already-applied `20260708140000_data_import_readiness.sql`.
    Redundant, not a gap.
  - `20260708181941_a0420790-...sql` — analyzer-output columns for
    `import_batches`/`import_rows`/`import_mappings` (`structure_confidence`,
    `confidence_score`, `needs_review`, `review_status`, `mapping_source`,
    etc.) plus 2 `CHECK` constraints and 1 index. Confirmed genuinely missing
    from both the repo and the live PHC AGENT schema (0/13 columns, 0/3
    constraints, 0/1 index present pre-check) — **copied into
    `supabase/migrations/` and pushed on 2026-07-09.** Verified post-push: all
    13 columns, 3 constraints, and the index exist with correct types/
    defaults; `import_batches`/`import_rows`/`import_mappings` still have 0
    rows (schema-only change, no data touched). This is no longer a gap.
  - The export's migration folder also still contains all 5 files we
    identified and archived as schema-export duplicates
    (`174258`/`174816`/`174904`/`115716`/`120000`) — independent
    confirmation that our archival decisions were correct; Lovable's own
    export has the same duplication.

**Net effect on this plan:** sections 1–2 below stay `[PENDING]` — the real
CSV/data archive has not been provided yet. Sections 3–10 (schema-derived:
import order, exclusions, FK risks, auth approach, storage approach,
verification, rollback) remain valid as-is and are now cross-checked against
the project's own runbook (section 5.2 of `MIGRATION_RUNBOOK.md` gives an
equivalent tier order, validating the FK-graph-derived order below).

**Direct answers to this inspection's checklist, given the archive contains
no data:**

| Question | Answer |
|---|---|
| Format detected | Source code (TS/TSX/SQL/config), not CSV/JSON/SQL data |
| Table names matching PHC AGENT schema | N/A — no per-table data files exist to match |
| Exported tables absent from new schema | N/A |
| New-schema tables with no export file | N/A (would be all 52 — nothing was exported as data) |
| Are PKs UUIDs | Yes, confirmed on the live PHC AGENT schema (`gen_random_uuid()` default on every table's `id`) — this is about the *target*, not this archive |
| Can old IDs be preserved | Unknown until the real data export arrives with the old system's ID format |
| Is `old_id → new_uuid` mapping needed | Almost certainly yes (see section 5) — standard for any non-UUID or foreign-UUID-scheme source |
| Auth/users data present | No — this archive has no `auth.users` rows; see section 6 for the reinvite approach regardless |
| Storage files/metadata present | No binary files and no `storage.objects` metadata in this archive; asset `.json` files present are Lovable's own dev-asset pointers (fonts/logo), unrelated to business-record attachments |

## 1. List of exported tables/files
`[PENDING — this zip contained no data files, see section 0]`. Once the real
CSV export (Lovable → Cloud → Advanced settings → Export data) is provided,
fill in: file name, format, and which PHC AGENT table it maps to, using the
table inventory in section 3 as the checklist.

## 2. Row count per table
`[PENDING — no data files found in this archive, see section 0]`. Fill in
once the real export arrives, and compare against the post-import count in
section 9.

## 3. Recommended import order (topological, by FK dependency)

Derived from the live FK graph (queried directly, not guessed from migration
files). Each tier must fully load before the next starts.

**Tier 0 — no dependencies**
`companies`, `vendors`, `reference_projects`, `protenders_imports`,
`knowledge_chunks`

**Tier 0.5 — identity (see section 6, not a bulk-file import)**
`profiles`, `user_roles` — both FK to `auth.users`

**Tier 1 — depends on Tier 0**
`contacts` (→ companies), `projects` (→ companies ×3: `consultant_id`,
`main_contractor_id`, `owner_company_id`), `protenders_projects` (→
protenders_imports)

**Tier 2 — depends on Tier 1**
`opportunities` (→ companies, companies[main_contractor], projects)

**Tier 3 — depends on opportunities (Tier 2)**
`leads`, `boqs`, `approvals`, `artifacts`, `evidence_sources`, `follow_ups`,
`stakeholders`, `tasks`, `activities` (→ companies, contacts, opportunities),
`boq_extractions`, `operations_handovers`, `rfqs` (→ opportunities,
companies, contacts, projects, approvals-nullable), `tenders` (→
opportunities-nullable, companies, projects, approvals-nullable)

**Tier 4 — depends on Tier 3**
`boq_items` (→ boqs), `quotations` (→ boqs, opportunities),
`extracted_boq_items` (→ boq_extractions), `tender_contractors` (→ tenders,
companies), `recommendations` (→ companies, leads, opportunities)

**Note — soft circularity:** `leads.converted_opportunity_id`,
`tenders.converted_opportunity_id`, and the `below_300k_exception_approval_id`
columns on `rfqs`/`tenders` point *forward* to records created later in the
same conversion workflow. Import these as `NULL` in the first pass, then run
a single backfill `UPDATE` pass after Tier 4 completes, using the old
system's ID → new UUID mapping table (see section 5).

## 4. Tables that should NOT be imported directly

| Table(s) | Why |
|---|---|
| `audit_log` | Append-only, trigger-enforced (`audit_log_no_update`/`_no_delete`). Backfilling fake historical entries would misrepresent who did what. If the old system's audit trail has real value, export it separately as a read-only archive file, not into this table. |
| `agent_runs`, `ai_agent_runs`, `ai_recommendations`, `ai_evidence_items`, `ai_agent_feedback`, `lead_scores`, `duplicate_groups`, `duplicate_group_members`, `snapshot_versions` | AI-agent output tables. These should be *regenerated* by running the PHC agents against the freshly-imported real data, not migrated — old AI outputs reference old-system IDs and old-system context that won't mean anything here. |
| `import_batches`, `import_files`, `import_mappings`, `import_rows`, `import_errors`, `import_duplicate_candidates`, `import_approval_queue`, `import_record_links` | This *is* the Data Import Center's own working machinery (the `import-pipeline` edge function writes here). These tables are the **mechanism**, not an import target — see the two-path decision in section 8. |
| `stage_transition_history` | Populated by application/trigger logic tracking real stage changes going forward; backfilling synthetic history is not recommended unless the old system's stage-change log is itself considered authoritative record-keeping worth preserving verbatim. |
| `opportunity_flags`, `award_evidence` | Not yet inspected in this session — schema/purpose unconfirmed. Flag for inspection before deciding; do not assume they're safe bulk-import targets. |
| `sales_targets` | Per-person quota data tied to `auth.users` identity. Small dataset, better entered manually (or via a small dedicated script) *after* the auth/user migration in section 6 is complete, so `user_id` values are correct from the start. |

## 5. Foreign key dependency risks

- **UUID vs old-system IDs:** every PK in PHC AGENT is a `uuid` (`gen_random_uuid()`). The old system's IDs (likely integers or a different UUID scheme) will not carry over as-is. **Required:** build an `old_id → new_uuid` mapping table (temp staging table, e.g. `_migration_id_map(old_table text, old_id text, new_id uuid)`) populated as each Tier loads, so later tiers can resolve FK columns correctly. Drop this mapping table after the import is verified — it is not part of the application schema.
- **`companies` self-references via `opportunities`/`projects`:** `opportunities.main_contractor_id` and `projects.consultant_id`/`main_contractor_id`/`owner_company_id` all point back into `companies`. If the old export has a contractor/consultant that isn't also a full "company" record, it must still get a `companies` row first (even a minimal one) before the referencing table loads.
- **Nullable forward-references** (`leads.converted_opportunity_id`, `tenders.converted_opportunity_id`, `*.below_300k_exception_approval_id`): load `NULL` first, backfill after, per section 3.
- **`import_duplicate_candidates.existing_record_id`** is a bare `uuid` with **no FK constraint** (it's polymorphic — `existing_table` names which table it points into). Not relevant to a fresh bulk import, but worth knowing if the import pipeline itself is used (section 8, path B).
- **Row-level check constraints:** several tables enforce enum-like `CHECK (status IN (...))` constraints (e.g. `import_batches.status`, `opportunities.stage` via the `opportunity_stage` enum). The old system's status/stage values must be mapped to these exact enum labels before insert — a raw copy of mismatched status strings will fail the whole batch.

## 6. Auth/users migration approach

**Password hashes are not available from the old export, so direct `auth.users` row copying is not possible/safe.** Supabase's `auth.users.encrypted_password` uses Supabase's own bcrypt configuration; even if you had a hash from another system, cross-provider hash reuse is unreliable and not supported by GoTrue.

Recommended approach — **reinvite + relink**:
1. For each real person who needs an account (per `docs/security/phase-b-checklist.md`, 6 more beyond `moalagab`: `mbassem`, `ahmad`, `omar`, `marie`, `a.jarrah`, `fisal` @phc-sa.com), invite them via Supabase Auth (`supabase.auth.admin.inviteUserByEmail` or the dashboard) — this creates a real `auth.users` row with a secure invite-link flow, no password ever transits through you or this migration.
2. The existing `handle_new_user()` trigger (in `20260701193202_...sql`) auto-creates a matching `public.profiles` row and a default `viewer` role on signup — no manual profile insert needed for new users.
3. Immediately after each invite accepts, run the role assignment from `phase-b-checklist.md` step 2 (insert the correct `user_roles` row per person) and, once all 7 accounts exist, do the `moalagab` role cleanup in step 3 of that checklist.
4. **Relink historical ownership:** any `owner_id`/`created_by`/`requested_by`/`assigned_approver`/`approved_by` column in the imported data that referenced an old-system user must be mapped old-user → new-`auth.users`.id using an email-address match (the one stable identifier across both systems), via the same `_migration_id_map` approach as section 5. Where the old owner has no corresponding new account (e.g. a departed employee), leave the column `NULL` or reassign to a manager — decide per-column, don't silently drop rows.
5. Do not attempt to set `auth.users.id` manually or copy `encrypted_password` — both are managed exclusively by GoTrue and doing so risks locking accounts out or corrupting the auth schema.

## 7. Storage files migration approach (if applicable)

If the old export includes attached files (BOQ PDFs, quotation PDFs, project images, CSV/XLSX source files):
1. Files for `attachments` bucket (BOQ/quotation/contract files) and `imports` bucket (CSV/XLSX raw import files) need to be re-uploaded via the Storage API (`supabase.storage.from('attachments').upload(path, file)`) using **the service role**, not copied at the filesystem/DB level — Supabase Storage objects live outside Postgres proper (`storage.objects` only holds metadata + a pointer to the actual blob).
2. Preserve a stable `storage_path` convention that matches what the RLS policies expect (e.g. `imports` bucket policies key off `split_part(storage.objects.name, '/', 1) = batch_id`, per `20260708092659_...sql`) — re-derive paths per-table's existing convention rather than reusing old-system paths verbatim.
2b. For `attachments`, no such path-based RLS exists yet (policies are role-based only, not path-scoped) — any authenticated user can currently read the whole bucket. Flag this if the old system had per-record file access restrictions that need to be preserved.
3. Update the relevant metadata columns (`boqs.file_url`, `quotations.pdf_url`, `import_files.storage_path`) to point at the new object path *after* upload succeeds, in the same transaction/step as the row insert for that table where possible.
4. `[PENDING EXPORT]` — confirm whether the old export actually includes binary files or just references/URLs to them (affects whether this step is needed at all).

## 8. SQL/CLI import commands — prepared, not run

Two viable paths; recommend deciding after seeing the actual export format:

**Path A — direct SQL load (faster, for clean/trusted data)**
```
supabase db query --linked -f path/to/prepared_insert_tier0.sql
supabase db query --linked -f path/to/prepared_insert_tier1.sql
... (one file per tier, in order)
```
Each file wraps its INSERTs in a single transaction and validates row counts
against the source before commit. Requires the data to already be
cleaned/mapped (old IDs resolved via `_migration_id_map`) before generating
these files.

**Path B — through the built-in Data Import Center (safer, has dedup/audit)**
Use the already-deployed `import-pipeline` edge function + `import_batches`/
`import_rows` staging tables as designed: upload → map columns → validate →
duplicate review → approve → commit. Slower and only covers whatever entities
the Data Import Center currently supports (per `20260708083821`/`092659`/
`140000`, this is scoped to `companies`-style staging today — confirm
against section 1 whether all your exported entities are supported before
choosing this path for everything).

Neither path will be run until you approve after reviewing the actual export.

## 9. Verification queries after import

```sql
-- Row counts per table, compare against section 2's source counts
SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname='public' ORDER BY relname;

-- Orphan check: any FK column pointing at a non-existent parent row
-- (run once per FK pair from the section-3 graph, e.g.)
SELECT count(*) FROM public.opportunities o
  LEFT JOIN public.companies c ON o.company_id = c.id
  WHERE o.company_id IS NOT NULL AND c.id IS NULL;

-- Enum/status sanity: confirm no unmapped legacy status strings slipped through
SELECT DISTINCT stage FROM public.opportunities;

-- Auth relink sanity: every owner/actor column resolves to a real current user
SELECT count(*) FROM public.opportunities WHERE owner_id IS NOT NULL
  AND owner_id NOT IN (SELECT id FROM auth.users);

-- RLS smoke test: confirm imported rows are actually visible under a real role
-- (run via the app / a test JWT, not the service-role bypass)
```

## 10. Rollback/safety checklist

- [ ] Take a fresh point-in-time note of PHC AGENT's state (currently: 0 rows
      everywhere except 1 `auth.users`/`profiles`/`user_roles` row for
      `moalagab`) — this plan's baseline.
- [ ] Run the import inside explicit transactions per tier (per section 8,
      Path A) so a mid-tier failure rolls back cleanly instead of leaving a
      half-loaded tier.
- [ ] Keep the `_migration_id_map` table until verification (section 9) is
      fully signed off — needed for any corrective re-run.
- [ ] Do not run `supabase db reset` or any destructive command to "start
      over" — if a re-run is needed, delete only the specific imported rows
      (by a batch/import-tag column or the `_migration_id_map`), never a
      blanket `TRUNCATE`.
- [ ] Old backend (`xpoduufwoklvsbuhywsv` reference seen in the repo's
      committed `.env`) is never touched by this plan — export happens
      independently on your side, this plan only covers the PHC AGENT side.
- [ ] No `.env` / frontend changes until data is imported *and* verified —
      switching the app to point at PHC AGENT while it's still empty or
      partially loaded would show a blank/broken app to real users.
- [ ] Get explicit sign-off after section 9's verification queries run clean
      before considering the import "done."
