// =============================================================================
// Phase 5.1 §19 — who is on this deal, and what each of them is TO IT.
//
// Reads the existing `stakeholders` rows, which are already per-opportunity.
// Nothing here creates a contact: the identity of a person lives in `contacts`
// and `stakeholders`, and this only records the ROLE they play on this
// opportunity. The same person can be the decision maker on one deal and a
// technical reviewer on another, which is why the role belongs on the link.
//
// Not a relationship graph. The spec asks for completeness and roles, and a
// diagram nobody asked for would be a bigger surface to maintain than the
// question it answers.
// =============================================================================

import { useI18n } from "@/lib/i18n";
import { StatusPill } from "@/components/phc/StatusPill";
import {
  STAKEHOLDER_ROLES,
  decisionMakerState,
  effectiveRole,
  type DecisionMakerState,
  type StakeholderRole,
  type StakeholderRow,
} from "@/lib/stakeholder-roles";

export const ROLE_LABEL: Record<StakeholderRole, { en: string; ar: string }> = {
  decision_maker: { en: "Decision maker", ar: "صانع القرار" },
  influencer: { en: "Influencer", ar: "مؤثر" },
  technical: { en: "Technical", ar: "فني" },
  procurement: { en: "Procurement", ar: "المشتريات" },
  finance: { en: "Finance", ar: "المالية" },
  gatekeeper: { en: "Gatekeeper", ar: "حاجب" },
  other: { en: "Other", ar: "أخرى" },
};

const DM_STATE: Record<DecisionMakerState, { en: string; ar: string; tone: "positive" | "attention" | "muted" }> = {
  yes: { en: "Identified", ar: "محدَّد", tone: "positive" },
  no: { en: "Not identified", ar: "غير محدَّد", tone: "attention" },
  // Three states, not two. "Nobody recorded one in a form we can read" is a
  // different fact from "this deal has none", and the same rule the metric
  // states follow applies here.
  unknown: { en: "Cannot tell from the record", ar: "لا يمكن تحديده من السجل", tone: "muted" },
};

export function RelationshipPanel({
  stakeholders,
  contractorDecisionMaker,
  onEditRole,
}: {
  stakeholders: StakeholderRow[];
  contractorDecisionMaker?: string | null;
  /** Opens the caller's existing edit dialog. This panel writes nothing. */
  onEditRole?: (s: StakeholderRow) => void;
}) {
  const { lang } = useI18n();
  const dm = decisionMakerState(stakeholders, contractorDecisionMaker);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {lang === "ar" ? "صانع القرار" : "Decision maker"}
        </span>
        <StatusPill tone={DM_STATE[dm].tone}>{DM_STATE[dm][lang]}</StatusPill>
        {dm === "yes" && contractorDecisionMaker ? (
          <span className="text-[12px] text-foreground">{contractorDecisionMaker}</span>
        ) : null}
      </div>

      {stakeholders.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">
          {lang === "ar"
            ? "لا أحد مرتبط بهذه الفرصة بعد."
            : "Nobody is linked to this opportunity yet."}
        </p>
      ) : (
        <ul className="divide-y divide-border/50">
          {stakeholders.map((s) => {
            const role = effectiveRole(s);
            const legacy = role !== null && !s.role_code;
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-foreground">{s.name ?? "—"}</span>
                  {s.organization ? (
                    <span className="block truncate text-[11px] text-muted-foreground">{s.organization}</span>
                  ) : null}
                </span>

                {role ? (
                  <StatusPill tone={role === "decision_maker" ? "positive" : "muted"}>
                    {ROLE_LABEL[role][lang]}
                  </StatusPill>
                ) : (
                  <span className="text-[11px] text-muted-foreground">
                    {/* The raw historical text, shown as-is. It is never
                        rewritten and never reinterpreted into a role we are not
                        confident of. */}
                    {s.role?.trim() ? s.role : lang === "ar" ? "بلا دور" : "No role"}
                  </span>
                )}

                {legacy ? (
                  <span className="text-[10px] text-muted-foreground/70">
                    {lang === "ar" ? "من نص قديم" : "read from legacy text"}
                  </span>
                ) : null}

                {s.last_interaction_at ? (
                  <span className="num text-[10px] text-muted-foreground" data-tabular="true">
                    {s.last_interaction_at.slice(0, 10)}
                  </span>
                ) : null}

                {onEditRole ? (
                  <button
                    type="button"
                    onClick={() => onEditRole(s)}
                    className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                  >
                    {lang === "ar" ? "الدور" : "Role"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Options for the caller's existing ActionDialog select. */
export function roleOptions(lang: "en" | "ar") {
  return STAKEHOLDER_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r][lang] }));
}
