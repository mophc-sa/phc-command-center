# PHC Agent Command Center — Build Plan (Phase 1: Sales Agent)

This is a large, multi-week internal operating system. I'll build it in ordered phases so each phase is verifiable before the next. I recommend we ship Phase 1A first (foundation + design system + auth + schema + shell), then iterate.

## Phase 1A — Foundation (this first delivery)

**Backend (Lovable Cloud / Supabase)**
- Enable Lovable Cloud.
- Auth: email/password + Google. Roles stored in a separate `user_roles` table (enum: `ceo`, `sales_manager`, `bd_manager`, `viewer`) with `has_role()` security-definer function.
- Schema (migrations):
  - `profiles`, `user_roles`
  - `opportunities` (with PHC qualification fields: signage_package_status, signage_package_confidence, package_budget_confirmed, main_contractor_confirmed, contractor_decision_maker, project_stage, prequalification_status, strategic_value, source_confidence, evidence_count, exclusion_reason, management_review_reason, tier, value ranges, owner, stage, timestamps)
  - `stakeholders`, `follow_ups`, `tasks`, `approvals`, `artifacts`, `evidence_sources`, `agent_runs`, `snapshot_versions`, `source_registry`, `audit_log`
- RLS on every table, scoped by role via `has_role()`. Viewer = read-only. BD = edit assigned. Sales Manager = assign/approve. CEO = strategic + approvals.
- Audit trigger writing to `audit_log` on approvals / assignments / status changes.
- Public-schema `GRANT`s alongside every table.

**Design system (PHC Silent Architecture, dark default)**
- Tokens in `src/styles.css` using oklch equivalents of: bg `#0E0F10`, surface `#1A1B1D`, primary-dark `#111111`, text `#FAFAFA`, muted `#8A8D91`, structural `#34363A`, warm-neutral `#E7E2D9`, amber `#B5692B`, amber-light `#D9A063`.
- Amber is a semantic "attention" token only — never default button/hero color.
- Typography: Almarai (primary) + Inter (Latin fallback) + IBM Plex Sans Arabic, loaded via `<link>` in `__root.tsx`. Tabular numerals utility.
- Reusable primitives: `MetricTile`, `PriorityItem`, `OpportunityCard`, `StatusPill`, `EvidenceRef`, `TimelineItem`, `ActionButton` (fixed vocabulary), `EmptyState`, `SectionHeader`, `AgentTile` (reusable for future department agents).
- Motion: <200ms, respects `prefers-reduced-motion`.

**Bilingual + RTL**
- i18n context (EN/AR) with `dir` on `<html>`, full layout mirroring (sidebar swap, icon mirroring, table column order). Curated Arabic strings — no machine translation.

**Shell + Navigation**
- Sidebar (mirrors in RTL): Command Center, Opportunities, Follow-ups, Discovery Inbox, Approvals, Reports, Agent Activity, Team & Permissions, Settings.
- Header: PHC mark, area label (Sales Agent), agent status pill, last-refreshed, language toggle, profile + notifications.
- Auth-gated under `_authenticated/`; `/auth` public.

**Deliverable of 1A:** logged-in user lands on a real Command Center shell with tokens, nav, i18n/RTL, empty states, and a working (but empty) data model.

## Phase 1B — Sales Decision Experience
- Command Center screen: 4 decision metrics, "Needs Attention" (max 5), High-Priority Opportunities, Follow-ups Due, New Opportunities, Agent Activity.
- Opportunities list + filters.
- Opportunity Detail (7 sections: Decision Status, Project Snapshot, Stakeholder Map, Commercial Context, Follow-up Plan, Evidence, Activity Timeline) with fixed action vocabulary.
- Follow-ups view, Approvals queue, Agent Activity view, Team & Permissions.

## Phase 1C — Sales Agent Workflows (activated one at a time)
Quotation Reporting → Pipeline Follow-up → Qualification → Preparation → Opportunity Discovery. Each implemented as a server function that writes to `agent_runs` + `artifacts` + `approvals`; nothing sends outreach automatically.

## Phase 1D — Validation
Manual QA matrix: AR/EN × desktop/tablet/mobile × role access × empty/error/loading/success × approval + assignment + audit + a11y.

## Out of scope (per spec)
No Operations/Procurement/QA/HSE/Swarm agents, no LinkedIn/portal scraping, no WhatsApp, no auto-outreach, no auto-pricing/quotation.

## Technical notes
- Stack: TanStack Start + Supabase (Lovable Cloud). Server functions for all sensitive reads/writes; service role stays server-only.
- Seed data: minimal, realistic PHC-style examples via a migration so the UI is never empty during demo — no lorem ipsum, no fake metrics on production paths.

## Ask before I start
1. **Confirm Phase 1A first?** I'll ship foundation + shell + schema + auth in this delivery, then continue to 1B in follow-ups. (Alternative: I try to cram everything into one giant delivery, which will be lower quality.)
2. **Auth providers:** email/password + Google — OK? (Google requires you to enable it in Cloud → Auth after I wire it.)
3. **Seed data:** OK to include ~10 realistic sample opportunities + stakeholders + follow-ups so the Command Center demonstrates the decision flow immediately?
4. **Default language on first load:** English or Arabic?