// =============================================================================
// Phase 5.1 §C1 — the SAR 63.4M, taken apart.
//
// The complaint this answers: "من أين أتت الـ63.4M؟" A headline number with no
// way to see the rows behind it is a dead number, and a manager who cannot
// reconcile it stops believing the rest of the page.
//
// This reads the SAME rows the KPI summed — it is handed the opportunities the
// caller already has, never its own query. A second analytics source is how two
// panels start disagreeing about the same pipeline.
//
// The footer reconciles explicitly: rows shown, rows carrying no value, and the
// sum. If the sum does not match the headline, that is visible rather than
// buried.
// =============================================================================

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { formatCurrency, formatNumber, useI18n } from "@/lib/i18n";
import { canonicalStageLabelKey } from "@/lib/stage-canonical";
import {
  MANAGEMENT_BUCKETS,
  canonicalStageOf,
  opportunityValue,
  resolveProbability,
  type OppRow,
} from "@/lib/sales-kpis";

type GroupBy = "bucket" | "stage" | "owner" | "company";

type Row = OppRow & {
  client?: string | null;
  main_contractor?: string | null;
  company?: { name?: string | null } | null;
  next_action?: string | null;
  next_action_due?: string | null;
};

const companyOf = (o: Row) => o.company?.name ?? o.client ?? o.main_contractor ?? null;

