# Separation of duties — findings, 2026-08-06

Read-only review of `user_roles` and the BAFO approval trigger on PHC AGENT
(`lrfdtoexyeghrzynapyn`). **Nothing was changed.** Both findings need a decision
from the business, not a code fix.

Triggered by the user stating that Finance Manager and Estimation Manager are one
person, Ahmed Zaid. Checking whether the system handled that surfaced two things
that matter more.

---

## Finding 1 — one account holds eight roles, collapsing the whole BAFO chain

`Marie Falome` currently holds:

```
bd_manager · sales_ops · general_manager · sales_manager
salesperson · finance_manager · estimation_manager · viewer
```

The BAFO discount chain (`20260727220000_bafo_approval_chain.sql`) is designed as
four sequential checks by four different authorities:

| Step | Required role | Marie holds it? |
|---|---|---|
| 1. Commercial review | bd_manager · sales_manager | ✅ |
| 2. Cost approval | estimation_manager | ✅ |
| 3. Finance review | finance_manager | ✅ |
| 4. Final approval | managing_director · general_manager · ceo | ✅ |

**One account can complete all four steps.** The four-stage control is nominal for
that account — it enforces an order, not a set of independent judgements.

The same account also satisfies `canApproveCommercialAction`, `canEditTotalValue`,
`canChangeCommercialStage` and `canAssignOwner`, so it can also move a deal to
Verbally Awarded, Contract Received and Won without any second party.

### Why this probably happened

The system has 13 accounts, of which 10 are Playwright fixtures. Only three are
real people. With a team that small, granting one person everything is the fast
way to unblock work — and nothing in the system pushes back.

### What to decide

Give the roles to the people who actually perform the functions. Concretely:

- `finance_manager` + `estimation_manager` → **Ahmed Zaid** (see Finding 2)
- `general_manager` → whoever genuinely holds final commercial sign-off
- Leave Marie the roles matching her actual job

If one person genuinely must hold several of these while the team is this small,
that is a legitimate business choice — but it should be a **stated** one, because
right now the four-step chain reads as a control that isn't there.

---

## Finding 2 — Ahmed Zaid has no account

Finance and Estimation are, per the user, one person: **Ahmed Zaid**. He is not in
`profiles` at all. The two roles sit on Marie's account instead.

Until he is onboarded:

- every BAFO cost and finance decision is recorded against the wrong person
- the audit trail attributes his judgements to someone else
- `rfqs.assigned_to` — added 2026-08-06 so a rep can say "this is waiting on
  Estimation" — has nobody correct to point at

**Needed to proceed:** his work email. I did not invent one.

Once created, he needs `finance_manager` + `estimation_manager`, and a
`profiles.sales_code` if he should ever own an RFQ number.

---

## Finding 3 — no self-approval guard

The BAFO trigger checks **role** and **order**. It does not check that the approver
is a different person from the requester, at any step.

So a user with the right roles can request a discount and approve it through all
four steps. Combined with Finding 1, that is currently possible for one account.

### Recommendation: do not add the guard yet

A `requested_by <> approver` constraint is the obvious fix and would be wrong
today. With three real users, forcing a distinct approver at four steps would
deadlock ordinary work — there is often nobody else with the role.

Sequence it: fix the role distribution first (Findings 1 and 2), confirm each step
has at least two eligible people, then add the guard. Adding it now trades a
governance gap for an operational one.

---

## What is deliberately NOT a finding

**Ahmed Zaid holding both `finance_manager` and `estimation_manager` is fine.**
Recorded as D12 in `docs/DECISIONS.md`. The two steps ask different questions —
"is this above our cost?" versus "does this fit our margin?" — and one person can
answer both honestly. Forcing two people would mean inventing an approver who
doesn't exist. The genuine second pair of eyes is step 4, the executive.

The chain is then four steps but **three distinct people**: requester → Zaid
(two steps) → executive. Documentation should say that rather than implying four
independent checks.
