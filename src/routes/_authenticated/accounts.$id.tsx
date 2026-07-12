import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { Panel } from "@/components/phc/Panel";
import { DataField } from "@/components/phc/DataField";
import { StatusPill } from "@/components/phc/StatusPill";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonForm } from "@/components/phc/Skeleton";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, formatCurrency } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { updateCompany, changeAccountOwner, type CompanyType } from "@/lib/crm-actions";
import { canAssignOwner } from "@/lib/roles";
import { CommunicationActions } from "@/components/phc/CommunicationActions";
import { CommunicationTimeline } from "@/components/phc/CommunicationTimeline";
import { ArchivedBadge, RecordLifecycleMenu } from "@/components/phc/RecordLifecycleMenu";

export const Route = createFileRoute("/_authenticated/accounts/$id")({
  head: () => ({ meta: [{ title: "Account — PHC" }, { name: "robots", content: "noindex" }] }),
  component: AccountDetail,
});

const COMPANY_TYPES: CompanyType[] = [
  "main_contractor", "developer", "owner", "consultant",
  "existing_client", "previous_client", "target_account", "vendor", "do_not_target",
];

function AccountDetail() {
  const { id } = Route.useParams();
  const { t, lang } = useI18n();
  const { roles } = useAuth();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const isManager = canAssignOwner(roles);

  const { data: company, isLoading } = useQuery({
    queryKey: ["company", id],
    queryFn: async () =>
      (
        await supabase
          .from("companies")
          .select(
            "*, contacts(*), projects:projects!projects_main_contractor_id_fkey(id, name, project_stage, completion_pct), opportunities:opportunities!opportunities_company_id_fkey(id, project_name, stage, estimated_value_max, currency)",
          )
          .eq("id", id)
          .single()
      ).data,
  });

  const { data: team = [] } = useQuery({
    queryKey: ["profiles-min"],
    queryFn: async () => (await supabase.from("profiles").select("id, full_name, email")).data ?? [],
  });
  const ownerName = (uid: string | null) => {
    if (!uid) return t("crm_unassigned");
    const p = team.find((m: any) => m.id === uid);
    return p?.full_name || p?.email || uid;
  };

  if (isLoading) return <SkeletonForm />;
  if (!company) return <EmptyState message={t("crm_no_accounts")} />;
  const c: any = company;
  const typeLabel = (ct: string) => t(`company_type_${ct}` as never);
  const oppCount = c.opportunities?.length ?? 0;
  const projCount = c.projects?.length ?? 0;
  const contactCount = c.contacts?.length ?? 0;
  const pipelineValue = (c.opportunities ?? []).reduce(
    (s: number, o: any) => s + (o.estimated_value_max ?? 0),
    0,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link to="/accounts" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> {t("crm_back_to_accounts")}
      </Link>

      <PageHeader
        eyebrow={typeLabel(c.company_type)}
        title={c.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusPill tone={c.account_status === "active" ? "positive" : c.account_status === "pending_review" ? "attention" : "muted"}>
              {t(`account_status_${c.account_status}` as never)}
            </StatusPill>
            <ArchivedBadge archived={!!c.archived_at} />
            {c.regions ? <span className="text-xs text-muted-foreground">{c.regions}</span> : null}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setEditOpen(true)} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
              {t("crm_edit")}
            </button>
            {isManager && c.account_status === "pending_review" ? (
              <button
                onClick={async () => {
                  try { await updateCompany(c.id, { account_status: "active" }); toast.success(t("crm_saved")); qc.invalidateQueries({ queryKey: ["company", id] }); }
                  catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
                }}
                className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/20"
              >
                {t("crm_mark_active")}
              </button>
            ) : null}
            {isManager ? (
              <button onClick={() => setOwnerOpen(true)} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                {t("crm_reassign_owner")}
              </button>
            ) : null}
            {(() => {
              const primary = (c.contacts ?? []).find((x: any) => !!x.email) ?? (c.contacts ?? [])[0];
              return (
                <CommunicationActions
                  linked={{ type: "company", id: c.id, label: c.name, companyId: c.id, contactId: primary?.id ?? null }}
                  recipientName={primary?.name ?? null}
                  recipientEmail={primary?.email ?? null}
                  recipientPhone={primary?.phone ?? null}
                  emailTemplate="contractor_introduction"
                  emailContext={{
                    companyName: c.name,
                    ownerName: ownerName(c.account_owner_id),
                  }}
                />
              );
            })()}
            <RecordLifecycleMenu
              entityType="companies"
              entityId={c.id}
              roles={roles}
              archived={!!c.archived_at}
              onDone={() => qc.invalidateQueries({ queryKey: ["company", id] })}
            />
          </div>
        }
      />

      {/* Key facts strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-border/70 bg-surface/60 p-4">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t("crm_account_owner")}</div>
          <div className="mt-2 truncate text-sm font-medium text-foreground">{ownerName(c.account_owner_id)}</div>
        </div>
        <div className="rounded-xl border border-border/70 bg-surface/60 p-4">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t("crm_linked_contacts")}</div>
          <div className="mt-2 num text-lg font-semibold text-foreground" data-tabular="true">{contactCount}</div>
        </div>
        <div className="rounded-xl border border-border/70 bg-surface/60 p-4">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t("crm_linked_projects")}</div>
          <div className="mt-2 num text-lg font-semibold text-foreground" data-tabular="true">{projCount}</div>
        </div>
        <div className="rounded-xl border border-border/70 bg-surface/60 p-4">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t("crm_linked_opportunities")}</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="num text-lg font-semibold text-foreground" data-tabular="true">{oppCount}</span>
            {pipelineValue > 0 ? (
              <span className="num text-[11px] text-muted-foreground" data-tabular="true">
                {formatCurrency(pipelineValue, lang)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <Panel title={t("nav_accounts")}>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <DataField label={t("crm_account_owner")} value={ownerName(c.account_owner_id)} />
          <DataField label={t("crm_regions")} value={c.regions} />
          <DataField label={t("crm_relationship")} value={c.relationship_level} />
          <DataField label={t("crm_next_action")} value={c.next_action} />
        </div>
        {c.internal_notes ? (
          <div className="mt-4">
            <DataField label={t("crm_internal_notes")} value={c.internal_notes} />
          </div>
        ) : null}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title={t("crm_linked_contacts")} subtitle={String(contactCount)}>
          {(c.contacts ?? []).length === 0 ? (
            <div className="text-xs text-muted-foreground">—</div>
          ) : (
            <ul className="space-y-2.5">
              {c.contacts.map((ct: any) => (
                <li key={ct.id}>
                  <div className="text-sm text-foreground">
                    {ct.name}
                    {ct.title ? <span className="text-xs text-muted-foreground"> — {ct.title}</span> : null}
                  </div>
                  <div className="mt-1.5">
                    <CommunicationActions
                      linked={{ type: "contact", id: ct.id, label: ct.name, contactId: ct.id, companyId: c.id }}
                      recipientName={ct.name}
                      recipientEmail={ct.email}
                      recipientPhone={ct.phone}
                      emailTemplate="contractor_introduction"
                      emailContext={{ companyName: c.name, ownerName: ownerName(c.account_owner_id) }}
                      size="xs"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t("crm_linked_projects")} subtitle={String(projCount)}>
          {(c.projects ?? []).length === 0 ? (
            <div className="text-xs text-muted-foreground">—</div>
          ) : (
            <ul className="space-y-2">
              {c.projects.map((p: any) => (
                <li key={p.id}>
                  <Link to="/projects/$id" params={{ id: p.id }} className="text-sm text-foreground hover:underline">
                    {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t("crm_linked_opportunities")} subtitle={String(oppCount)}>
          {(c.opportunities ?? []).length === 0 ? (
            <div className="text-xs text-muted-foreground">—</div>
          ) : (
            <ul className="space-y-2">
              {c.opportunities.map((o: any) => (
                <li key={o.id} className="flex items-center justify-between gap-2">
                  <Link to="/opportunities/$id" params={{ id: o.id }} className="truncate text-sm text-foreground hover:underline">
                    {o.project_name}
                  </Link>
                  <span className="num text-xs text-muted-foreground" data-tabular="true">
                    {formatCurrency(o.estimated_value_max, lang, o.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title={t("comm_history")}>
        <CommunicationTimeline filter={{ companyId: c.id }} />
      </Panel>

      <ActionDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title={t("crm_edit")}
        submitLabel={t("crm_add")}
        fields={[
          { key: "name", type: "text", label: t("crm_company"), required: true, defaultValue: c.name },
          { key: "companyType", type: "select", label: t("crm_filter_all_types"), defaultValue: c.company_type, options: COMPANY_TYPES.map((ct) => ({ value: ct, label: typeLabel(ct) })) },
          { key: "regions", type: "text", label: t("crm_regions"), defaultValue: c.regions ?? "" },
          { key: "relationshipLevel", type: "text", label: t("crm_relationship"), defaultValue: c.relationship_level ?? "" },
          { key: "nextAction", type: "text", label: t("crm_next_action"), defaultValue: c.next_action ?? "" },
          { key: "internalNotes", type: "textarea", label: t("crm_internal_notes"), defaultValue: c.internal_notes ?? "" },
        ]}
        onSubmit={async (v) => {
          try {
            await updateCompany(c.id, {
              name: v.name,
              company_type: v.companyType as CompanyType,
              regions: v.regions || null,
              relationship_level: v.relationshipLevel || null,
              next_action: v.nextAction || null,
              internal_notes: v.internalNotes || null,
            });
            toast.success(t("crm_saved"));
            qc.invalidateQueries({ queryKey: ["company", id] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />

      <ActionDialog
        open={ownerOpen}
        onOpenChange={setOwnerOpen}
        title={t("crm_reassign_owner")}
        submitLabel={t("crm_add")}
        fields={[
          {
            key: "ownerId",
            type: "select",
            label: t("crm_account_owner"),
            defaultValue: c.account_owner_id ?? "",
            options: [
              { value: "", label: t("crm_unassigned") },
              ...team.map((m: any) => ({ value: m.id, label: m.full_name || m.email || m.id })),
            ],
          },
        ]}
        onSubmit={async (v) => {
          try {
            await changeAccountOwner(c.id, v.ownerId || null);
            toast.success(t("crm_saved"));
            qc.invalidateQueries({ queryKey: ["company", id] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}
