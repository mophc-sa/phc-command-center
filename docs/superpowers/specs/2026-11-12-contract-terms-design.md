# Commercial & Finance part 2 (Phase B), B1: the contract and its payment schedule — design

Date: 2026-11-12 · Approved by Mo section by section on 2026-11-12.

**Source:** Ahmed Zayed's meeting, `docs/finance/2026-11-03-ahmed-zayed-meeting.md` §2 (contract: quantities, execution period, payment sequence) and §3 (every payment due and its date).

## Phase B, in order (Mo, 2026-11-12)

| Part | Scope |
|---|---|
| **B1 (this design)** | The contract from the accepted quotation: value, quantities, execution period, payment schedule, finance review |
| B2 | Execution approvals: shop drawings, MIR, WIR; each makes its payment due |
| B3 | Invoices against the contract, collection, claim letters, lateness and escalation; the rep sees what was invoiced |
| B4 | Variation orders before extra work; executed vs contract value |
| B5 | The four direct costs and their payments; the management board (sold, cost, collected, late) |

Each part gets its own design, plan and PR.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Who records the contract | **The rep** (the deal owner, or the sales or BD manager) from the deal page; **finance reviews** (approve, or return with a reason). |
| 2 | Payment schedule | **Template, editable:** advance, after drawing approval, after supply (MIR), final after installation (WIR). Percentages per payment; a payment can be removed or added; the total must be exactly 100%. |
| 3 | When a payment is due | **The event + the contract's credit period** (e.g. 30 days after the invoice). Before the event, an **expected date** from the execution period feeds the cash plan. |
| 4 | Value and quantities | **From the last quotation sent.** A contract value that differs needs a reason; finance sees the difference. The quotation's lines become the contract quantities (the reference for executed quantities in B4). |
| 5 | Build approach | **Extend `contracts`** (one meaning of "contract"); two child tables for payments and quantities. Not a parallel table, not JSON. |

## 1. Flow

1. The file is *quoted*. The rep presses **Record the contract** on the deal page. The form starts from the client's current quotation revision: value (excl. VAT), its lines as the contract quantities.
2. The rep enters: contract reference, signing date, the three periods (drawings approval 5 days, supply and installation 45, testing and handover 10, all editable), the credit period (30 days), the payment rows, the contract file (a deal document). A value other than the quotation's needs a reason.
3. **Send for review.** Finance is notified; the contract is listed on `/approvals` as *Review contract*.
4. Finance **approves** (terms frozen) or **returns** with a reason (the rep is notified, edits, sends again). The author cannot approve.
5. After approval the payment table is read-only. B2 sets each payment's actual due date when its event happens.

Terms status: `draft → in_review → approved`, and `in_review → returned → in_review`. The existing contract `stage` (draft, sent for signature, signed…) is unchanged and separate.

## 2. Data

**`contracts` gains:** `quotation_revision_id`, `terms_status`, `value_difference_reason`, `signed_on`, `drawings_days`, `supply_install_days`, `handover_days`, `credit_days`, `submitted_by/at`, `reviewed_by/at`, `return_reason`, `document_id`.

**`contract_payments`:** contract, position, `kind` (`advance`, `drawings_approval`, `mir`, `wir`, `other`), label, `pct`, `amount` (computed in SQL; the last payment takes the rounding remainder so the amounts sum to the value exactly), `expected_on` (computed from the signing date and the periods: advance at signing; drawings at signing + drawings days; MIR at signing + drawings + supply/installation days; WIR at the end of handover; `other` typed), `event_on` and `due_on` (empty until B2).

**`contract_lines`:** contract, line number, description, quantity, unit, line total: a copy of the quotation lines.

Writes go through RPCs only (`contract_terms_save`, `contract_terms_submit`, `contract_terms_review`). One open (not approved) terms record per deal.

## 3. Rules the database enforces

- Payments: at least one; each percentage > 0; total exactly 100.
- Contract value > 0; a value other than the quotation's needs a reason.
- Draft edits only while `draft` or `returned`, by the deal owner or a pipeline operator.
- Review only while `in_review`, by finance, never by the contract's author (who saved or submitted it).
- Approved terms are frozen (payments and quantities too).
- Read: `can_read_contract` (unchanged: the pipeline, finance, the deal's people).
- Every move audited; bilingual errors; RLS and the session boundary on the new tables.

## 4. Screens

- **Contract card** on the deal page: status, the form (pre-filled), the difference against the quotation ("Rev 2: 1,200,000 → contract 1,150,000 (−4.2%)"), payments with amount and expected date, *Send for review*; for finance, *Approve* / *Return*.
- `/approvals`: *Review contract* (finance), opening the deal.
- Notifications: finance on submit; the rep on return and approval. No amounts in the text.

## 5. Tests

pgTAP for every rule in §3, the amounts and the rounding, the expected dates, who reads; bun for the date and difference helpers and the payment template.

## Out of B1

Due dates from events, invoices, collection (B2, B3); variations (B4); costs (B5). Existing contract rows are untouched.
