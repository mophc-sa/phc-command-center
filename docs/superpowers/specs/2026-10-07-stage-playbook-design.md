# Stage playbook — design (phase 2 of the sales-engineer playbook)

Date: 2026-10-07. The user chose option A on 2026-10-06 ("auto from data where possible, manual
for the rest") and on 2026-10-07 asked to proceed with the recommended design.

## Goal

Every deal stage has an "evidence of done" checklist drawn from the sales-engineer role document.
Items that the system can see are ticked automatically; the rest are ticked by the rep with a short
note. The daily assistant proposes the missing items of the current stage as a task, which the rep
approves (AI never creates work by itself).

## What already existed (2026-10-07 audit)

Canonical sales stages with gated moves and validation (`advance_sales_stage`); stakeholder
`role_code` (decision_maker, influencer, technical, procurement, finance, gatekeeper, other); a
7-item milestone checklist independent of stage; a rule-based daily assistant with four suggestion
types; leads/intake before `rfq_received`. Missing: buyer type on the deal, prequalification on the
account, and any per-stage checklist.

## Decisions

1. **Checklist per canonical stage**, defined once in `supabase/functions/_shared/stage-checklist.ts`
   and re-exported to the UI (same pattern as `stage-canonical.ts`), so the deal page and the daily
   assistant evaluate the same rules.
2. **Auto items** are computed from data the deal already has: buyer type set; a stakeholder with
   role decision_maker / procurement / technical; the account's prequalification approved; BOQ has
   items; a quotation exists; expected contract date; contract value; loss reason.
3. **Manual items** are stored in `opportunity_checklist(opportunity_id, item_key, done, note,
   done_by, done_at)` through RPC `set_checklist_item` (sales contributor who can read the deal).
   Direct table writes are revoked. Readable by whoever can read the deal (`can_read_boq`).
4. **Buyer type** is a nullable column on opportunities: main_contractor, developer_owner,
   consultant, hotel_operator, existing_client. Set from the deal page.
5. **Prequalification** lives on the company: `prequalification_status` (not_started, submitted,
   under_review, approved, needs_completion), `prequalification_note`, `prequalification_updated_at`.
   Edited on the account page; every deal of that company sees it.
6. **Daily assistant**: a fifth suggestion type `checklist` — one per open deal with missing items in
   its current stage, priority 55, listing the missing items. Approval goes through the existing
   `approve_ai_daily_task` with a new `checklist` branch (locked on the opportunity, one open task per
   deal). Still rule-based, no LLM.
7. **Stage moves are not blocked** by an incomplete checklist; the existing gates (notes, evidence,
   manager approval) stay the hard rules. The checklist informs; it does not police.

## Items by stage (from the role document)

| Stage | Auto | Manual |
|---|---|---|
| rfq_received | buyer type; decision maker; procurement contact | tender file complete (BOQ, drawings, specs, sign schedule); scope reviewed, queries listed; scope boundaries (design, BIM, civil, electrical, access) agreed; site visit done or not needed |
| jih | BOQ priced; quotation issued; account prequalification approved | "why PHC" prepared for this project |
| jih_bafo | — | evaluation status and blockers known; clarifications answered |
| under_negotiation | — | every change approved internally; revised quote issued |
| verbally_awarded | expected contract date | PO/contract matched against the last approved quote |
| contract_received / contract_signed | contract value | handover meeting held |
| won | — | handover file delivered; account follow-up plan agreed |
| lost | loss reason | win/loss analysis recorded (client's words vs our estimate) |

## UI

- Deal page, next to the milestone checklist: **Stage checklist** panel — the current stage's items,
  auto ones read-only with ✓/–, manual ones as checkboxes with an optional note; a buyer-type select
  in the panel header; "N of M done".
- Account page: prequalification status in the details grid and the edit dialog.
- My daily assistant: checklist suggestions appear like the others.

## Testing

- Deno: `evaluateChecklist` per stage (auto rules, manual rows, unknown stage → empty).
- pgTAP: RPC access (owner yes, outsider no, viewer no), note kept, `approve_ai_daily_task`
  checklist branch, RLS read via can_read_boq, direct insert refused.
- Bun: the full suite (contract tests cover UI baseline).

## Out of scope (phase 3)

Quotation pre-submission checklist (materials, fixing, lighting…), PO reconciliation workflow,
handover document, mandatory loss reason on the stage move, weekly auto-report, hygiene flags.
