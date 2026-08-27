import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Users, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n } from "@/lib/i18n";
import { createContact, createCompany, type ContactAuthority, type ContactLocation, type ContactConfidenceLevel } from "@/lib/crm-actions";
import { CommunicationActions } from "@/components/phc/CommunicationActions";
import { ArchivedBadge, RecordLifecycleMenu } from "@/components/phc/RecordLifecycleMenu";

export const Route = createFileRoute("/_authenticated/contacts")({
  // `?q=` lets the command palette deep-link straight to a named contact.
  // Contacts have no detail route, so a search hit pre-filters this list
  // instead of dropping the user on the full roster (QA 2026-08-10 ISSUE-001).
  validateSearch: (s: Record<string, unknown>) => ({
    q: typeof s.q === "string" ? s.q : "",
  }),
  head: () => ({ meta: [{ title: "Contacts — PHC" }, { name: "robots", content: "noindex" }] }),
  component: ContactsPage,
});

const AUTHORITIES: ContactAuthority[] = [
  "decision_maker", "influencer", "technical_contact", "unknown_authority",
];
const LOCATIONS: ContactLocation[] = ["site_office", "head_office", "unknown"];
const CONFIDENCE_LEVELS: ContactConfidenceLevel[] = ["high", "medium", "low"];

function authorityTone(a: ContactAuthority): "positive" | "neutral" | "muted" {
  if (a === "decision_maker") return "positive";
  if (a === "unknown_authority") return "muted";
  return "neutral";
}

function confidenceTone(c: ContactConfidenceLevel | null): "positive" | "attention" | "muted" {
  if (c === "high") return "positive";
  if (c === "medium") return "attention";
  return "muted";
}

function ContactsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { roles } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [creatingCompanyFor, setCreatingCompanyFor] = useState<((result: { value: string; label: string } | null) => void) | null>(null);
  const { q: initialQuery } = Route.useSearch();
  const [query, setQuery] = useState(initialQuery);
  const [authFilter, setAuthFilter] = useState<ContactAuthority | "all">("all");
  // Arriving from the command palette while already on this page changes only
  // the search param — the component stays mounted, so useState's initial
  // value alone would silently ignore the new query.
  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);
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
  const confidenceLevelLabel = (c: ContactConfidenceLevel) => t(`confidence_${c}` as never);

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
          <div className="flex flex-wrap items-center gap-2">
            {/* The repair screen sits beside the book it repairs. Buried in a
                menu, nobody finds the eleven bouncing addresses until an email
                fails. */}
            <Link
              to="/contacts/repair"
              search={{} as never}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
            >
              <Wrench className="h-3.5 w-3.5" />
              {t("nav_contacts") === "Contacts" ? "Repair imported data" : "إصلاح بيانات الاستيراد"}
            </Link>
            <button
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs font-medium text-amber-light hover:bg-amber/20"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("crm_new_contact")}
            </button>
          </div>
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
          {/* `table-fixed` so one 90-character imported name cannot set the
                width of every column. Without it the table measured 1076px
                inside a 719px pane and scrolled sideways — the complaint that
                started this. */}
            <table className="w-full table-fixed text-[13px]">
            <thead>
              <tr className="border-b border-border/60 text-start text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {/* Five columns, not ten. Website and confidence are empty on
                    every row in this book and location on all but one, so they
                    cost width and told the reader nothing; they now sit under
                    the name where they appear only when filled. Ten columns
                    could not fit any screen without sideways scrolling. */}
                <th className="w-[22%] px-3 py-2 text-start font-medium">{t("ibx_contact_name" as never)}</th>
                <th className="w-[16%] px-3 py-2 text-start font-medium">{t("crm_company")}</th>
                <th className="w-[13%] px-3 py-2 text-start font-medium">{t("crm_phone")}</th>
                <th className="w-[19%] px-3 py-2 text-start font-medium">{t("crm_email")}</th>
                <th className="w-[10%] px-3 py-2 text-start font-medium">{t("crm_authority")}</th>
                <th className="w-[20%] px-3 py-2 text-end font-medium">{t("comm_log_activity")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c: any) => (
                <tr key={c.id} className="border-b border-border/40 text-foreground last:border-0 hover:bg-surface">
                  {/* Name carries what used to be its own columns. Title,
                      location and website are filled on almost no row in this
                      book, so as columns they bought width and told the reader
                      nothing; here they appear only when there is something to
                      show. */}
                  <td className="px-3 py-2 align-top">
                    <div className="flex items-center gap-1.5">
                      {/* Truncated, with the full value on hover. An imported
                          name can run to ninety characters; wrapping it made
                          rows 122px tall and only two fit a screen. */}
                      <span className="min-w-0 truncate font-medium" title={c.name}>{c.name}</span>
                      <ArchivedBadge archived={!!c.archived_at} />
                    </div>
                    {(c.title || (c.location && c.location !== "unknown") || c.companies?.website) ? (
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                        {c.title ? <span>{c.title}</span> : null}
                        {c.location && c.location !== "unknown" ? <span>{locationLabel(c.location)}</span> : null}
                        {c.companies?.website ? (
                          <a
                            href={c.companies.website}
                            target="_blank"
                            rel="noreferrer"
                            className="max-w-[180px] truncate hover:text-foreground"
                          >
                            {c.companies.website.replace(/^https?:\/\//, "")}
                          </a>
                        ) : null}
                        {c.confidence_level ? (
                          <StatusPill tone={confidenceTone(c.confidence_level)}>
                            {confidenceLevelLabel(c.confidence_level)}
                          </StatusPill>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 align-top text-muted-foreground">
                    <span className="block truncate" title={c.companies?.name ?? ""}>{c.companies?.name ?? "—"}</span>
                  </td>
                  <td className="px-3 py-2 align-top text-muted-foreground">
                    {c.phone ? <a href={`tel:${c.phone}`} className="hover:text-foreground">{c.phone}</a> : "—"}
                  </td>
                  <td className="px-3 py-2 align-top text-muted-foreground">
                    {c.email
                      ? <a href={`mailto:${c.email}`} className="block truncate hover:text-foreground transition-colors">{c.email}</a>
                      : "—"}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <StatusPill tone={authorityTone(c.authority)}>{authorityLabel(c.authority)}</StatusPill>
                  </td>
                  <td className="px-3 py-2 align-top text-end">
                    <div className="flex flex-nowrap items-center justify-end gap-0.5">
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
                        iconOnly
                      />
                      {/* Archive, unarchive and mark-duplicate. The machinery
                          already supported contacts; this page was the only one
                          of eight that never rendered the menu, so a contact
                          could be created and never removed from view. */}
                      <RecordLifecycleMenu
                        entityType="contacts"
                        entityId={c.id}
                        roles={roles}
                        archived={!!c.archived_at}
                        onDone={() => qc.invalidateQueries({ queryKey: ["contacts"] })}
                      />
                    </div>
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
          {
            key: "companyId", type: "select", label: t("crm_company"),
            options: [{ value: "", label: "—" }, ...companies.map((c: any) => ({ value: c.id, label: c.name }))],
            createLabel: t("wf_add_new_company"),
            onCreateNew: () => new Promise((resolve) => setCreatingCompanyFor(() => resolve)),
          },
          { key: "title", type: "text", label: t("crm_title") },
          { key: "authority", type: "select", label: t("crm_authority"), defaultValue: "unknown_authority", options: AUTHORITIES.map((a) => ({ value: a, label: authorityLabel(a) })) },
          { key: "location", type: "select", label: t("crm_location"), defaultValue: "unknown", options: LOCATIONS.map((l) => ({ value: l, label: locationLabel(l) })) },
          { key: "phone", type: "text", label: t("crm_phone") },
          { key: "email", type: "text", label: t("crm_email") },
          { key: "linkedin", type: "text", label: "LinkedIn" },
          { key: "confidenceLevel", type: "select", label: t("crm_confidence"), options: [{ value: "", label: "—" }, ...CONFIDENCE_LEVELS.map((c) => ({ value: c, label: confidenceLevelLabel(c) }))] },
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
              confidenceLevel: v.confidenceLevel ? (v.confidenceLevel as ContactConfidenceLevel) : null,
              claimOwner: true,
            });
            toast.success(t("crm_saved"));
            qc.invalidateQueries({ queryKey: ["contacts"] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />

      {/* Inline "add new company" from the new-contact company picker */}
      <ActionDialog
        open={!!creatingCompanyFor}
        onOpenChange={(o) => { if (!o) { creatingCompanyFor?.(null); setCreatingCompanyFor(null); } }}
        title={t("wf_add_new_company")}
        submitLabel={t("crm_add")}
        fields={[{ key: "name", type: "text", label: t("crm_company"), required: true }]}
        onSubmit={async (v) => {
          try {
            const company = await createCompany({ name: v.name, companyType: "target_account", claimOwner: true });
            creatingCompanyFor?.({ value: company.id, label: company.name });
            setCreatingCompanyFor(null);
            qc.invalidateQueries({ queryKey: ["companies-min"] });
          } catch (e) {
            // Resolve with null so the select doesn't stay stuck disabled
            // waiting on a promise that would otherwise never settle.
            creatingCompanyFor?.(null);
            setCreatingCompanyFor(null);
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}
