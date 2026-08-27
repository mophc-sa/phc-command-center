// Phase 2 (system-redesign request): BOQ Center's full content, moved here
// verbatim from the retired /boq route so it can render as a tab inside the
// Quotations page instead of its own page. No behavior change — same
// queries, same dialogs. See src/routes/_authenticated/boq.tsx (now a
// redirect to /quotations).
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Plus, ClipboardList, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, formatCurrency, formatNumber } from "@/lib/i18n";
import { createBoq, addBoqItem, type BoqStatus } from "@/lib/sales-actions";

const BOQ_STATUSES: BoqStatus[] = [
  "verified",
  "partially_verified",
  "estimated_scope",
  "missing",
];

function boqTone(s: BoqStatus): "positive" | "attention" | "neutral" | "danger" {
  if (s === "verified") return "positive";
  if (s === "missing") return "danger";
  if (s === "estimated_scope") return "attention";
  return "neutral";
}

export function BoqPanel() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [addItemFor, setAddItemFor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<BoqStatus | "all">("all");

  // `boqs.estimated_value`, `boq_items.unit_rate` and `boq_items.cost_estimate`
  // are revoked from the `authenticated` role — cost is not a column anyone
  // reads directly any more. `select("*")` therefore returns the BOQ without
  // them, and the two numbers this panel needs come from views that gate
  // themselves: boq_sales_totals for the selling headline (anyone who may see
  // the BOQ) and boq_item_costs for the rate column (estimation, finance,
  // MD/GM/CEO only). For everyone else boq_item_costs is simply empty, so the
  // rate column renders as "—" rather than erroring.
  const { data: boqs = [], isLoading } = useQuery({
    queryKey: ["boqs"],
    queryFn: async () =>
      (
        await supabase
          .from("boqs")
          .select("*, opportunities(id, project_name, client), boq_items(*)")
          .order("updated_at", { ascending: false })
      ).data ?? [],
  });

  const { data: sellingTotals = [] } = useQuery({
    queryKey: ["boq-sales-totals"],
    queryFn: async () => (await supabase.from("boq_sales_totals").select("*")).data ?? [],
  });
  const sellingByBoq = useMemo(
    () => new Map(sellingTotals.map((r: any) => [r.boq_id, Number(r.selling_total ?? 0)])),
    [sellingTotals],
  );

  // One query for the whole panel rather than one per BOQ. Empty for anyone
  // without cost authority, which is the answer, not a failure.
  const { data: costLines = [] } = useQuery({
    queryKey: ["boq-item-costs"],
    queryFn: async () => (await supabase.from("boq_item_costs").select("*")).data ?? [],
  });
  const rateByItem = useMemo(
    () => new Map(costLines.map((r: any) => [r.id, r.unit_rate])),
    [costLines],
  );
  const canSeeCost = costLines.length > 0;

  const { data: opps = [] } = useQuery({
    queryKey: ["opps-for-boq"],
    queryFn: async () =>
      (
        await supabase
          .from("opportunities")
          .select("id, project_name")
          .not("stage", "in", "(won,lost,archived)")
          .order("project_name")
      ).data ?? [],
  });

  const statusLabel = (s: BoqStatus) => t(`boq_status_${s}` as never);

  const filtered = useMemo(
    () => (statusFilter === "all" ? boqs : boqs.filter((b: any) => b.status === statusFilter)),
    [boqs, statusFilter],
  );

  const kpis = useMemo(() => {
    const verified = boqs.filter((b: any) => b.status === "verified").length;
    const estimated = boqs.filter((b: any) => b.status === "estimated_scope").length;
    const missing = boqs.filter((b: any) => b.status === "missing").length;
    // Selling, not cost. boqs.estimated_value used to be the headline here, but
    // the AI extractor writes it as SUM(quantity * unit_rate) — a cost roll-up
    // wearing a neutral name — so it is no longer readable and no longer shown.
    const totalValue = boqs.reduce((s: number, b: any) => s + (sellingByBoq.get(b.id) ?? 0), 0);
    return { total: boqs.length, verified, estimated, missing, totalValue };
  }, [boqs, sellingByBoq]);

  return (
    <div>
      <PageHeader
        eyebrow={t("nav_commercial" as never) || "Commercial"}
        title={t("nav_boq")}
        description={t("dialog_new_boq_desc")}
        actions={
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs font-medium text-amber-light hover:bg-amber/20"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("action_new_boq")}
          </button>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={t("nav_boq")} value={kpis.total} icon={<ClipboardList className="h-3.5 w-3.5" />} />
        <KpiCard label={statusLabel("verified")} value={kpis.verified} icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
        <KpiCard label={statusLabel("estimated_scope")} value={kpis.estimated} icon={<AlertCircle className="h-3.5 w-3.5" />} />
        <KpiCard label={t("crm_total_value")} value={formatCurrency(kpis.totalValue, lang)} />
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        <button
          onClick={() => setStatusFilter("all")}
          className={`rounded-full border px-3 py-1.5 text-xs ${statusFilter === "all" ? "border-amber/40 bg-amber/10 text-amber-light" : "border-border text-muted-foreground hover:text-foreground"}`}
        >
          {t("crm_filter_all_types")}
        </button>
        {BOQ_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full border px-3 py-1.5 text-xs ${statusFilter === s ? "border-amber/40 bg-amber/10 text-amber-light" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            {statusLabel(s)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <SkeletonTable rows={5} />
      ) : filtered.length === 0 ? (
        <EmptyState message={t("empty_boqs")} />
      ) : (
        <div className="space-y-3">
          {filtered.map((b: any) => {
            const items = (b.boq_items ?? []).sort(
              (x: any, y: any) => (x.sort_order ?? 0) - (y.sort_order ?? 0),
            );
            const open = expanded === b.id;
            return (
              <div key={b.id} className="rounded-xl border border-border/70 bg-surface/60">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {b.title}
                      </span>
                      <StatusPill tone={boqTone(b.status)}>{statusLabel(b.status)}</StatusPill>
                      <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                        {t("label_confidence")}: {b.source_confidence}
                      </span>
                      <span className="num text-xs text-muted-foreground" data-tabular="true">
                        {items.length} {t("label_items" as never) || "items"}
                      </span>
                    </div>
                    {b.opportunities?.project_name ? (
                      <Link
                        to="/opportunities/$id"
                        params={{ id: b.opportunities.id }}
                        className="mt-1 block truncate text-xs text-muted-foreground hover:underline"
                      >
                        {b.opportunities.project_name}
                        {b.opportunities.client ? ` — ${b.opportunities.client}` : ""}
                      </Link>
                    ) : null}
                    {b.status === "estimated_scope" && b.assumptions ? (
                      <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {t("field_assumptions")}: {b.assumptions}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="num text-end text-sm font-semibold text-foreground" data-tabular="true">
                      {formatCurrency(sellingByBoq.get(b.id) ?? null, lang, b.currency)}
                    </div>
                    <button
                      onClick={() => setAddItemFor(b.id)}
                      className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {t("action_add_item")}
                    </button>
                    <button
                      onClick={() => setExpanded(open ? null : b.id)}
                      className="grid h-8 w-8 place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground"
                      aria-label={t("label_items")}
                    >
                      {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {open ? (
                  <div className="border-t border-border/60 px-5 py-4">
                    {items.length === 0 ? (
                      <div className="text-xs text-muted-foreground">—</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-start uppercase tracking-[0.12em] text-muted-foreground">
                              <th className="py-2 text-start font-medium">{t("field_sign_type")}</th>
                              <th className="py-2 text-start font-medium">{t("field_size")}</th>
                              <th className="py-2 text-start font-medium">{t("field_material")}</th>
                              <th className="py-2 text-start font-medium">{t("field_location")}</th>
                              <th className="py-2 text-end font-medium">{t("field_quantity")}</th>
                              {canSeeCost ? (
                                <th className="py-2 text-end font-medium">{t("field_unit_rate")}</th>
                              ) : null}
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((it: any) => (
                              <tr key={it.id} className="border-t border-border/40 text-foreground">
                                <td className="py-2">{it.sign_type}</td>
                                <td className="py-2">{it.size ?? "—"}</td>
                                <td className="py-2">{it.material ?? "—"}</td>
                                <td className="py-2">{it.location ?? "—"}</td>
                                <td className="num py-2 text-end" data-tabular="true">
                                  {formatNumber(it.quantity, lang)}
                                </td>
                                {canSeeCost ? (
                                  <td className="num py-2 text-end" data-tabular="true">
                                    {formatCurrency(rateByItem.get(it.id) ?? null, lang)}
                                  </td>
                                ) : null}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <ActionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("dialog_new_boq_title")}
        description={t("dialog_new_boq_desc")}
        submitLabel={t("action_new_boq")}
        fields={[
          {
            key: "opportunityId",
            type: "select",
            label: t("field_opportunity"),
            required: true,
            options: opps.map((o: any) => ({ value: o.id, label: o.project_name })),
          },
          { key: "title", type: "text", label: t("field_boq_title"), required: true },
          {
            key: "status",
            type: "select",
            label: t("field_boq_status"),
            required: true,
            defaultValue: "estimated_scope",
            options: BOQ_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })),
          },
          { key: "source", type: "text", label: t("field_boq_source") },
          {
            key: "sourceConfidence",
            type: "select",
            label: t("label_confidence"),
            defaultValue: "low",
            options: [
              { value: "high", label: "High" },
              { value: "medium", label: "Medium" },
              { value: "low", label: "Low" },
            ],
          },
          { key: "estimatedValue", type: "text", label: t("field_estimated_value") },
          { key: "assumptions", type: "textarea", label: t("field_assumptions") },
          { key: "missingItems", type: "textarea", label: t("field_missing_items") },
          { key: "fileUrl", type: "file", label: t("field_boq_source"), folder: "boq" },
        ]}
        onSubmit={async (v) => {
          try {
            await createBoq({
              opportunityId: v.opportunityId,
              title: v.title,
              status: v.status as BoqStatus,
              source: v.source || undefined,
              sourceConfidence: (v.sourceConfidence || "low") as "high" | "medium" | "low",
              assumptions: v.assumptions || undefined,
              missingItems: v.missingItems || undefined,
              estimatedValue: v.estimatedValue ? Number(v.estimatedValue) : null,
              fileUrl: v.fileUrl || null,
            });
            toast.success(t("toast_boq_created"));
            qc.invalidateQueries({ queryKey: ["boqs"] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />

      <ActionDialog
        open={!!addItemFor}
        onOpenChange={(v) => !v && setAddItemFor(null)}
        title={t("dialog_add_item_title")}
        submitLabel={t("action_add_item")}
        fields={[
          { key: "signType", type: "text", label: t("field_sign_type"), required: true },
          { key: "size", type: "text", label: t("field_size") },
          { key: "material", type: "text", label: t("field_material") },
          { key: "quantity", type: "text", label: t("field_quantity") },
          { key: "location", type: "text", label: t("field_location") },
          { key: "unitRate", type: "text", label: t("field_unit_rate") },
        ]}
        onSubmit={async (v) => {
          try {
            await addBoqItem({
              boqId: addItemFor!,
              signType: v.signType,
              size: v.size || undefined,
              material: v.material || undefined,
              quantity: v.quantity ? Number(v.quantity) : null,
              location: v.location || undefined,
              unitRate: v.unitRate ? Number(v.unitRate) : null,
            });
            toast.success(t("toast_boq_item_added"));
            qc.invalidateQueries({ queryKey: ["boqs"] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}
