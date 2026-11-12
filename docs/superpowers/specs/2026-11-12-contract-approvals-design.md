# Commercial & Finance part 2 (Phase B), B2: execution approvals and dues — design

Date: 2026-11-12 · Mo's answers on 2026-11-12. Builds on B1 (`2026-11-12-contract-terms-design.md`).

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Who records an approval | **The rep** (deal owner or a pipeline operator), with the consultant's approval file. Finance is notified. |
| 2 | Batches | **Partial, by share:** each approval covers a share of the work (e.g. MIR for 40%); that share of the payment falls due. A payment's shares total at most 100%. |
| 3 | Consultant delay | **Dates:** for the drawings approval, the date submitted and the date approved; days beyond the contract's drawings days are consultant delay, which pushes the expected dates of the later payments (MIR, WIR). |

## Model

- **`contract_approvals`**: contract, payment, `approved_on`, `share_pct`, `submitted_on` (drawings only), consultant reference, approval file (storage path), note, who recorded it; `voided_at/by/reason`. Recorded only on approved terms; never edited; finance may void one with a reason.
- **`contract_dues`**: one per approval (and one for the advance when finance approves the terms): payment, approval, `share_pct`, `amount` (payment amount × share; the approval that brings a payment to 100% takes the remainder, so the dues of a payment sum to its amount exactly), `event_on`, `due_on = event_on + credit_days`, `status` (`open`, `void`). B3 invoices against dues.
- **`contracts.consultant_delay_days`**: the sum over drawings approvals of `max(0, approved_on - submitted_on - drawings_days)`.
- View **`contract_payment_schedule`**: each payment with its expected date, its expected date shifted by the consultant delay (MIR, WIR), the share due, the amount due, and the earliest open due date. Readable like the contract.

## Rules

- Approval only on `terms_status = 'approved'`; the approval date is not before the signing date nor in the future; a payment's shares total ≤ 100; a drawings approval needs the submitted date (not after the approval date); the advance is not recorded by hand (it falls due on approval of the terms).
- Void: finance only, with a reason; voids the due (B3 will refuse a void once invoiced).
- Writes through RPCs (`contract_approval_record`, `contract_approval_void`); RLS with `can_read_contract`; session boundary.
- Notification `contract_due` to finance on each new due (no amount in the text).

## Screens

The approved contract card shows per payment: share due, amount due, due date, the expected date with the consultant shift; *Record approval* (payment, date, share defaulting to the remainder, submitted date for drawings, reference, file); the approvals list with *Void* for finance.

## Tests

pgTAP for every rule, the remainder, the advance due on approval, the delay and shift, permissions, the sweep; bun for the share/remainder and date helpers.
