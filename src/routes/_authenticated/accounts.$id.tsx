import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, ExternalLink, Mail, Pencil, Phone, Trash2, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { Panel } from "@/components/phc/Panel";
import { DataField } from "@/components/phc/DataField";
import { PREQUAL_STATUSES } from "@/lib/stage-checklist";
import { StatusPill } from "@/components/phc/StatusPill";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonForm } from "@/components/phc/Skeleton";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, formatCurrency } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { updateCompany, changeAccountOwner, createContact, updateContact, createOpportunityForCompany, type CompanyType } from "@/lib/crm-actions";
import { contactFieldError } from "@/lib/contact-validation";
import { composePhone } from "@/lib/phone-entry";
import { canAssignOwner, canCreateSalesRecords, canManageSalesPipeline } from "@/lib/roles";
import { ClientRemindersPanel } from "@/components/phc/ClientRemindersPanel";
import { CommunicationActions } from "@/components/phc/CommunicationActions";
import { CommunicationTimeline } from "@/components/phc/CommunicationTimeline";
import { ArchivedBadge, RecordLifecycleMenu } from "@/components/phc/RecordLifecycleMenu";
import { AiRiskAssessment } from "@/components/phc/AiRiskAssessment";
import { sumOpportunityValue } from "@/lib/sales-kpis";

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
  const { user, roles } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [newOppOpen, setNewOppOpen] = useState(false);
  const [accTab, setAccTab] = useState<"contacts" | "opportunities" | "activity" | "details">("contacts");
  const [addContactOpen, setAddContactOpen] = useState(false);
  // Review 81/82 item 4: the sales manager edits or removes a contact's basic details.
  const [editContact, setEditContact] = useState<any | null>(null);
  const isManager = canAssignOwner(roles);
  const canCreateOpp = canManageSalesPipeline(roles);

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
  const pipelineValue = sumOpportunityValue((c.opportunities ?? []) as never).total;

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
                className="rounded-md border border-won/30 bg-won/10 px-3 py-1.5 text-xs text-won hover:bg-won/[0.15] transition-colors duration-150"
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

      {/* Image 11: type and location under the name, the linked project beside it. */}
      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="flex items-center gap-4 rounded-xl border border-border/70 bg-surface/60 p-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><Building2 className="h-7 w-7" aria-hidden="true" /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-foreground">{typeLabel(c.company_type)}</span>
              {c.regions ? <span className="text-sm text-muted-foreground">{c.regions}</span> : null}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {t("crm_account_owner")}: {ownerName(c.account_owner_id)} · {contactCount} {lang === "ar" ? "جهة اتصال" : "contacts"} · {oppCount} {lang === "ar" ? "فرصة" : "opportunities"}
              {pipelineValue > 0 ? ` · ${formatCurrency(pipelineValue, lang)}` : ""}
            </div>
          </div>
        </div>
        {(c.projects ?? [])[0] ? (
          <Link to="/projects/$id" params={{ id: c.projects[0].id }} className="flex items-center gap-3 rounded-xl border border-border/70 bg-surface/60 p-4 hover:border-primary/50">
            <div>
              <div className="text-sm text-muted-foreground">{lang === "ar" ? "المشروع المرتبط" : "Linked project"}{projCount > 1 ? ` (+${projCount - 1})` : ""}</div>
              <div className="text-base font-semibold text-foreground">{c.projects[0].name}</div>
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </Link>
        ) : null}
      </div>

      <div role="tablist" className="flex flex-wrap gap-1.5 border-b border-border">
        {([
          ["contacts", lang === "ar" ? "جهات الاتصال" : "Contacts"],
          ["opportunities", lang === "ar" ? "الفرص" : "Opportunities"],
          ["activity", lang === "ar" ? "النشاط" : "Activity"],
          ["details", lang === "ar" ? "التفاصيل" : "Details"],
        ] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={accTab === k} onClick={() => setAccTab(k)}
            className={"-mb-px min-h-10 border-b-2 px-4 text-sm font-medium " + (accTab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {label}
          </button>
        ))}
      </div>

      {accTab === "contacts" ? (
        <Panel
          title={`${lang === "ar" ? "جهات الاتصال" : "Contacts"} (${contactCount})`}
          action={canCreateSalesRecords(roles) ? (
            <button type="button" onClick={() => setAddContactOpen(true)} className="inline-flex min-h-10 items-center gap-1 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              + {lang === "ar" ? "إضافة جهة اتصال" : "Add contact"}
            </button>
          ) : undefined}
        >
          {(c.contacts ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground">—</div>
          ) : (
            <ul className="divide-y divide-border/60">
              {c.contacts.filter((ct: any) => !ct.archived_at).map((ct: any) => (
                <li key={ct.id} className="flex flex-wrap items-center gap-4 py-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><UserRound className="h-5 w-5" aria-hidden="true" /></span>
                  <div className="min-w-40 flex-1">
                    {/* The name opens WhatsApp when there is a mobile, else email. */}
                    {ct.phone || ct.email ? (
                      <a href={ct.phone ? `https://wa.me/${String(ct.phone).replace(/\D/g, "")}` : `mailto:${ct.email}`} target="_blank" rel="noreferrer"
                        className="text-base font-semibold text-foreground hover:text-primary hover:underline">{ct.name}</a>
                    ) : <div className="text-base font-semibold text-foreground">{ct.name}</div>}
                    <div className="text-sm text-muted-foreground">{ct.title ?? "—"}</div>
                  </div>
                  <div className="flex min-w-52 items-center gap-2 text-sm"><Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{ct.email ?? "—"}</div>
                  <div className="flex min-w-40 items-center gap-2 text-sm tabular-nums"><Phone className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{ct.phone ?? "—"}</div>
                  <CommunicationActions
                    linked={{ type: "contact", id: ct.id, label: ct.name, contactId: ct.id, companyId: c.id }}
                    recipientName={ct.name}
                    recipientEmail={ct.email}
                    recipientPhone={ct.phone}
                    emailTemplate="contractor_introduction"
                    emailContext={{ companyName: c.name, ownerName: ownerName(c.account_owner_id) }}
                    size="xs"
                  />
                  {isManager ? (
                    <span className="flex gap-1">
                      <button type="button" aria-label={lang === "ar" ? "تعديل" : "Edit"} onClick={() => setEditContact(ct)} className="rounded p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="h-4 w-4" aria-hidden="true" /></button>
                      <button type="button" aria-label={lang === "ar" ? "حذف" : "Delete"}
                        onClick={async () => {
                          try {
                            // Archived, not erased: activities and emails still point at it.
                            await updateContact(ct.id, { archived_at: new Date().toISOString(), archived_by: user?.id ?? null, archive_reason: "removed from the account page" } as never);
                            toast.success(lang === "ar" ? "حُذفت جهة الاتصال" : "Contact removed");
                            qc.invalidateQueries({ queryKey: ["company", id] });
                          } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
                        }}
                        className="rounded p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <ActionDialog
            open={addContactOpen}
            onOpenChange={setAddContactOpen}
            title={lang === "ar" ? "إضافة جهة اتصال" : "Add contact"}
            submitLabel={t("crm_add")}
            fields={[
              { key: "name", type: "text", label: lang === "ar" ? "الاسم" : "Name", required: true },
              { key: "title", type: "text", label: lang === "ar" ? "المنصب" : "Title" },
              { key: "email", type: "text", label: t("email") },
              { key: "phone", type: "phone", label: lang === "ar" ? "الجوال" : "Mobile" },
            ]}
            onSubmit={async (v) => {
              const bad = contactFieldError(v.email, v.phone, lang === "ar");
              if (bad) { toast.error(bad); throw new Error(bad); }
              try {
                await createContact({ name: v.name, companyId: c.id, title: v.title || undefined, email: v.email?.trim() || undefined, phone: v.phone ? composePhone(v.phone) : undefined, claimOwner: true });
                toast.success(t("crm_saved"));
                qc.invalidateQueries({ queryKey: ["company", id] });
              } catch (e) {
                toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
                throw e;
              }
            }}
          />
          <ActionDialog
            recordId={editContact?.id}
            open={!!editContact}
            onOpenChange={(o) => !o && setEditContact(null)}
            title={lang === "ar" ? "تعديل جهة الاتصال" : "Edit contact"}
            submitLabel={t("action_save")}
            fields={[
              { key: "name", type: "text", label: lang === "ar" ? "الاسم" : "Name", required: true, defaultValue: editContact?.name ?? "" },
              { key: "title", type: "text", label: lang === "ar" ? "المنصب" : "Title", defaultValue: editContact?.title ?? "" },
              { key: "email", type: "text", label: t("email"), defaultValue: editContact?.email ?? "" },
              { key: "phone", type: "phone", label: lang === "ar" ? "الجوال" : "Mobile", defaultValue: editContact?.phone ?? "" },
            ]}
            onSubmit={async (v) => {
              const bad = contactFieldError(v.email, v.phone, lang === "ar");
              if (bad) { toast.error(bad); throw new Error(bad); }
              try {
                await updateContact(editContact.id, { name: v.name.trim(), title: v.title?.trim() || null, email: v.email?.trim() || null, phone: v.phone ? composePhone(v.phone) : null });
                toast.success(t("crm_saved"));
                await qc.invalidateQueries({ queryKey: ["company", id] });
                setEditContact(null);
              } catch (e) {
                toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
                throw e;
              }
            }}
          />
        </Panel>
      ) : null}

      {accTab === "opportunities" ? (
        <Panel
          title={t("crm_linked_opportunities")}
          subtitle={String(oppCount)}
          action={
            canCreateOpp ? (
              <button
                type="button"
                onClick={() => setNewOppOpen(true)}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {t("crm_new_opportunity")}
              </button>
            ) : undefined
          }
        >
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
          {canCreateOpp ? (
      <ActionDialog
              open={newOppOpen}
              onOpenChange={setNewOppOpen}
              title={t("crm_new_opportunity")}
              submitLabel={t("crm_add")}
              fields={[
                { key: "projectName", type: "text", label: t("label_project"), required: true },
                { key: "location", type: "text", label: t("crm_location"), defaultValue: c.regions ?? "" },
              ]}
              onSubmit={async (v) => {
                try {
                  const opp = await createOpportunityForCompany({
                    companyId: c.id,
                    projectName: v.projectName,
                    location: v.location || null,
                  });
                  toast.success(t("crm_saved"));
                  navigate({ to: "/opportunities/$id", params: { id: opp.id } });
                } catch (e) {
                  toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));

          throw e;
        }
              }}
            />
          ) : null}
        </Panel>
      ) : null}

      {accTab === "details" ? (
        <>
      {/* Key facts strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-border/70 bg-surface/60 p-4">
          <div className="text-2xs font-medium tracking-[0.02em] text-muted-foreground">{t("crm_account_owner")}</div>
          <div className="mt-2 truncate text-sm font-medium text-foreground">{ownerName(c.account_owner_id)}</div>
        </div>
        <div className="rounded-xl border border-border/70 bg-surface/60 p-4">
          <div className="text-2xs font-medium tracking-[0.02em] text-muted-foreground">{t("crm_linked_contacts")}</div>
          <div className="mt-2 num text-lg font-semibold text-foreground" data-tabular="true">{contactCount}</div>
        </div>
        <div className="rounded-xl border border-border/70 bg-surface/60 p-4">
          <div className="text-2xs font-medium tracking-[0.02em] text-muted-foreground">{t("crm_linked_projects")}</div>
          <div className="mt-2 num text-lg font-semibold text-foreground" data-tabular="true">{projCount}</div>
        </div>
        <div className="rounded-xl border border-border/70 bg-surface/60 p-4">
          <div className="text-2xs font-medium tracking-[0.02em] text-muted-foreground">{t("crm_linked_opportunities")}</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="num text-lg font-semibold text-foreground" data-tabular="true">{oppCount}</span>
            {pipelineValue > 0 ? (
              <span className="num text-xs text-muted-foreground" data-tabular="true">
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
          <DataField label={t("label_prequal")} value={t(`prequal_${(c as { prequalification_status?: string }).prequalification_status ?? "not_started"}` as never)} />
        </div>
        {c.internal_notes && !/^\s*[[{]/.test(c.internal_notes) ? (
          <div className="mt-4">
            <DataField label={t("crm_internal_notes")} value={c.internal_notes} />
          </div>
        ) : null}
      </Panel>

          <Panel title={t("crm_linked_projects")} subtitle={String(projCount)}>
            {(c.projects ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground">—</div>
            ) : (
              <ul className="space-y-2">
                {c.projects.map((p: any) => (
                  <li key={p.id}><Link to="/projects/$id" params={{ id: p.id }} className="text-sm text-foreground hover:underline">{p.name}</Link></li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      ) : null}

      {accTab === "activity" ? (
        <>
      <ClientRemindersPanel companyId={c.id} canAdd={canCreateSalesRecords(roles)} currentUserId={user?.id ?? null} />

      <Panel title={t("comm_history")}>
        <CommunicationTimeline filter={{ companyId: c.id }} />
      </Panel>
        </>
      ) : null}

            <details className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer text-sm font-medium">{lang === "ar" ? "تحليل العلاقة وبيانات المصدر" : "Relationship analysis & source details"}</summary>
      <AiRiskAssessment
        entityType="companies"
        entityId={id}
        agentKey="commercial_risk_assessment"
        title={lang === "ar" ? "تقييم صحة العلاقة (AI)" : "Relationship Health (AI)"}
      />

      {/* Extra data from import — dynamic columns preserved from uploaded files */}
      {c.extra_data && Object.keys(c.extra_data).length > 0 ? (
        <Panel title={t("crm_additional_data" as never)}>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
            {Object.entries(c.extra_data as Record<string, string>).map(([key, val]) => (
              <DataField key={key} label={key} value={val} />
            ))}
          </div>
        </Panel>
      ) : null}

      </details>
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
          { key: "prequalificationStatus", type: "select", label: t("label_prequal"), defaultValue: (c as { prequalification_status?: string }).prequalification_status ?? "not_started", options: PREQUAL_STATUSES.map((p) => ({ value: p, label: t(`prequal_${p}` as never) })) },
          { key: "prequalificationNote", type: "text", label: t("prequal_note"), defaultValue: (c as { prequalification_note?: string | null }).prequalification_note ?? "" },
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
              prequalification_status: v.prequalificationStatus,
              prequalification_note: v.prequalificationNote || null,
              next_action: v.nextAction || null,
              internal_notes: v.internalNotes || null,
            });
            toast.success(t("crm_saved"));
            qc.invalidateQueries({ queryKey: ["company", id] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));

          throw e;
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

          throw e;
        }
        }}
      />
    </div>
  );
}
