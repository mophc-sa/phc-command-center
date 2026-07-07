import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SectionHeader } from "@/components/phc/SectionHeader";
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
  const filtered =
    typeFilter === "all" ? companies : companies.filter((c: any) => c.company_type === typeFilter);

  return (
    <div className="mx-auto max-w-7xl">
      <SectionHeader
        title={t("nav_accounts")}
        count={filtered.length}
        action={
          <button
            onClick={() => setCreateOpen(true)}
            className="rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs text-amber-light hover:bg-amber/20"
          >
            {t("crm_new_account")}
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
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
              className="rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:border-amber/30"
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
              <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                <span>{t("crm_linked_projects")}: {c.projects?.length ?? 0}</span>
                <span>{t("crm_linked_contacts")}: {c.contacts?.length ?? 0}</span>
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
