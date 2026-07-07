import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n } from "@/lib/i18n";
import { createCompany, type CompanyType, type AccountStatus } from "@/lib/crm-actions";

export const Route = createFileRoute("/_authenticated/accounts")({
  head: () => ({
    meta: [{ title: "Accounts — PHC" }, { name: "robots", content: "noindex" }],
  }),
  component: AccountsPage,
});

const COMPANY_TYPES: CompanyType[] = [
  "main_contractor",
  "developer",
  "owner",
  "consultant",
  "existing_client",
  "previous_client",
  "target_account",
  "vendor",
  "do_not_target",
];

function statusTone(s: AccountStatus): "positive" | "attention" | "muted" | "danger" {
  if (s === "active") return "positive";
  if (s === "pending_review") return "attention";
  if (s === "do_not_target") return "danger";
  return "muted";
}

function AccountsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<CompanyType | "all">("all");
  const [query, setQuery] = useState("");

  const { data: companies = [], isLoading } = useQuery({
    queryKey: ["companies"],
    queryFn: async () =>
      (
        await supabase
          .from("companies")
          .select("*, projects:projects!projects_main_contractor_id_fkey(id), contacts(id)")
          .order("updated_at", { ascending: false })
      ).data ?? [],
  });

  const typeLabel = (ct: CompanyType) => t(`company_type_${ct}` as never);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return companies
      .filter((c: any) => typeFilter === "all" || c.company_type === typeFilter)
      .filter(
        (c: any) =>
          !q ||
          (c.name && c.name.toLowerCase().includes(q)) ||
          (c.regions && c.regions.toLowerCase().includes(q)),
      );
  }, [companies, typeFilter, query]);

  const kpis = useMemo(() => {
    const active = companies.filter((c: any) => c.account_status === "active").length;
    const pending = companies.filter((c: any) => c.account_status === "pending_review").length;
    const dnt = companies.filter((c: any) => c.account_status === "do_not_target").length;
    return { total: companies.length, active, pending, dnt };
  }, [companies]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow={t("nav_crm" as never) || "CRM"}
        title={t("nav_accounts")}
        description={t("crm_accounts_intro" as never) || undefined}
        actions={
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs font-medium text-amber-light hover:bg-amber/20"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("crm_new_account")}
          </button>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={t("nav_accounts")} value={kpis.total} icon={<Building2 className="h-3.5 w-3.5" />} />
        <KpiCard label={t("account_status_active" as never) || "Active"} value={kpis.active} />
        <KpiCard label={t("crm_pending_review")} value={kpis.pending} />
        <KpiCard label={t("account_status_do_not_target" as never) || "Do not target"} value={kpis.dnt} />
      </div>

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("crm_search_accounts" as never) || "Search accounts"}
            className="w-full rounded-md border border-border bg-surface/60 py-2 pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-border-strong focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setTypeFilter("all")}
            className={`rounded-full border px-3 py-1 text-xs ${typeFilter === "all" ? "border-amber/40 bg-amber/10 text-amber-light" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            {t("crm_filter_all_types")}
          </button>
          {COMPANY_TYPES.map((ct) => (
            <button
              key={ct}
              onClick={() => setTypeFilter(ct)}
              className={`rounded-full border px-3 py-1 text-xs ${typeFilter === ct ? "border-amber/40 bg-amber/10 text-amber-light" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {typeLabel(ct)}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <EmptyState message={t("loading")} />
      ) : filtered.length === 0 ? (
        <EmptyState message={t("crm_no_accounts")} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((c: any) => (
            <Link
              key={c.id}
              to="/accounts/$id"
              params={{ id: c.id }}
              className="group rounded-xl border border-border/70 bg-surface/60 px-5 py-4 transition-colors hover:border-border-strong/70 hover:bg-surface"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{c.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{typeLabel(c.company_type)}</div>
                </div>
                <StatusPill tone={statusTone(c.account_status)}>
                  {c.account_status === "pending_review" ? t("crm_pending_review") : t(`account_status_${c.account_status}` as never)}
                </StatusPill>
              </div>
              <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
                <span className="num" data-tabular="true">{t("crm_linked_projects")}: {c.projects?.length ?? 0}</span>
                <span className="num" data-tabular="true">{t("crm_linked_contacts")}: {c.contacts?.length ?? 0}</span>
                {c.regions ? <span className="truncate">{c.regions}</span> : null}
              </div>
            </Link>
          ))}
        </div>
      )}

      <ActionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("crm_new_account")}
        description={t("crm_pending_review")}
        submitLabel={t("crm_add")}
        fields={[
          { key: "name", type: "text", label: t("crm_company"), required: true },
          {
            key: "companyType",
            type: "select",
            label: t("crm_filter_all_types"),
            required: true,
            defaultValue: "target_account",
            options: COMPANY_TYPES.map((ct) => ({ value: ct, label: typeLabel(ct) })),
          },
          { key: "regions", type: "text", label: t("crm_regions") },
          { key: "relationshipLevel", type: "text", label: t("crm_relationship") },
          { key: "nextAction", type: "text", label: t("crm_next_action") },
          { key: "internalNotes", type: "textarea", label: t("crm_internal_notes") },
        ]}
        onSubmit={async (v) => {
          try {
            await createCompany({
              name: v.name,
              companyType: v.companyType as CompanyType,
              regions: v.regions || undefined,
              relationshipLevel: v.relationshipLevel || undefined,
              nextAction: v.nextAction || undefined,
              internalNotes: v.internalNotes || undefined,
              claimOwner: true,
            });
            toast.success(t("crm_saved"));
            qc.invalidateQueries({ queryKey: ["companies"] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}
