import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { DataField } from "@/components/phc/DataField";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, formatCurrency } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { createReferenceProject } from "@/lib/vendor-actions";
import { canManageSalesPipeline } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated/reference-library")({
  head: () => ({ meta: [{ title: "Reference Library — PHC" }, { name: "robots", content: "noindex" }] }),
  component: ReferenceLibraryPage,
});

function ReferenceLibraryPage() {
  const { t, lang } = useI18n();
  const { roles } = useAuth();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sector, setSector] = useState("all");
  const [shareableOnly, setShareableOnly] = useState(false);
  const canEdit = canManageSalesPipeline(roles);

  const { data: refs = [], isLoading } = useQuery({
    queryKey: ["reference-projects"],
    queryFn: async () => (await supabase.from("reference_projects").select("*").order("year", { ascending: false })).data ?? [],
  });

  const sectors = useMemo(() => {
    const s = new Set<string>();
    refs.forEach((r: any) => r.sector && s.add(String(r.sector)));
    return Array.from(s).sort();
  }, [refs]);

  const term = q.trim().toLowerCase();
  const filtered = refs.filter((r: any) => {
    if (sector !== "all" && r.sector !== sector) return false;
    if (shareableOnly && !r.shareable_with_client) return false;
    if (!term) return true;
    return [r.name, r.sector, r.city, r.client_or_contractor, r.sign_types, r.project_type]
      .some((f) => f && String(f).toLowerCase().includes(term));
  });

  const currentYear = new Date().getFullYear();
  const thisYear = refs.filter((r: any) => Number(r.year) === currentYear).length;
  const shareable = refs.filter((r: any) => r.shareable_with_client).length;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow={t("navgroup_intelligence")}
        title={t("nav_reference_library")}
        description="Curated evidence for proposal preparation and client conversations."
        actions={
          canEdit ? (
            <button
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-2 text-xs font-medium text-amber-light hover:bg-amber/20"
            >
              <Plus className="h-3.5 w-3.5" /> {t("ref_new")}
            </button>
          ) : null
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Projects" value={refs.length} />
        <KpiCard label="Shareable" value={shareable} hint={refs.length ? `${Math.round((shareable / refs.length) * 100)}% of library` : undefined} />
        <KpiCard label="Sectors" value={sectors.length || "—"} />
        <KpiCard label={`${currentYear}`} value={thisYear} hint="delivered this year" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("ref_search")}
            className="w-full rounded-md border border-border bg-surface ps-9 pe-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber/40"
          />
        </div>
        <select
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber/40"
        >
          <option value="all">All sectors</option>
          {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={shareableOnly} onChange={(e) => setShareableOnly(e.target.checked)} className="accent-amber-light" />
          Shareable only
        </label>
      </div>

      {isLoading ? (
        <EmptyState message={t("loading")} />
      ) : filtered.length === 0 ? (
        <EmptyState message={t("ref_no_projects")} hint={term || sector !== "all" || shareableOnly ? "Try clearing filters" : undefined} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r: any) => (
            <div key={r.id} className="flex flex-col rounded-xl border border-border/70 bg-surface/60 px-4 py-3 transition-colors hover:border-border-strong/70 hover:bg-surface">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{r.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {[r.project_type, r.city, r.year].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                <StatusPill tone={r.shareable_with_client ? "positive" : "muted"}>
                  {r.shareable_with_client ? t("ref_shareable") : t("ref_needs_approval")}
                </StatusPill>
              </div>
              {r.sector ? (
                <div className="mt-2">
                  <StatusPill tone="neutral">{r.sector}</StatusPill>
                </div>
              ) : null}
              <div className="mt-3 grid grid-cols-2 gap-3">
                <DataField label={t("ref_scope")} value={r.phc_scope} />
                <DataField label={t("ref_sign_types")} value={r.sign_types} />
                <DataField label={t("crm_main_contractor")} value={r.client_or_contractor} />
                <DataField label={t("crm_total_value")} value={formatCurrency(r.project_value, lang, r.currency)} mono />
              </div>
            </div>
          ))}
        </div>
      )}

      <ActionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("ref_new")}
        submitLabel={t("crm_add")}
        fields={[
          { key: "name", type: "text", label: t("nav_projects"), required: true },
          { key: "projectType", type: "text", label: t("ref_type") },
          { key: "city", type: "text", label: t("crm_location") },
          { key: "sector", type: "text", label: t("crm_sector") },
          { key: "year", type: "text", label: t("ref_year") },
          { key: "clientOrContractor", type: "text", label: t("crm_main_contractor") },
          { key: "phcScope", type: "textarea", label: t("ref_scope") },
          { key: "signTypes", type: "text", label: t("ref_sign_types") },
          { key: "projectValue", type: "text", label: t("crm_total_value") },
          { key: "challenges", type: "textarea", label: t("ref_challenges") },
          { key: "solutions", type: "textarea", label: t("ref_solutions") },
        ]}
        onSubmit={async (v) => {
          try {
            await createReferenceProject({
              name: v.name,
              project_type: v.projectType || null,
              city: v.city || null,
              sector: v.sector || null,
              year: v.year ? Number(v.year) : null,
              client_or_contractor: v.clientOrContractor || null,
              phc_scope: v.phcScope || null,
              sign_types: v.signTypes || null,
              project_value: v.projectValue ? Number(v.projectValue) : null,
              challenges: v.challenges || null,
              solutions: v.solutions || null,
            });
            toast.success(t("crm_saved"));
            qc.invalidateQueries({ queryKey: ["reference-projects"] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}
