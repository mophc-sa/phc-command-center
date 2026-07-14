import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n } from "@/lib/i18n";
import { createContact, type ContactAuthority, type ContactLocation } from "@/lib/crm-actions";
import { CommunicationActions } from "@/components/phc/CommunicationActions";
import { ArchivedBadge } from "@/components/phc/RecordLifecycleMenu";

export const Route = createFileRoute("/_authenticated/contacts")({
  head: () => ({ meta: [{ title: "Contacts — PHC" }, { name: "robots", content: "noindex" }] }),
  component: ContactsPage,
});

const AUTHORITIES: ContactAuthority[] = [
  "decision_maker", "influencer", "technical_contact", "unknown_authority",
];
const LOCATIONS: ContactLocation[] = ["site_office", "head_office", "unknown"];

function authorityTone(a: ContactAuthority): "positive" | "neutral" | "muted" {
  if (a === "decision_maker") return "positive";
  if (a === "unknown_authority") return "muted";
  return "neutral";
}

function ContactsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [authFilter, setAuthFilter] = useState<ContactAuthority | "all">("all");
  const [showArchived, setShowArchived] = useState(false);

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ["contacts"],
    queryFn: async () =>
      (
        await supabase
          .from("contacts")
          .select("*, companies(id, name, website)")
          .order("updated_at", { ascending: false })
      ).data ?? [],
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["companies-min"],
    queryFn: async () => (await supabase.from("companies").select("id, name").order("name")).data ?? [],
  });

  const authorityLabel = (a: ContactAuthority) => t(`authority_${a}` as never);
  const locationLabel = (l: ContactLocation) => t(`location_${l}` as never);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts
      .filter((c: any) => showArchived || !c.archived_at)
      .filter((c: any) => authFilter === "all" || c.authority === authFilter)
      .filter(
        (c: any) =>
          !q ||
          (c.name && c.name.toLowerCase().includes(q)) ||
          (c.title && c.title.toLowerCase().includes(q)) ||
          (c.companies?.name && c.companies.name.toLowerCase().includes(q)),
      );
  }, [contacts, query, authFilter, showArchived]);

  const kpis = useMemo(() => {
    const dm = contacts.filter((c: any) => c.authority === "decision_maker").length;
    const withEmail = contacts.filter((c: any) => !!c.email).length;
    const withPhone = contacts.filter((c: any) => !!c.phone).length;
    return { total: contacts.length, dm, withEmail, withPhone };
  }, [contacts]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow={t("nav_crm" as never) || "CRM"}
        title={t("nav_contacts")}
        actions={
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs font-medium text-amber-light hover:bg-amber/20"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("crm_new_contact")}
          </button>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={t("nav_contacts")} value={kpis.total} icon={<Users className="h-3.5 w-3.5" />} />
        <KpiCard label={t("authority_decision_maker" as never) || "Decision makers"} value={kpis.dm} />
        <KpiCard label={t("crm_email" as never) || "Email"} value={kpis.withEmail} />
        <KpiCard label={t("crm_phone" as never) || "Phone"} value={kpis.withPhone} />
      </div>

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("crm_search_contacts" as never) || "Search"}
            className="w-full rounded-md border border-border bg-surface/60 py-2 pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setAuthFilter("all")}
            className={`rounded-full border px-3 py-1.5 text-xs ${authFilter === "all" ? "border-amber/40 bg-amber/10 text-amber-light" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            {t("crm_filter_all_types")}
          </button>
          {AUTHORITIES.map((a) => (
            <button
              key={a}
              onClick={() => setAuthFilter(a)}
              className={`rounded-full border px-3 py-1.5 text-xs ${authFilter === a ? "border-amber/40 bg-amber/10 text-amber-light" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {authorityLabel(a)}
            </button>
          ))}
          <button
            onClick={() => setShowArchived((v) => !v)}
            className={`rounded-full border px-3 py-1.5 text-xs ${showArchived ? "border-amber/40 bg-amber/10 text-amber-light" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            {t("lifecycle_include_archived")}
          </button>
        </div>
      </div>

      {isLoading ? (
        <SkeletonTable rows={8} />
      ) : contacts.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t("empty_title_contacts")}
          description={t("empty_desc_contacts")}
          primaryAction={{ label: t("crm_new_contact"), onClick: () => setCreateOpen(true), icon: Plus }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          variant="no-results"
          title={t("empty_title_no_results")}
          description={t("empty_desc_no_results")}
          secondaryAction={{ label: t("empty_clear_filters"), onClick: () => { setQuery(""); setAuthFilter("all"); setShowArchived(false); } }}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/70 bg-surface/60">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-start text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="px-5 py-3 text-start font-medium">{t("ibx_contact_name" as never)}</th>
                <th className="px-5 py-3 text-start font-medium">{t("crm_company")}</th>
                <th className="px-5 py-3 text-start font-medium">{t("crm_title")}</th>
                <th className="px-5 py-3 text-start font-medium">{t("crm_phone")}</th>
                <th className="px-5 py-3 text-start font-medium">{t("crm_email")}</th>
                <th className="px-5 py-3 text-start font-medium">{t("crm_website")}</th>
                <th className="px-5 py-3 text-start font-medium">{t("crm_authority")}</th>
                <th className="px-5 py-3 text-start font-medium">{t("crm_location")}</th>
                <th className="px-5 py-3 text-end font-medium">{t("crm_confidence")}</th>
                <th className="px-5 py-3 text-end font-medium">{t("comm_log_activity")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c: any) => (
                <tr key={c.id} className="border-b border-border/40 text-foreground last:border-0 hover:bg-surface">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{c.name}</span>
                      <ArchivedBadge archived={!!c.archived_at} />
                    </div>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{c.companies?.name ?? "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">{c.title ?? "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">{c.phone ?? "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {c.email
                      ? <a href={`mailto:${c.email}`} className="hover:text-foreground transition-colors">{c.email}</a>
                      : "—"}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {c.companies?.website
                      ? <a href={c.companies.website} target="_blank" rel="noreferrer" className="hover:text-foreground transition-colors truncate max-w-[160px] block">
                          {c.companies.website.replace(/^https?:\/\//, "")}
                        </a>
                      : "—"}
                  </td>
                  <td className="px-5 py-3">
                    <StatusPill tone={authorityTone(c.authority)}>{authorityLabel(c.authority)}</StatusPill>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{locationLabel(c.location)}</td>
                  <td className="num px-5 py-3 text-end text-muted-foreground" data-tabular="true">
                    {c.confidence_score != null ? `${c.confidence_score}%` : "—"}
                  </td>
                  <td className="px-5 py-3 text-end">
                    <CommunicationActions
                      size="xs"
                      linked={{
                        type: "contact",
                        id: c.id,
                        label: c.name,
                        contactId: c.id,
                        companyId: c.companies?.id ?? c.company_id ?? null,
                      }}
                      recipientName={c.name}
                      recipientEmail={c.email}
                      recipientPhone={c.phone}
                      emailTemplate="contractor_introduction"
                      emailContext={{ companyName: c.companies?.name ?? null }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ActionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("crm_new_contact")}
        description={t("crm_pending_verification")}
        submitLabel={t("crm_add")}
        fields={[
          { key: "name", type: "text", label: t("crm_new_contact"), required: true },
          { key: "companyId", type: "select", label: t("crm_company"), options: [{ value: "", label: "—" }, ...companies.map((c: any) => ({ value: c.id, label: c.name }))] },
          { key: "title", type: "text", label: t("crm_title") },
          { key: "authority", type: "select", label: t("crm_authority"), defaultValue: "unknown_authority", options: AUTHORITIES.map((a) => ({ value: a, label: authorityLabel(a) })) },
          { key: "location", type: "select", label: t("crm_location"), defaultValue: "unknown", options: LOCATIONS.map((l) => ({ value: l, label: locationLabel(l) })) },
          { key: "phone", type: "text", label: t("crm_phone") },
          { key: "email", type: "text", label: t("crm_email") },
          { key: "linkedin", type: "text", label: "LinkedIn" },
          { key: "confidenceScore", type: "text", label: t("crm_confidence") },
        ]}
        onSubmit={async (v) => {
          try {
            await createContact({
              name: v.name,
              companyId: v.companyId || null,
              title: v.title || undefined,
              authority: v.authority as ContactAuthority,
              location: v.location as ContactLocation,
              phone: v.phone || undefined,
              email: v.email || undefined,
              linkedin: v.linkedin || undefined,
              confidenceScore: v.confidenceScore ? Number(v.confidenceScore) : null,
              claimOwner: true,
            });
            toast.success(t("crm_saved"));
            qc.invalidateQueries({ queryKey: ["contacts"] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}
