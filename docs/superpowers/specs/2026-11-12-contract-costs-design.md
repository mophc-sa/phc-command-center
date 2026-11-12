# Commercial & Finance part 2 (Phase B), B5: project costs and profit — design

Date: 2026-11-12 · Mo's answers on 2026-11-12. Builds on B1–B4 and the pricing loop.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Planned budget | **From pricing, automatically:** when finance approves the terms, the approved price's cost becomes the contract's cost items (manufacturing = supplier materials, installation, logistics = shipping and clearing, extras). Accepted variations add theirs. Finance can add `other` items and reload the pricing budget. |
| 2 | Money out | **Schedule and actuals:** per item, the supplier's or workshop's actual invoice, planned payments with dates (e.g. 30/40/30), and actual payments. |
| 3 | Late collection | **A financing cost:** a monthly rate (default 1%, finance sets it) on each amount from its due date to its collection (or today), taken off profit: *net profit after late collection*. |

## Model

- `finance_settings` (key, value): `late_financing_pct_month` = 1. Set by finance (`finance_setting_set`).
- `contract_cost_items`: contract, category (`manufacturing`, `installation`, `logistics`, `extras`, `other`), source (`pricing`, `variation`, `manual`), source file, planned amount, label. Cost: readable by cost readers who can read the contract; never by reps or the BD manager.
- `contract_cost_entries`: item, kind (`actual_cost`, `planned_payment`, `payment`), date, amount, reference, note; void with a reason. Finance writes.
- `contract_costs_load(contract)`: (re)creates the `pricing` and `variation` items from `pricing_selling_totals` of the contract's file and its accepted variations (run by finance, a cost reader; also when finance approves the terms). Items that already have entries keep them: their planned amount is updated.
- `contract_profit` view (owner-run, gated on the cost reader): per approved contract: sold, executed value, planned and actual cost (actual where an item has an actual invoice, planned otherwise), gross profit planned and expected, received, outstanding, late outstanding, financing cost, net profit; cash out paid and planned.
- `/project-profit` page and a *Costs* card on the deal for cost readers.

## Tests

pgTAP: the load from pricing (the PR 2 worked example: materials, installation, logistics, extras), reps read no cost, finance writes entries, voids, the financing cost on a late invoice (fixed dates), the profit figures; bun for the presentation helpers.
