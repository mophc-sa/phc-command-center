# Pricing loop (Commercial & Finance, part 1) — design

Date: 2026-11-03 · Approved by Mo section by section on 2026-11-03.

**Sources:**
- Ahmed Zayed's meeting, recordings 73–76: `docs/finance/2026-11-03-ahmed-zayed-meeting.md`
- The approved workflow document "سير العمل ومتطلبات الإكمال" (2026-10-20). This design covers its phase **A** (R1 roles, R2 supplier portal, R3 pricing path).
- PRD "PHC Smart Command" v1.0 §9.4, §11.4–11.5: the Estimation Queue is owned by the finance manager, the cost is hidden from sales, and a proposal is issued only from an approved version.

**Scope of this document:** from an approved RFQ to an issued quotation revision, and its client revisions.

**Out of scope, each with its own design later:**
- Everything after the contract: contract terms and milestones, actual costs, MIR/WIR, invoices, collections, project P&L.
- Commercial AI: historical estimates, similar signs, last price to this client, payment-terms simulator.
- Historical data load.
- Multi-supplier comparison UI.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Which part first | The pricing loop. It runs daily (30–40 RFQs a week), its engine already exists (Phases 7A–8, DB only), and the frozen BOQ it produces is the quantity reference the contract and billing need later. |
| 2 | Who sets the selling price | **Zayed proposes, Kalas (GM) approves.** Zayed's proposal counts as the finance review. The commercial-review step is skipped in this path, so approval is one step: `can_approve_final_price` (GM or delegate). |
| 3 | What the supplier sees | Quantities, specs and files only, under the **project code** (e.g. `FA-26-0001`). No client, contractor or location. |
| 4 | How supplier prices enter | The supplier portal, **plus** entry on behalf: Zayed uploads the supplier's Excel or PDF and types the prices. The quote is recorded as the supplier's, marked "entered by", with the original file attached. |
| 5 | Installation pricing | A **rate card by installation type** (double-tape, screwed wall, pylon, ceiling, floor), with modifiers: weight and height bands, floor cutting, scaffold or crane. A line with no type falls back to a % of materials. The rate card is installation **cost**; selling adds margin. |
| 6 | Build approach | On top of the existing engine: `boq_revisions`/`boq_lines`, `supplier_quotes`/`_lines`, `estimations`, `internal_prices`, `margin_policies`, `quotation_revisions`. Its guards are kept: cost columns revoked from sales, frozen BOQ required, quotation subtotal equal to the approved price, margin floor with justification. |
| 7 | Suppliers per RFQ | One in this release (Robbie). Tables already allow several; the comparison screen waits until a second supplier is needed. |

## 1. Flow

One **pricing file** per RFQ, holding one state.

| State | Owner | Moves to |
|---|---|---|
| `received` | system | Opened when the sales manager approves the RFQ. Notifies Zayed. |
| `package_review` | Zayed | Checklist: BOQ vs drawings vs location plan. Moves to `needs_info` (to sales, with a list and a due date) or to `boq_frozen`. |
| `needs_info` | sales rep | Back to `package_review` when the rep answers. |
| `boq_frozen` | Zayed | The BOQ revision is frozen (Rev N). Any later quantity change opens a new revision. |
| `at_supplier` | supplier | Sent with a reply-by date. Reminder to Zayed when it is overdue. |
| `supplier_priced` | Zayed | The supplier submitted, or Zayed entered on their behalf. |
| `cost_review` | Zayed | Per-line comments. **Return selected lines** to the supplier, which goes back to `at_supplier` with only those lines reopened and the old prices kept. |
| `selling_build` | Zayed | Section 3. Ends with **Propose price**, which moves the internal price to `gm_pending`. |
| `gm_pending` | Kalas | Approve, or return with a reason (back to `selling_build`). Shown under Approvals → Manager decisions. |
| `approved` | Marie | Creates quotation revision Rev 0 from the approved price. Marie downloads the PDF on the PHC template and sends it. |
| `quoted` | sales | Client changes: quantities open a new BOQ revision and go back to `boq_frozen`. A discount goes through the existing BAFO chain. Each round produces Rev 1, 2, 3… |

Transitions are enforced in SQL. No state can be skipped, and every move records who and when.

Sales see the state and how long it has waited (e.g. "At supplier · 3 days"), then the selling price after approval. They never see cost, supplier price or margin.

## 2. Roles, visibility, supplier portal

**New role `supplier`:**
- Linked to one `vendors` row.
- Email and password with **mandatory MFA** (external account).
- Reaches only `/supplier/*`.
- RLS: a supplier reads only the invitations, lines and files sent to its vendor, and only its own quote rows.

| Role | Quantities & files | Supplier cost & margin | Selling price | Writes |
|---|---|---|---|---|
| Sales rep | own RFQs | no | own, after approval | answers to "needs info" |
| Sales manager, BD manager | all | no | all | answers; Marie issues and sends the quotation |
| Zayed (estimation + finance) | all | all | all | every pricing step, rate card, extras, logistics |
| Kalas (GM) | all | all | all | approve / return |
| Supplier | what was sent to it | its own prices only | no | its prices and notes |

