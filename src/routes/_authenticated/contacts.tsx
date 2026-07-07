import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n } from "@/lib/i18n";
import { createContact, type ContactAuthority, type ContactLocation } from "@/lib/crm-actions";

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

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ["contacts"],
    queryFn: async () =>
      (
        await supabase
          .from("contacts")
          .select("*, companies(id, name)")
          .order("updated_at", { ascending: false })
      ).data ?? [],
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["companies-min"],
    queryFn: async () => (await supabase.from("companies").select("id, name").order("name")).data ?? [],
  });

  const authorityLabel = (a: ContactAuthority) => t(`authority_${a}` as never);
  const locationLabel = (l: ContactLocation) => t(`location_${l}` as never);

  return (
    <div className="mx-auto max-w-7xl">
      <SectionHeader
        title={t("nav_contacts")}
        count={contacts.length}
        action={
          <button onClick={() => setCreateOpen(true)} className="rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs text-amber-light hover:bg-amber/20">
            {t("crm_new_contact")}
          </button>
        }
      />

      {isLoading ? (
        <EmptyState message={t("loading")} />
      ) : contacts.length === 0 ? (
        <EmptyState message={t("crm_no_contacts")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-start text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                <th className="px-4 py-2.5 text-start">{t("crm_new_contact")}</th>
                <th className="px-4 py-2.5 text-start">{t("crm_company")}</th>
                <th className="px-4 py-2.5 text-start">{t("crm_title")}</th>
                <th className="px-4 py-2.5 text-start">{t("crm_authority")}</th>
                <th className="px-4 py-2.5 text-start">{t("crm_location")}</th>
                <th className="px-4 py-2.5 text-end">{t("crm_confidence")}</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c: any) => (
                <tr key={c.id} className="border-b border-border/50 text-foreground">
                  <td className="px-4 py-2.5">
                    {c.name}
                    {c.phone ? <span className="block text-xs text-muted-foreground">{c.phone}</span> : null}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{c.companies?.name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{c.title ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <StatusPill tone={authorityTone(c.authority)}>{authorityLabel(c.authority)}</StatusPill>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{locationLabel(c.location)}</td>
                  <td className="num px-4 py-2.5 text-end text-muted-foreground" data-tabular="true">
                    {c.confidence_score != null ? `${c.confidence_score}%` : "—"}
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
