# PHC Sales Agent — Premium Redesign

A full visual redesign of the authenticated app in three phases. No feature removal, no route or Supabase changes, no business-logic edits beyond wiring the new components.

## Design language

- Dark-first executive shell built on **Black Pearl `#101924`** with the darker tonal scale (`#0B1119`, `#1B2531`, `#3A424E`) for surfaces, nav and depth.
- **Ghost White `#F5F7FC`** and the light tonal scale (`#E4E8F0`, `#C7CBD2`, `#9CA1A8`) for content, dividers and light states.
- **Cool Gray `#73787C`** for secondary text and neutral borders.
- One restrained accent, reused only for primary actions, active nav, and selected states — no gradients, no glow, no heavy shadow.
- Apple-inspired: strong hierarchy, generous whitespace, subtle depth (1px hairline borders + a single soft ambient shadow), calm micro-interactions (150–200ms ease).

## Phase 1 — Design system + app shell (this turn)

**Tokens (`src/styles.css`)**
- Rewrite the semantic token layer around the brand palette: `background`, `surface`, `surface-elevated`, `border`, `border-strong`, `foreground`, `muted-foreground`, `accent`, `accent-foreground`, plus status tokens (positive/attention/danger/muted).
- Tighten radius scale (`--radius: 10px`), spacing rhythm, and a single elevation token (`--shadow-elevated`).
- Refined typography scale: display / h1 / h2 / section-label (uppercase tracked) / body / caption / numeric-tabular.

**Shared primitives**
- `SectionHeader`, `StatusPill`, `EmptyState`, `ActionDialog`, buttons, inputs, selects, tabs, cards, tables, toasts — restyled to match tokens. Keep every existing prop/export intact.
- New primitives added under `src/components/phc/`: `KpiCard`, `Panel`, `PageHeader`, `FilterBar`, `DataTable` wrapper, `Sparkline`, `TrendBadge`.

**App shell (`src/routes/_authenticated/route.tsx` + `AppSidebar` + top bar)**
- Sidebar: quieter icons, grouped modules (Pipeline / Execution / Intelligence / Admin), refined active state (accent bar + subtle surface), collapsible via existing SidebarProvider.
- Top bar: hairline border, aligned status pill, language + notifications + profile with consistent spacing, subtle presence.
- Content container: centered max-width with consistent page padding and `PageHeader` pattern (title, subtitle, actions right).

## Phase 2 — Command Center + high-traffic modules (next turn)

- Rebuild Command Center as an executive dashboard: KPI row, pipeline-by-stage bar, opportunities trend line, follow-ups/approvals panels, priority list.
- Introduce Recharts-based visuals (already available) styled with the token palette — thin strokes, muted grid, no default rainbow colors.
- Redesign the RFQ & JIH Board, Opportunities, My Workspace, Action Required and Follow-ups to the new page pattern.

## Phase 3 — Propagate across remaining modules (following turn)

- Accounts, Contacts, Projects, Tender Monitor, Tender Conversion, Award & Contract Queue, Quotations, BOQ Center, Targets & Performance, Project Radar, Approvals, Vendors, Reference Library, Knowledge Search, Reports, Agent Activity, Team & Permissions, Admin Settings, Settings.
- Standardize filters, tables, empty/loading states, and add module-specific charts (quotation status, BOQ verification, target vs actual, monthly trend, report grid).
- Final pass: visual QA across every route, responsiveness check at 1280 / 1050 / 768, typecheck + build.

## Guardrails

- No changes to route files' loaders, `createServerFn` calls, Supabase queries, or RLS-facing code.
- No removed exports; existing components keep their props so importers don't break.
- No `any`, no fake typings, no hardcoded color utilities (`text-white`, `bg-[#…]`) — everything through tokens.
- After each phase: `bunx tsgo --noEmit` and `bun run build`.

## Technical section

- Tokens go in `@theme inline` block mapping brand vars → shadcn semantic vars, so all shadcn components inherit automatically.
- Charts: use existing `recharts` dep; wrap in a `<ChartFrame>` primitive that fixes stroke, grid, tooltip, legend styling.
- Sidebar grouping is a data-only change in `AppSidebar`; routes and paths unchanged.
- Typography: keep current font loading strategy; only adjust scale + weights via tokens.

Approve to start Phase 1.
