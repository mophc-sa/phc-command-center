# Commercial & Finance part 2 (Phase B), B4: variation orders and executed quantities — design

Date: 2026-11-12 · Mo's answers on 2026-11-12. Builds on B1–B3 and the pricing loop.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | How a variation is priced | **Through the pricing loop:** the rep opens a variation from the approved contract; it is a pricing file of its own (tagged VO-n) that runs package → supplier → GM → finance review → quotation. |
| 2 | How an accepted variation is billed | **Its own payment on the contract:** the client's acceptance adds its value to the contract, a `variation` payment for it, and its lines to the contract quantities. It falls due through a B2 approval. |
| 3 | Executed vs contract | **Executed quantity per contract line** (default: the contract quantity), recorded at close-out. Executed value = the line's price × executed quantity; the final payment is reduced by the shortfall. |

## Model

- `pricing_files` gains `variation_contract_id`, `variation_number`, `variation_accepted_at`. A deal keeps **one open main file**; variation files are open beside it (the unique index becomes `… WHERE state <> 'closed' AND variation_contract_id IS NULL`; `_pricing_file_open` follows it).
- A variation's quotation has its own header (`<deal code>-VO<n>`): `pricing_issue_quotation` finds the header by the file, not by the deal.
- `contract_payments.kind` gains `variation`; `contract_payments.variation_file_id`, `amount_before_executed`; `contract_lines.variation_file_id`, `executed_quantity`.
- RPCs: `contract_variation_open(contract, reason)` (deal owner or pipeline operator, approved contract: a new BOQ `VO-n`, a draft revision, the file at *received*; estimation and finance are told); `contract_variation_accept(file, accepted_on, client reference, file path)` (the file quoted; adds the payment, the lines and the value; finance is told); `contract_executed_record(contract, lines)` (executed ≤ contract quantity, otherwise a variation is needed; only while the final payment has nothing due; the final payment is reduced by the shortfall of the contract's own lines).
- View `contract_execution_summary`: contract value, accepted variations, executed value, shortfall. `contract_billing_summary.left_to_invoice` becomes the payments' total less what is invoiced.

## Screens

The approved contract card: *Open a variation* (reason) and the variations with their state (link to the pricing file), *Client accepted* on a quoted variation; *Executed quantities* (a line table, default the contract quantity) with the executed value and the reduction of the final payment. The pricing file shows a VO tag.

## Tests

pgTAP: open beside the main file, permissions, accept (payment, lines, value, once), executed (cap, reduction, refused once the final payment is due), the views; the existing pricing tests still pass with the new index.
