# 2026 activation — batch 2 candidate

Generated 2026-08-25 from production (`historical_sales_search`, 679 rows).
Manifest: `src/data/activation-manifest-batch2.json`.

> **`approvedOn` is null.** This is a candidate, not an approval. Sales leadership
> sets that field. Nothing activates until someone with `sales_manager`,
> `bd_manager` or the GM runs **Check batch** from production.

## Where 2026 stands

| | records | value (excl. VAT) |
|---|---:|---:|
| in the archive | 78 | SAR 104,471,148 |
| batch 1 — already live | 45 | SAR 63,407,478 |
| **batch 2 — eligible now** | **14** | **SAR 26,158,975** |
| blocked on source data | 19 | SAR 14,904,695 + 9 with no amount |

Batch 2 by stage: **7 lost · 5 submitted · 1 won · 1 draft**. Every one has a route.

## How eligibility was decided

The five conditions `promote_historical_row()` raises on, applied to the 33
records of 2026 outside batch 1 — not a judgement of mine:

- a mapped company (`company_id`) — *"none is created automatically"*
- a real user as owner (`owner_user_id`) — *"legacy owner labels are not accounts"*
- a project name
- a decided status (`status_canonical` — NULL on exactly 103 rows archive-wide)
- a present amount — *"an absent amount must be explained rather than treated as zero"*

**Not verified by the server preflight.** `sales-os-api` pins CORS to
`https://agent.phc-sa.com`, so a local build cannot call it. Run Check batch from
production first — the UI refuses a batch whose eligible set is not exactly the
manifest, so a stale manifest stops rather than promoting a different set.

## The 19 that are blocked, and on what

Nine need an amount, seven need an owner mapped to a real account, six need a
company. None needs a decision from an engineer — each is a fact somebody knows.

| project | client | amount | missing |
|---|---|---:|---|
| PW-FA25-148 Public Realm — Signage | DIRIYAH (Direct) | — | amount |
| CENOMI \| Jeddah Westfield — Wayfinding | CENOMI | 5,004,040 | owner |
| Business Oasis Fund & Retal urban | IKK KABBANI | 2,290,640 | owner |
| Alaa Khotah Wayfinding \| Sela | PROFAST SA | 1,997,000 | company |
| CENOMI LIGHTBOX | CENOMI | 1,800,000 | owner |
| KAFD Monorail Station A07 | FIRST GROUP CONTRACTING | 1,079,690 | company |
| DC-HEAD QUARTER (HQ) CAMPUS RELOCATION | Saudi Company for Pref… | 881,700 | company |
| CENOMI \| Jeddah Westfield — External | CENOMI | 652,460 | owner |
| Holiday Inn Hotel — Signage | — | 601,250 | company, owner |
| KSKD: KSL - KSS - KJ100S — Diriyah | Elegancia Contracting | 528,615 | owner |
| New Murabba — Directional Signage | CCCC | 69,300 | company |
| EVL — Qiddiya Project | ACONEX PORTAL | — | amount |
| Lemar Commercial Complex | MAS ECC | — | amount |
| Ministry of Housing — Al Jouf | AL JHAZERA SHADES CO | — | owner, amount |
| 1 Hotel Diriyah | CPC DEVELOPMENT | — | owner, amount |
| SEVEN Yanbu — TRASHBIN & BOLLARD | BUJV | — | company, status, amount |
| SEVEN Medinah — TRASHBIN & BOLLARD | BUJV | — | company, status, amount |
| MISK VILLAS — Riyadh | El Soadaa Arabian for… | — | company, status, amount |
| Waldorf Astoria Hotel Renovation | — | — | company, owner, amount |

**Four CENOMI rows worth SAR 7.5M are blocked on one thing: an owner.** Mapping
that single legacy prefix to a real account moves the largest blocked value in
2026.

## Order of work

1. Leadership reviews the 14 and sets `approvedOn`.
2. Check batch from production. If it refuses, production has moved since
   2026-08-25 and the manifest must be regenerated — that refusal is the design
   working, not a fault.
3. Activate. Promotion is one record at a time; the database enforces that.
4. The 19: resolve owner, company, amount, status. The archive's Data Quality
   strip filters each of those four with one click.