export function PipelineBreakdownDrawer({
  open,
  onClose,
  title,
  rows,
  ownerName,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Exactly the rows the headline number was computed from. */
  rows: Row[];
  ownerName?: (id: string) => string;
}) {
  const { t, lang, dir } = useI18n();
  const [groupBy, setGroupBy] = useState<GroupBy>("bucket");

  const groups = useMemo(() => {
    const keyOf = (o: Row): string => {
      if (groupBy === "stage") {
        const s = canonicalStageOf(o);
        return s ? t(canonicalStageLabelKey(s)) : lang === "ar" ? "بلا مرحلة" : "No stage";
      }
      if (groupBy === "owner") {
        return o.owner_id
          ? (ownerName?.(o.owner_id) ?? o.owner_id.slice(0, 8))
          : lang === "ar" ? "بلا مالك" : "Unassigned";
      }
      if (groupBy === "company") {
        return companyOf(o) ?? (lang === "ar" ? "بلا عميل" : "No client");
      }
      const s = canonicalStageOf(o);
      const bucket = MANAGEMENT_BUCKETS.find((b) => s && (b.stages as readonly string[]).includes(s));
      return bucket
        ? t(`mgmt_${bucket.key}` as never)
        : lang === "ar" ? "خارج السلّم" : "Outside the ladder";
    };

    const map = new Map<string, Row[]>();
    for (const o of rows) {
      const k = keyOf(o);
      map.set(k, [...(map.get(k) ?? []), o]);
    }
    return [...map.entries()]
      .map(([key, items]) => ({
        key,
        items,
        // Unpriced rows are counted but not summed, and the count says how many.
        value: items.reduce((s, o) => s + (opportunityValue(o) ?? 0), 0),
        unpriced: items.filter((o) => opportunityValue(o) === null).length,
      }))
      .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  }, [rows, groupBy, lang, t, ownerName]);

  const total = groups.reduce((s, g) => s + g.value, 0);
  const unpriced = groups.reduce((s, g) => s + g.unpriced, 0);

  if (!open) return null;

  const GROUPS: Array<{ key: GroupBy; label: string }> = [
    { key: "bucket", label: lang === "ar" ? "الموقع التجاري" : "Position" },
    { key: "stage", label: lang === "ar" ? "المرحلة" : "Stage" },
    { key: "owner", label: lang === "ar" ? "المالك" : "Owner" },
    { key: "company", label: lang === "ar" ? "العميل" : "Client" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label={t("cancel")}
        onClick={onClose}
        className="flex-1 bg-black/25 backdrop-blur-[1px]"
      />
      {/* A drawer rather than a page: the reader keeps their place on the
          dashboard, which is the whole reason drilling in is cheap. */}
      <aside
        className={`flex h-full w-full max-w-[min(38rem,100vw)] flex-col border-border bg-surface shadow-xl ${
          dir === "rtl" ? "border-e" : "border-s"
        }`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground">{title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatNumber(rows.length, lang)}{" "}
              {lang === "ar" ? "فرصة · نفس الصفوف التي كوّنت الرقم" : "opportunities · the same rows behind the number"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("cancel")}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-wrap gap-1 border-b border-border px-4 py-2">
          {GROUPS.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setGroupBy(g.key)}
              className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                groupBy === g.key
                  ? "bg-surface-2 text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups.map((g) => (
            <section key={g.key} className="border-b border-border/50">
              <div className="flex items-baseline justify-between gap-3 bg-surface-2/40 px-4 py-2">
                <span className="text-sm font-medium text-foreground">{g.key}</span>
                <span className="num text-sm text-foreground" data-tabular="true">
                  {formatCurrency(g.value, lang)}
                  {/* The middot is load-bearing. Grouped by owner the header
                      rendered "SAR 34,643,201 19" — a number butted against a
                      number with only a 0.5rem gap, which reads as one figure. */}
                  <span className="ms-2 text-xs text-muted-foreground">
                    · {formatNumber(g.items.length, lang)}
                    {g.unpriced > 0
                      ? lang === "ar"
                        ? ` · ${g.unpriced} بلا قيمة`
                        : ` · ${g.unpriced} unpriced`
                      : ""}
                  </span>
                </span>
              </div>
              <ul>
                {g.items.map((o) => {
                  const prob = resolveProbability(o);
                  const value = opportunityValue(o);
                  return (
                    <li key={o.id} className="border-t border-border/40 first:border-t-0">
                      <Link
                        to="/opportunities/$id"
                        params={{ id: o.id }}
                        className="block px-4 py-2 transition-colors hover:bg-surface-2/40"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="truncate text-sm text-foreground">{o.project_name ?? o.id.slice(0, 8)}</span>
                          <span className="num shrink-0 text-sm font-medium text-foreground" data-tabular="true">
                            {value === null
                              ? lang === "ar" ? "بلا قيمة" : "No value"
                              : formatCurrency(value, lang)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 text-2xs text-muted-foreground">
                          <span>{companyOf(o) ?? "—"}</span>
                          {/* Probability state, not a fabricated number. */}
                          <span>
                            {prob.value === null
                              ? lang === "ar" ? "بلا احتمالية" : "No probability"
                              : `${Math.round(prob.value * 100)}% · ${prob.label}`}
                          </span>
                          <span>
                            {o.expected_contract_date
                              ? o.expected_contract_date
                              : lang === "ar" ? "بلا تاريخ إغلاق" : "No close date"}
                          </span>
                          <span>
                            {o.next_action
                              ? o.next_action_due
                                ? `${lang === "ar" ? "التالي" : "Next"} ${o.next_action_due}`
                                : lang === "ar" ? "إجراء بلا تاريخ" : "Action, no date"
                              : lang === "ar" ? "لا إجراء تالٍ" : "No next action"}
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        {/* The reconciliation. Rows counted, rows that could not be summed, and
            the total — so the headline can be checked rather than trusted. */}
        <footer className="border-t border-border px-4 py-2.5 text-xs">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">
              {formatNumber(rows.length, lang)} {lang === "ar" ? "فرصة" : "opportunities"}
              {unpriced > 0
                ? lang === "ar"
                  ? ` · ${unpriced} بلا قيمة مسجَّلة`
                  : ` · ${unpriced} with no value recorded`
                : ""}
            </span>
            <span className="num text-base font-semibold text-foreground" data-tabular="true">
              {formatCurrency(total, lang)}
            </span>
          </div>
        </footer>
      </aside>
    </div>
  );
}
