# Commercial & Finance part 2 (Phase B), B3: invoices, receipts, claims, lateness — design

Date: 2026-11-12 · Mo's answers on 2026-11-12. Builds on B1 and B2.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Where the tax invoice is issued | **In the accounting system** (ZATCA / Fatoora compliant). Finance records it here: number, date, the dues it covers. No e-invoicing integration in this system. |
| 2 | Who records invoices and receipts | **Finance.** The rep reads what was invoiced and collected on their deals, and logs claims. |
| 3 | Escalation of a late invoice | **Three tiers:** from day 1 the rep; from day 30 the sales manager; from day 60 the GM ("needs escalation"). Once per invoice per tier. |

## Model

- **`contract_invoices`**: contract, external number (unique per contract), `invoice_date`, `amount_excl_vat` (= the sum of its dues), `vat_rate` (0.15), generated `vat_amount` and `total_incl_vat`, `due_on = invoice_date + credit_days`, note, recorded by, void (finance, with a reason, only while nothing is received).
- **`contract_invoice_dues`**: which dues an invoice covers; a due is on at most one live invoice, in full.
- **`contract_receipts`**: invoice, `received_on`, `amount` (incl. VAT), reference, note, recorded by; void with a reason. The live receipts of an invoice total at most its total.
- **`contract_claims`**: contract, optional invoice, `claimed_on`, `channel` (`email`, `letter`, `call`, `meeting`, `other`), note, `follow_up_on`, recorded by (the rep or finance).
- **`contract_receivables`** (view, invoker): per live invoice: total, received, outstanding, due date, days late, tier (0 on time, 1, 2, 3).
- **`contract_billing_summary`** (view, invoker): per contract: value, invoiced (excl. VAT), left to invoice; invoiced incl. VAT, received, outstanding, late outstanding; dues past their date and not invoiced.
- **`contract_collections_escalate()`** (pg_cron, daily 05:30 UTC = 08:30 Riyadh): tier notices (`contract_invoice_late`) with dedupe per invoice and tier; a `contract_due_not_invoiced` notice to finance per due past its date with no invoice.
- `contract_approval_void` refuses an approval whose due is on a live invoice.

## Screens

- The approved contract card gains **Billing and collection**: the two gauges, the invoices (received, outstanding, days late), the claims; *Record invoice* (finance: tick open dues, number, date), *Record receipt* (finance), *Log a claim* (rep, finance), *Void* (finance).
- **`/collections`** (finance, the sales manager, MD/GM/CEO): every open invoice across deals by days late, with the totals, and dues waiting to be invoiced.

## Tests

pgTAP: who records, the invoice total = its dues, a due once, receipts not above the total, the void rules, the views' figures and tiers (dates fixed in the past), the escalation dedupe, the approval-void refusal, permissions, the sweep. bun: gauges and tier helpers.
