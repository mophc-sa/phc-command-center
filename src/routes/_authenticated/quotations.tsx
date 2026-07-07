import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, formatCurrency } from "@/lib/i18n";
import {
  createQuotation,
  updateQuotationStatus,
  type QuotationStatus,
} from "@/lib/sales-actions";

export const Route = createFileRoute("/_authenticated/quotations")({
  head: () => ({
    meta: [{ title: "Quotations — PHC" }, { name: "robots", content: "noindex" }],
  }),
  component: QuotationsPage,
});

const STATUSES: QuotationStatus[] = [
  "draft",
  "under_internal_review",
  "approved_for_submission",
  "submitted",
  "follow_up",
  "negotiation",
  "revised",
  "won",
  "lost",
  "expired",
];

const CLOSED: QuotationStatus[] = ["won", "lost", "expired"];

function statusTone(s: QuotationStatus): "positive" | "attention" | "neutral" {
  if (s === "won") return "positive";
  if (s === "lost" || s === "expired") return "attention";
  return "neutral";
}

function QuotationsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [statusFor, setStatusFor] = useState<{ id: string; oppId: string } | null>(null);
  const [filter, setFilter] = useState<"open" | "closed" | "all">("open");

  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ["quotations"],
    queryFn: async () =>
      (
        await supabase
          .from("quotations")
          .select("*, opportunities(id, project_name, client)")
          .order("updated_at", { ascending: false })
      ).data ?? [],
  });

  const { data: opps = [] } = useQuery({
    queryKey: ["opps-for-quote"],
    queryFn: async () =>
      (
        await supabase
          .from("opportunities")
          .select("id, project_name")
          .not("stage", "in", "(won,lost,archived)")
          .order("project_name")
      ).data ?? [],
  });

  const filtered = useMemo(() => {
    if (filter === "all") return quotes;
    return quotes.filter((q: any) =>
      filter === "closed"
        ? CLOSED.includes(q.status)
        : !CLOSED.includes(q.status),
    );
  }, [quotes, filter]);

  const soon = new Date();
  soon.setDate(soon.getDate() + 7);

  const statusLabel = (s: QuotationStatus) => t(`quote_status_${s}` as never);

  return (
    <div className="mx-auto max-w-7xl">
      <SectionHeader
        title={t("nav_quotations")}
        count={filtered.length}
        action={
          <button
            onClick={() => setCreateOpen(true)}
            className="rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs text-amber-light hover:bg-amber/20"
          >
            {t("action_new_quotation")}
          </button>
        }
      />

      <div className="mb-4 flex gap-2">
        {(["open", "closed", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={
              filter === f
                ? "rounded-md bg-sidebar-accent px-3 py-1.5 text-xs text-foreground"
                : "rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            }
          >
            {f === "open"
              ? lang === "ar" ? "مفتوحة" : "Open"
              : f === "closed"
                ? lang === "ar" ? "مغلقة" : "Closed"
                : t("timeline_all")}
          </button>
        ))}
      </div>

      {isLoading ? (
        <EmptyState message={t("loading")} />
      ) : filtered.length === 0 ? (
        <EmptyState message={t("empty_quotations")} />
      ) : (
        <div className="rounded-lg border border-border bg-surface">
          {filtered.map((q: any) => {
            const expired =
              q.valid_until && !CLOSED.includes(q.status) && new Date(q.valid_until) < new Date();
            const expiringSoon =
              !expired &&
              q.valid_until &&
              !CLOSED.includes(q.status) &&
              new Date(q.valid_until) < soon;
            return (
              <div
                key={q.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-border/70 px-4 py-3 first:border-t-0"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="num text-xs font-medium text-foreground" data-tabular="true">
                      {q.quote_number} · v{q.version}
                    </span>
                    <StatusPill tone={statusTone(q.status)}>{statusLabel(q.status)}</StatusPill>
                    {expired ? (
                      <StatusPill tone="attention">{t("expired")}</StatusPill>
                    ) : expiringSoon ? (
                      <StatusPill tone="attention">{t("expiring_soon")}</StatusPill>
                    ) : null}
                  </div>
                  {q.opportunities?.project_name ? (
                    <Link
                      to="/opportunities/$id"
                      params={{ id: q.opportunities.id }}
                      className="mt-1 block truncate text-sm font-medium text-foreground hover:underline"
                    >
                      {q.opportunities.project_name}
                      {q.opportunities.client ? (
                        <span className="text-muted-foreground"> — {q.opportunities.client}</span>
                      ) : null}
                    </Link>
                  ) : null}
                  {q.win_loss_reason ? (
                    <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                      {t("label_win_loss_reason")}: {q.win_loss_reason}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-end">
                    <div className="num text-sm font-semibold text-foreground" data-tabular="true">
                      {formatCurrency(q.value, lang, q.currency)}
                    </div>
                    {q.valid_until ? (
                      <div className="num text-xs text-muted-foreground" data-tabular="true">
                        {t("label_valid_until")}: {q.valid_until}
                      </div>
                    ) : null}
                  </div>
                  {!CLOSED.includes(q.status) ? (
                    <button
                      onClick={() =>
                        setStatusFor({ id: q.id, oppId: q.related_opportunity_id })
                      }
                      className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {t("action_change_status")}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ActionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("dialog_new_quotation_title")}
        description={t("dialog_new_quotation_desc")}
        submitLabel={t("action_new_quotation")}
        fields={[
          {
            key: "opportunityId",
            type: "select",
            label: t("field_opportunity"),
            required: true,
            options: opps.map((o: any) => ({ value: o.id, label: o.project_name })),
          },
          { key: "quoteNumber", type: "text", label: t("field_quote_number"), required: true },
          { key: "value", type: "text", label: t("field_value") },
          { key: "issuedDate", type: "date", label: t("field_issued_date") },
          { key: "validUntil", type: "date", label: t("field_valid_until") },
          { key: "notes", type: "textarea", label: t("field_notes") },
        ]}
        onSubmit={async (v) => {
          try {
            await createQuotation({
              opportunityId: v.opportunityId,
              quoteNumber: v.quoteNumber,
              value: v.value ? Number(v.value) : null,
              issuedDate: v.issuedDate || null,
              validUntil: v.validUntil || null,
              notes: v.notes || undefined,
            });
            toast.success(t("toast_quotation_created"));
            qc.invalidateQueries({ queryKey: ["quotations"] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />

      <ActionDialog
        open={!!statusFor}
        onOpenChange={(v) => !v && setStatusFor(null)}
        title={t("dialog_quote_status_title")}
        description={t("dialog_quote_status_desc")}
        submitLabel={t("action_change_status")}
        fields={[
          {
            key: "status",
            type: "select",
            label: t("field_new_status"),
            required: true,
            options: STATUSES.map((s) => ({ value: s, label: statusLabel(s) })),
          },
          { key: "reason", type: "textarea", label: t("field_reason") },
        ]}
        onSubmit={async (v) => {
          try {
            await updateQuotationStatus({
              quotationId: statusFor!.id,
              opportunityId: statusFor!.oppId,
              status: v.status as QuotationStatus,
              reason: v.reason || undefined,
            });
            toast.success(t("toast_quotation_updated"));
            qc.invalidateQueries({ queryKey: ["quotations"] });
            qc.invalidateQueries({ queryKey: ["opps"] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}
