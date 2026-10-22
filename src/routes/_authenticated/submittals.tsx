import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiRow } from "@/components/phc/KpiRow";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n, formatNumber, localeFor } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canApproveCommercialAction } from "@/lib/roles";
import { listAllSubmittals } from "@/lib/submittal-actions";
import {
  STAGE_TONE,
  kindLabel,
  responseLabel,
  revisionLabel,
  stageLabel,
  stepLabel,
  submittalStage,
  type SubmittalStage,
} from "@/lib/submittals";

// Samples and drawings across every deal the reader can see (manager feedback
// group 5, 2026-10-19: "the status shows on the deal page and in a list"). Rows
// are recorded on the deal page; this list is where they are followed up.
export const Route = createFileRoute("/_authenticated/submittals")({
  head: () => ({ meta: [{ title: "Samples & drawings — PHC" }, { name: "robots", content: "noindex" }] }),
  component: SubmittalsPage,
});

type KindFilter = "all" | "sample" | "drawing";
const STAGES: SubmittalStage[] = ["awaiting_approval", "in_production", "with_client", "needs_action", "done", "cancelled"];

function SubmittalsPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { roles } = useAuth();
  const isManager = canApproveCommercialAction(roles);
  const [kind, setKind] = useState<KindFilter>("all");
  // Open work by default: finished and cancelled items are history.
  const [stage, setStage] = useState<SubmittalStage | "open" | "all">(isManager ? "awaiting_approval" : "open");

  const { data = [], isLoading } = useQuery({ queryKey: ["all-submittals"], queryFn: listAllSubmittals });

  const rows = useMemo(
    () => data.map((r) => ({ ...r, stage: submittalStage(r.kind, r.current_step, r.client_response) })),
    [data],
  );
  const count = (s: SubmittalStage) => rows.filter((r) => r.stage === s && (kind === "all" || r.kind === kind)).length;
  const visible = rows.filter(
    (r) =>
      (kind === "all" || r.kind === kind) &&
      (stage === "all" || (stage === "open" ? r.stage !== "done" && r.stage !== "cancelled" : r.stage === stage)),
  );

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
      active
        ? "border-amber/40 bg-amber/10 text-amber-light"
        : "border-border/70 bg-surface/60 text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow={ar ? "الإنتاج" : "Production"}
        title={ar ? "العينات والمخططات" : "Samples & drawings"}
        description={
          ar
            ? "كل عينة ومخطط أُرسل للعميل، أين وصل، وما رد العميل. تُسجَّل الخطوات من صفحة الفرصة."
            : "Every sample and drawing sent to a client, where it stands and what the client said. Steps are recorded on the deal page."
        }
      />

      <KpiRow columns={3}>
        <KpiCard
          label={stageLabel("awaiting_approval", lang)}
          value={formatNumber(count("awaiting_approval"), lang)}
          hint={ar ? "تنتظر قرار المدير" : "Waiting for the manager"}
          trend={count("awaiting_approval") > 0 ? "down" : "flat"}
        />
        <KpiCard label={stageLabel("in_production", lang)} value={formatNumber(count("in_production"), lang)} hint={ar ? "لدى الإنتاج" : "With production"} />
        <KpiCard label={stageLabel("with_client", lang)} value={formatNumber(count("with_client"), lang)} hint={ar ? "بانتظار رد العميل" : "Waiting for the client"} />
      </KpiRow>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {(["all", "sample", "drawing"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={chip(kind === k)}>
            {k === "all" ? (ar ? "الكل" : "All") : k === "sample" ? (ar ? "العينات" : "Samples") : ar ? "المخططات" : "Drawings"}
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {(["open", ...STAGES, "all"] as const).map((s) => (
          <button key={s} type="button" onClick={() => setStage(s)} className={chip(stage === s)}>
            {s === "open" ? (ar ? "المفتوحة" : "Open") : s === "all" ? (ar ? "الكل" : "All") : stageLabel(s, lang)}
          </button>
        ))}
      </div>

      {isLoading ? null : visible.length === 0 ? (
        <div className="rounded-xl border border-border/70 bg-surface/60 py-10">
          <EmptyState message={ar ? "لا شيء هنا." : "Nothing here."} />
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border/70 bg-surface/60">
          {visible.map((r) => (
            <li key={r.id} className="border-t border-border/60 px-5 py-4 first:border-t-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone="muted">{kindLabel(r.kind, lang)}</StatusPill>
                <StatusPill tone={STAGE_TONE[r.stage]}>{stageLabel(r.stage, lang)}</StatusPill>
                <span className="num text-xs text-muted-foreground" data-tabular="true">
                  {revisionLabel(r.kind, r.revision, lang)}
                </span>
              </div>
              <div className="mt-1.5 text-base font-medium text-foreground">{r.title}</div>
              {r.opportunities ? (
                <Link
                  to="/opportunities/$id"
                  params={{ id: r.opportunities.id }}
                  className="mt-0.5 block truncate text-sm text-muted-foreground hover:text-foreground hover:underline"
                >
                  {r.opportunities.project_name ?? "—"}
                </Link>
              ) : null}
              <div className="mt-1 text-xs text-muted-foreground">
                {stepLabel(r.current_step, lang)}
                {r.client_response ? ` · ${responseLabel(r.client_response, lang)}` : ""}
                {r.last_step_at ? (
                  <>
                    {" · "}
                    <span className="num" data-tabular="true">
                      {new Date(r.last_step_at).toLocaleDateString(localeFor(lang), { dateStyle: "medium" })}
                    </span>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