**Portal:**
- A list of invitations: project code, reply-by date, status.
- An invitation page with lines (qty, size, specs), downloadable files, and per line: unit price, optional "price with screen", and "differs from spec". Plus lead time, payment terms and validity.
- **Before submitting**, the supplier confirms: "My prices are based only on the files attached to this request; any material or spec difference is written on its line." The confirmation is stored with a timestamp and the exact file versions sent.
- After submit the quote is locked. Returned lines alone reopen.

**Notifications:**
- The invite email links to the portal only, with no project details.
- Zayed: on supplier submit.
- Kalas: on propose.
- Marie and the rep: on approval.
- The rep: on needs-info.
- Zayed: when the supplier is overdue.

## 3. Building the selling price

One grid of all lines. Each line carries **structured attributes**: sign type, width/height, material, illumination, screen, installation type. They feed the later AI.

**Per line:**
- Material cost from the supplier quote; Zayed picks the normal or with-screen price when both exist.
- Installation cost from the rate card by type plus modifiers, or a % of materials if no type.
- Margin % (default editable) or a typed selling price.

**Project level:**
- **Extras** from a catalog Zayed maintains: excavation, breaking, concrete base, electrical connection, acoustic insulation, scaffold, crane, special equipment. Each has a unit (lump, per item, per m²) and a default rate.
- **Per-m² items:** painting (materials + labour), printing by material, stickers.
- **Logistics estimate:** containers × rate, customs % of goods value, clearing agent fee, inland delivery (Jeddah / Riyadh). Defaults come from a table Zayed updates. The total is allocated over the lines by value, so its effect on the selling price is visible.
- **Overhead %:** existing.

**Auto-suggested extras:**
- pylon or floor → concrete base, excavation or breaking
- ceiling above a height → scaffold or crane
- cinema project → acoustic

Every suggestion must be **accepted or dismissed** before Propose is allowed, so no item is missed silently.

**Footer:** total cost, total selling price, margin. Below the margin floor, a justification is required (existing). Totals and margin are computed in SQL; the client never supplies a margin (existing Phase 8 rule).

## 4. Screens

A new sidebar group **التسعير والمالية / Pricing & Finance**. `/quotations` moves into it.

1. **Pricing queue** (`/pricing`, Zayed): open files by due date and value, with state, who owes the next step, and days waiting.
2. **Pricing file** (`/pricing/$id`), tabs following the flow:
   - Package: checklist, files, BOQ import from Excel with column mapping or manual entry, freeze.
   - Supplier: send, status, enter on behalf.
   - Cost review
   - Selling price
   - Approval
   - Quotations: revisions, PDF download.
3. **Pricing settings** (`/pricing/settings`, Zayed): installation rate card, extras catalog, logistics rates. Each has an effective date.
4. **Supplier portal** (`/supplier`, `/supplier/$invitationId`).
5. **Existing pages:**
   - The opportunity page shows the pricing state to sales.
   - Approvals → Manager decisions gains "Approve selling price" for Kalas, labelled through `approval-labels.ts`.

## 5. Data model (additions only)

**New tables:**
- `pricing_files`: rfq/opportunity link, state, owner, due dates, needs-info list.
- `pricing_file_events`: append-only state log.
- `supplier_invitations`: vendor, BOQ revision, files sent (versions), reply-by, status, confirmation text and time, entered_by.
- `installation_rates`: type, base rate, modifier fields, effective range.
- `pricing_extras_catalog`
- `pricing_file_extras`: selected or suggested extras, with accept/dismiss.
- `logistics_rates`

**New columns:**
- `boq_lines`: `install_type`, width, height, material, illumination, has_screen. Some exist as free text and become structured.
- `supplier_quote_lines`: `unit_cost_with_screen`, `spec_difference`.

**Changed:**
- The `internal_prices` transition path for pricing files: proposed by finance goes to `gm_pending`. The old chain stays valid for anything already using it.
- New app role `supplier` plus `profiles.vendor_id`.

All new tables: RLS on, cost columns revoked from `authenticated` and exposed through cost-gated views (the existing pattern). Migration numbers above the highest on `main` at build time.

## 6. Delivery

Four PRs, in order:

| # | Content | Backend release |
|---|---|---|
| 1 | Foundation: tables, states, role, RLS, approval-path change, `sales-os-api` actions | migration + `sales-os-api` |
| 2 | Zayed's screens up to Propose, plus settings | none |
| 3 | Supplier portal, invite email, entry on behalf | small migration |
| 4 | Kalas approval, quotation revision + PDF, sales status, revision loop | none |

**Acceptance gate:** the first complete quotation through the whole flow in the system, with real users (Zayed, Robbie, Kalas, Marie).

**Tests:**
- **pgTAP:**
  - A supplier sees only its invitation.
  - Sales cannot read cost through tables, views, search or AI context.
  - States cannot be skipped.
  - Propose is blocked while suggestions are open.
  - The quotation subtotal equals the approved price.
- **bun:** installation by type and modifiers, logistics allocation, margin.
- **Canary walk-through** with real accounts before production.

## Open points (to confirm with Zayed during build, not blockers)

- Exact installation types and modifier bands, and the first rate-card values.
- The default margin %, and the margin floor value (the existing `margin_policies`).
- The default logistics values: the meeting's figures are partly unclear (customs ≈5%?, container 12,000 in what currency?).
- Whether stickers are bought and fitted by the installer (meeting 76 [05:19–05:36], unclear).
