import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Inbox as InboxIcon, AlertTriangle, CheckCircle2, Archive as ArchiveIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog, type DialogField } from "@/components/phc/ActionDialog";
import { useI18n, formatCurrency } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { listTeamMembers } from "@/lib/opportunity-actions";
import {
  createInboxItem, classifyInboxItem, checkInboxDuplicates,
  convertInboxToCompany, convertInboxToContact, convertInboxToProject,
  convertInboxToRfq, convertInboxToTender, convertInboxToOpportunityCandidate,
  sendInboxToMissingData, markInboxDuplicate, archiveInboxItem,
  INBOX_SOURCE_TYPES, INBOX_CLASSIFICATIONS,
  type InboxClassification, type DuplicateCandidate,
} from "@/lib/inbox-actions";

export const Route = createFileRoute("/_authenticated/lead-tender-inbox")({
  head: () => ({ meta: [{ title: "Lead & Tender Inbox — PHC" }, { name: "robots", content: "noindex" }] }),
  component: LeadTenderInbox,
});

function humanize(s: string | null | undefined) {
  if (!s) return "—";
  return s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusTone(s: string): "positive" | "attention" | "danger" | "muted" | "neutral" {
  if (s === "converted") return "positive";
  if (s === "marked_duplicate" || s === "archived") return "muted";
  if (s === "sent_to_missing_data") return "danger";
  if (s === "in_review") return "attention";
  return "neutral";
}

function newIntakeFields(t: (k: string) => string, teamMembers: any[]): DialogField[] {
  return [
    { key: "sourceType", type: "select", label: t("ibx_source_type"), required: true, options: INBOX_SOURCE_TYPES.map((s) => ({ value: s, label: t(`src_${s}`) })) },
    { key: "sourceName", type: "text", label: t("ibx_source_name") },
    { key: "companyName", type: "text", label: t("ibx_company_name") },
    { key: "contactName", type: "text", label: t("ibx_contact_name") },
    { key: "phone", type: "text", label: t("label_phone") },
    { key: "email", type: "text", label: t("email") },
    { key: "projectName", type: "text", label: t("label_project") },
    { key: "clientOwner", type: "text", label: t("ibx_client_owner") },
    { key: "mainContractor", type: "text", label: t("label_contractor") },
    { key: "consultant", type: "text", label: t("ibx_consultant") },
    { key: "scope", type: "textarea", label: t("ibx_scope") },
    { key: "location", type: "text", label: t("label_location") },
    { key: "estimatedValue", type: "text", label: t("ibx_estimated_value") },
    { key: "deadline", type: "date", label: t("ibx_deadline") },
    { key: "notes", type: "textarea", label: t("wf_notes") },
    { key: "evidenceUrl", type: "file", label: t("ibx_evidence_url"), folder: "inbox" },
    { key: "assignedOwnerId", type: "select", label: t("ibx_assigned_owner"), options: [{ value: "", label: "—" }, ...teamMembers.map((p: any) => ({ value: p.id, label: p.full_name || p.email }))] },
    { key: "nextAction", type: "text", label: t("label_next_action") },
    { key: "followUpDate", type: "date", label: t("ibx_follow_up_date") },
  ];
}

function DuplicateWarning({ checking, candidates, t }: { checking: boolean; candidates: DuplicateCandidate[]; t: (k: string) => string }) {
  if (checking) return <span className="text-amber-light">{t("ibx_checking_duplicates")}</span>;
  if (candidates.length === 0) return <span className="text-emerald-300">{t("ibx_no_duplicates")}</span>;
  return (
    <div className="text-amber-light">
      <div className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-3.5 w-3.5" /> {t("ibx_duplicates_found")}</div>
      <ul className="mt-1 space-y-0.5 text-muted-foreground">
        {candidates.map((c) => (
          <li key={`${c.table}-${c.id}`}>• {humanize(c.table)}: {c.label} ({c.matchedOn})</li>
        ))}
      </ul>
    </div>
  );
}

function LeadTenderInbox() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const uid = user?.id ?? "";
  const qc = useQueryClient();
  const [newItem, setNewItem] = useState(false);
  const [classifyFor, setClassifyFor] = useState<any | null>(null);
  const [convertFor, setConvertFor] = useState<any | null>(null);
  const [missingDataFor, setMissingDataFor] = useState<any | null>(null);
  const [duplicateFor, setDuplicateFor] = useState<any | null>(null);
  const [archiveFor, setArchiveFor] = useState<any | null>(null);
  const [statusFilter, setStatusFilter] = useState<"active" | "all">("active");
  const [query, setQuery] = useState("");
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [markDupCandidates, setMarkDupCandidates] = useState<DuplicateCandidate[]>([]);

  const { data: items = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["inbox-items"],
    queryFn: async () => (await supabase.from("inbox_items").select("*").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: teamMembers = [] } = useQuery({ queryKey: ["team-members-min"], queryFn: listTeamMembers });
  const { data: companies = [] } = useQuery({
    queryKey: ["companies-min"],
    queryFn: async () => (await supabase.from("companies").select("id, name").order("name")).data ?? [],
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects-min"],
    queryFn: async () => (await supabase.from("projects").select("id, name").order("name")).data ?? [],
  });
  const teamMap = useMemo(() => new Map((teamMembers as any[]).map((p) => [p.id, p.full_name || p.email || "—"])), [teamMembers]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["inbox-items"] });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((x: any) => statusFilter === "all" || !["converted", "marked_duplicate", "archived"].includes(x.status))
      .filter((x: any) =>
        !q ||
        (x.company_name ?? "").toLowerCase().includes(q) ||
        (x.project_name ?? "").toLowerCase().includes(q) ||
        (x.contact_name ?? "").toLowerCase().includes(q),
      );
  }, [items, statusFilter, query]);

  const kpis = useMemo(() => {
    const total = items.length;
    const newCount = items.filter((x: any) => x.status === "new").length;
    const inReview = items.filter((x: any) => x.status === "in_review").length;
    const missingData = items.filter((x: any) => x.status === "sent_to_missing_data").length;
    const converted = items.filter((x: any) => x.status === "converted").length;
    return { total, newCount, inReview, missingData, converted };
  }, [items]);

  const runDuplicateCheck = async (x: any) => {
    setCheckingDuplicates(true);
    try {
      const found = await checkInboxDuplicates({ companyName: x.company_name, phone: x.phone, email: x.email, projectName: x.project_name });
      setDuplicates(found);
    } finally {
      setCheckingDuplicates(false);
    }
  };

  const openConvert = async (x: any) => {
    setConvertFor(x);
    setDuplicates([]);
    if (x.classification === "company" || x.classification === "contact" || x.classification === "project") {
      await runDuplicateCheck(x);
    }
  };

  const openMarkDuplicate = async (x: any) => {
    setDuplicateFor(x);
    setMarkDupCandidates(await checkInboxDuplicates({ companyName: x.company_name, phone: x.phone, email: x.email, projectName: x.project_name }));
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Execution"
        title={t("ibx_title")}
        description={t("ibx_intro")}
        actions={
          <button onClick={() => setNewItem(true)} className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs font-medium text-amber-light hover:bg-amber/20">
            <Plus className="h-3.5 w-3.5" />
            {t("ibx_new_item")}
          </button>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label={t("ibx_title")} value={kpis.total} icon={<InboxIcon className="h-3.5 w-3.5" />} />
        <KpiCard label={t("ibxst_new")} value={kpis.newCount} />
        <KpiCard label={t("ibxst_in_review")} value={kpis.inReview} />
        <KpiCard label={t("ibxst_sent_to_missing_data")} value={kpis.missingData} icon={<AlertTriangle className="h-3.5 w-3.5" />} />
        <KpiCard label={t("ibxst_converted")} value={kpis.converted} icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
      </div>

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search company, project, contact"
            className="w-full rounded-md border border-border bg-surface/60 py-2 pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-border-strong focus:outline-none"
          />
        </div>
        <div className="flex rounded-md border border-border p-0.5">
          {(["active", "all"] as const).map((v) => (
            <button key={v} onClick={() => setStatusFilter(v)} className={`rounded px-2.5 py-1 text-[11px] capitalize ${statusFilter === v ? "bg-surface text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <SkeletonTable rows={6} />
      ) : isError ? (
        <div className="rounded-xl border border-border/70 bg-surface/60 p-6 text-sm">
          <div className="text-foreground">{t("error_generic")}</div>
          <button onClick={() => refetch()} className="mt-3 rounded-md border border-border bg-surface px-3 py-1.5 text-xs hover:bg-muted">{t("retry")}</button>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState message={t("wf_no_records")} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((x: any) => (
            <div key={x.id} className="rounded-md border border-border/70 bg-background/40 px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <span className="truncate text-sm font-medium text-foreground">{x.company_name || x.project_name || x.contact_name || t("wf_source")}</span>
                <StatusPill tone={statusTone(x.status)}>{t(`ibxst_${x.status}` as never)}</StatusPill>
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{t(`src_${x.source_type}` as never)}{x.source_name ? ` · ${x.source_name}` : ""}</div>
              {x.project_name && x.company_name ? <div className="mt-1 truncate text-[11px] text-muted-foreground">{t("label_project")}: {x.project_name}</div> : null}
              {x.contact_name ? <div className="truncate text-[11px] text-muted-foreground">{x.contact_name}{x.phone ? ` · ${x.phone}` : ""}{x.email ? ` · ${x.email}` : ""}</div> : null}
              {x.estimated_value != null ? <div className="mt-1 text-xs text-muted-foreground num" data-tabular="true">{formatCurrency(x.estimated_value, lang, "SAR")}</div> : null}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                <StatusPill tone="muted">{t(`cls_${x.classification}` as never)}</StatusPill>
                <span>{t("label_owner")}: {x.assigned_owner_id ? teamMap.get(x.assigned_owner_id) ?? "—" : "—"}</span>
              </div>
              {x.next_action ? <div className="mt-1 text-[11px] text-muted-foreground"><span className="text-amber-light">{t("label_next_action")}:</span> {x.next_action}</div> : null}

              {x.status === "new" || x.status === "in_review" ? (
                <div className="mt-2 flex flex-wrap justify-end gap-1 border-t border-border/60 pt-1.5">
                  <button onClick={() => setClassifyFor(x)} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                    {t("ibx_classify")}
                  </button>
                  {x.classification !== "unclassified" && x.classification !== "signal_watchlist" && x.classification !== "duplicate" && x.classification !== "incomplete" ? (
                    <button onClick={() => openConvert(x)} className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/20">
                      {t("ibx_convert")}
                    </button>
                  ) : null}
                  <button onClick={() => setMissingDataFor(x)} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                    {t("ibx_send_missing_data")}
                  </button>
                  <button onClick={() => openMarkDuplicate(x)} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                    {t("ibx_mark_duplicate")}
                  </button>
                  <button onClick={() => setArchiveFor(x)} className="rounded border border-border p-1 text-muted-foreground hover:text-foreground" title={t("ibx_archive")}>
                    <ArchiveIcon className="h-3 w-3" />
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <ActionDialog
        open={newItem}
        onOpenChange={setNewItem}
        title={t("ibx_new_item")}
        submitLabel={t("crm_add")}
        fields={newIntakeFields((k) => t(k as never), teamMembers)}
        onSubmit={async (v) => {
          if (!v.sourceType) { toast.error(t("ibx_no_source")); return; }
          try {
            await createInboxItem({
              sourceType: v.sourceType as never,
              sourceName: v.sourceName || undefined,
              companyName: v.companyName || undefined,
              contactName: v.contactName || undefined,
              phone: v.phone || undefined,
              email: v.email || undefined,
              projectName: v.projectName || undefined,
              clientOwner: v.clientOwner || undefined,
              mainContractor: v.mainContractor || undefined,
              consultant: v.consultant || undefined,
              scope: v.scope || undefined,
              location: v.location || undefined,
              estimatedValue: v.estimatedValue ? Number(v.estimatedValue) : null,
              deadline: v.deadline || null,
              notes: v.notes || undefined,
              evidenceUrl: v.evidenceUrl || undefined,
              assignedOwnerId: v.assignedOwnerId || uid,
              nextAction: v.nextAction || undefined,
              followUpDate: v.followUpDate || null,
            });
            toast.success(t("crm_saved"));
            refresh();
          } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
        }}
      />

      <ActionDialog
        open={!!classifyFor}
        onOpenChange={(o) => !o && setClassifyFor(null)}
        title={t("ibx_classify")}
        submitLabel={t("ibx_classify")}
        fields={[
          { key: "classification", type: "select", label: t("wf_classification"), required: true, defaultValue: classifyFor?.classification ?? "unclassified", options: INBOX_CLASSIFICATIONS.map((c) => ({ value: c, label: t(`cls_${c}`) })) },
        ]}
        onSubmit={async (v) => {
          if (!classifyFor) return;
          try {
            await classifyInboxItem(classifyFor.id, v.classification as InboxClassification);
            toast.success(t("crm_saved"));
            refresh();
          } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
        }}
      />

      <ActionDialog
        open={!!convertFor}
        onOpenChange={(o) => !o && setConvertFor(null)}
        title={convertFor ? `${t("ibx_convert")}: ${t(`cls_${convertFor.classification}` as never)}` : ""}
        description={<DuplicateWarning checking={checkingDuplicates} candidates={duplicates} t={(k) => t(k as never)} />}
        submitLabel={t("ibx_convert")}
        fields={
          !convertFor ? [] :
          convertFor.classification === "company" ? [
            { key: "name", type: "text", label: t("ibx_company_name"), required: true, defaultValue: convertFor.company_name ?? "" },
            { key: "companyType", type: "select", label: t("wf_classification"), required: true, options: ["main_contractor", "developer", "owner", "consultant", "existing_client", "previous_client", "target_account", "vendor"].map((c) => ({ value: c, label: t(`company_type_${c}` as never) })) },
          ] :
          convertFor.classification === "contact" ? [
            { key: "name", type: "text", label: t("ibx_contact_name"), required: true, defaultValue: convertFor.contact_name ?? "" },
            { key: "companyId", type: "select", label: t("ibx_company_name"), options: [{ value: "", label: "—" }, ...companies.map((c: any) => ({ value: c.id, label: c.name }))] },
            { key: "phone", type: "text", label: t("label_phone"), defaultValue: convertFor.phone ?? "" },
            { key: "email", type: "text", label: t("email"), defaultValue: convertFor.email ?? "" },
          ] :
          convertFor.classification === "project" ? [
            { key: "name", type: "text", label: t("label_project"), required: true, defaultValue: convertFor.project_name ?? "" },
            { key: "location", type: "text", label: t("label_location"), defaultValue: convertFor.location ?? "" },
            { key: "ownerCompanyId", type: "select", label: t("ibx_client_owner"), options: [{ value: "", label: "—" }, ...companies.map((c: any) => ({ value: c.id, label: c.name }))] },
            { key: "mainContractorId", type: "select", label: t("label_contractor"), options: [{ value: "", label: "—" }, ...companies.map((c: any) => ({ value: c.id, label: c.name }))] },
            { key: "consultantId", type: "select", label: t("ibx_consultant"), options: [{ value: "", label: "—" }, ...companies.map((c: any) => ({ value: c.id, label: c.name }))] },
            { key: "totalValue", type: "text", label: t("ibx_estimated_value"), defaultValue: convertFor.estimated_value != null ? String(convertFor.estimated_value) : "" },
          ] :
          convertFor.classification === "rfq" ? [
            { key: "projectId", type: "select", label: t("label_project"), options: [{ value: "", label: "—" }, ...projects.map((p: any) => ({ value: p.id, label: p.name }))] },
            { key: "companyId", type: "select", label: t("ibx_company_name"), options: [{ value: "", label: "—" }, ...companies.map((c: any) => ({ value: c.id, label: c.name }))] },
            { key: "responseDueDate", type: "date", label: t("ibx_deadline"), defaultValue: convertFor.deadline ?? "" },
            { key: "estimatedValue", type: "text", label: t("ibx_estimated_value"), defaultValue: convertFor.estimated_value != null ? String(convertFor.estimated_value) : "" },
          ] :
          convertFor.classification === "tender" ? [
            { key: "tenderName", type: "text", label: t("nav_tenders"), required: true, defaultValue: convertFor.project_name ?? "" },
            { key: "source", type: "text", label: t("wf_source"), defaultValue: convertFor.source_name ?? "" },
            { key: "projectId", type: "select", label: t("nav_projects"), options: [{ value: "", label: "—" }, ...projects.map((p: any) => ({ value: p.id, label: p.name }))] },
            { key: "expectedAwardDate", type: "date", label: t("wf_expected_award"), defaultValue: convertFor.deadline ?? "" },
            { key: "estimatedProjectValue", type: "text", label: t("ibx_estimated_value"), defaultValue: convertFor.estimated_value != null ? String(convertFor.estimated_value) : "" },
          ] :
          convertFor.classification === "opportunity_candidate" ? [
            { key: "projectName", type: "text", label: t("label_project"), required: true, defaultValue: convertFor.project_name ?? "" },
            { key: "source", type: "text", label: t("wf_source"), defaultValue: convertFor.source_name ?? "" },
            { key: "location", type: "text", label: t("label_location"), defaultValue: convertFor.location ?? "" },
            { key: "mainContractorGuess", type: "text", label: t("label_contractor"), defaultValue: convertFor.main_contractor ?? "" },
            { key: "estimatedValue", type: "text", label: t("ibx_estimated_value"), defaultValue: convertFor.estimated_value != null ? String(convertFor.estimated_value) : "" },
          ] : []
        }
        onSubmit={async (v) => {
          if (!convertFor) return;
          try {
            if (convertFor.classification === "company") {
              await convertInboxToCompany(convertFor.id, { name: v.name, companyType: v.companyType as never, claimOwner: true });
            } else if (convertFor.classification === "contact") {
              await convertInboxToContact(convertFor.id, { name: v.name, companyId: v.companyId || null, phone: v.phone || undefined, email: v.email || undefined, claimOwner: true });
            } else if (convertFor.classification === "project") {
              await convertInboxToProject(convertFor.id, {
                name: v.name, location: v.location || undefined,
                ownerCompanyId: v.ownerCompanyId || null, mainContractorId: v.mainContractorId || null, consultantId: v.consultantId || null,
                totalValue: v.totalValue ? Number(v.totalValue) : null,
              });
            } else if (convertFor.classification === "rfq") {
              await convertInboxToRfq(convertFor.id, {
                projectId: v.projectId || null, companyId: v.companyId || null,
                responseDueDate: v.responseDueDate || null, estimatedValue: v.estimatedValue ? Number(v.estimatedValue) : null, claimOwner: true,
              });
            } else if (convertFor.classification === "tender") {
              await convertInboxToTender(convertFor.id, {
                tenderName: v.tenderName, source: v.source || undefined, projectId: v.projectId || null,
                expectedAwardDate: v.expectedAwardDate || null, estimatedProjectValue: v.estimatedProjectValue ? Number(v.estimatedProjectValue) : null, claimOwner: true,
              });
            } else if (convertFor.classification === "opportunity_candidate") {
              await convertInboxToOpportunityCandidate(convertFor.id, {
                projectName: v.projectName, source: v.source || undefined, location: v.location || undefined,
                mainContractorGuess: v.mainContractorGuess || undefined, estimatedValue: v.estimatedValue ? Number(v.estimatedValue) : null,
              });
            }
            toast.success(t("crm_saved"));
            refresh();
          } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
        }}
      />

      <ActionDialog
        open={!!missingDataFor}
        onOpenChange={(o) => !o && setMissingDataFor(null)}
        title={t("ibx_send_missing_data")}
        submitLabel={t("ibx_send_missing_data")}
        fields={[{ key: "reason", type: "textarea", label: t("ibx_missing_data_reason"), required: true }]}
        onSubmit={async (v) => {
          if (!missingDataFor) return;
          try {
            await sendInboxToMissingData(missingDataFor.id, v.reason);
            toast.success(t("crm_saved"));
            refresh();
          } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
        }}
      />

      <ActionDialog
        open={!!duplicateFor}
        onOpenChange={(o) => !o && setDuplicateFor(null)}
        title={t("ibx_mark_duplicate")}
        description={markDupCandidates.length === 0 ? t("ibx_no_duplicates") : undefined}
        submitLabel={t("ibx_mark_duplicate")}
        fields={
          markDupCandidates.length > 0
            ? [{ key: "duplicateOf", type: "select", label: t("ibx_duplicate_of"), required: true, options: markDupCandidates.map((c) => ({ value: `${c.table}:${c.id}`, label: `${humanize(c.table)}: ${c.label} (${c.matchedOn})` })) }]
            : [
                { key: "duplicateOfType", type: "select", label: t("ibx_duplicate_of"), required: true, options: [{ value: "companies", label: "Company" }, { value: "contacts", label: "Contact" }, { value: "projects", label: "Project" }, { value: "rfqs", label: "RFQ" }, { value: "tenders", label: "Tender" }] },
                { key: "duplicateOfId", type: "text", label: "Record ID", required: true },
              ]
        }
        onSubmit={async (v) => {
          if (!duplicateFor) return;
          try {
            if (v.duplicateOf) {
              const [type, id] = v.duplicateOf.split(":");
              await markInboxDuplicate(duplicateFor.id, { type, id });
            } else {
              await markInboxDuplicate(duplicateFor.id, { type: v.duplicateOfType, id: v.duplicateOfId });
            }
            toast.success(t("crm_saved"));
            refresh();
          } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
        }}
      />

      <ActionDialog
        open={!!archiveFor}
        onOpenChange={(o) => !o && setArchiveFor(null)}
        title={t("ibx_archive")}
        submitLabel={t("ibx_archive")}
        fields={[{ key: "reason", type: "textarea", label: t("ibx_archive_reason"), required: true }]}
        onSubmit={async (v) => {
          if (!archiveFor) return;
          try {
            await archiveInboxItem(archiveFor.id, v.reason);
            toast.success(t("crm_saved"));
            refresh();
          } catch (e) { toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")); }
        }}
      />
    </div>
  );
}
