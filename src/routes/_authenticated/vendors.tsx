import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Lock, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/phc/PageHeader";
import { KpiCard } from "@/components/phc/KpiCard";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { DataField } from "@/components/phc/DataField";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { createVendor } from "@/lib/vendor-actions";
import { canManageSalesPipeline } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated/vendors")({
  head: () => ({ meta: [{ title: "Vendors — PHC" }, { name: "robots", content: "noindex" }] }),
  component: VendorsPage,
});

function VendorsPage() {
  const { t } = useI18n();
  const { roles } = useAuth();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<string>("all");

  const isManager = canManageSalesPipeline(roles);
  const source = isManager ? "vendors" : "vendors_public";

  const { data: vendors = [], isLoading } = useQuery({
    queryKey: ["vendors", source],
    queryFn: async () => (await supabase.from(source as "vendors").select("*").order("name")).data ?? [],
  });

  const scopes = useMemo(() => {
    const s = new Set<string>();
    vendors.forEach((v: any) => v.scope && s.add(String(v.scope)));
    return Array.from(s).sort();
  }, [vendors]);

  const term = q.trim().toLowerCase();
  const filtered = vendors.filter((v: any) => {
    if (scope !== "all" && v.scope !== scope) return false;
    if (!term) return true;
    return [v.name, v.scope, v.materials, v.city, v.contact_name]
      .some((f) => f && String(f).toLowerCase().includes(term));
  });

  const withRating = isManager
    ? vendors.filter((v: any) => v.internal_rating != null)
    : [];
  const avgRating = withRating.length
    ? (withRating.reduce((a: number, v: any) => a + Number(v.internal_rating || 0), 0) / withRating.length).toFixed(1)
    : "—";

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow={t("navgroup_intelligence")}
        title={t("nav_vendors")}
        description={
          isManager
            ? undefined
            : t("vendor_sensitive_hidden")
        }
        actions={
          isManager ? (
            <button
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-3 py-2 text-xs font-medium text-amber-light hover:bg-amber/20"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("vendor_new")}
            </button>
          ) : null
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label={t("nav_vendors")} value={vendors.length} hint={`${scopes.length} ${scopes.length === 1 ? "category" : "categories"}`} />
        <KpiCard label={t("vendor_scope")} value={scopes.length || "—"} />
        {isManager ? (
          <>
            <KpiCard label={t("vendor_rating")} value={avgRating} hint={withRating.length ? `${withRating.length} rated` : "—"} />
            <KpiCard label={t("vendor_ref_prices")} value={vendors.filter((v: any) => v.reference_prices).length} hint="with reference pricing" />
          </>
        ) : (
          <>
            <KpiCard label="Filtered" value={filtered.length} />
            <KpiCard label="Restricted" value={<Lock className="h-5 w-5 text-muted-foreground" />} hint="Manager-only fields" />
          </>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search vendors, materials, contacts…"
            className="w-full rounded-md border border-border bg-surface ps-9 pe-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber/40"
          />
        </div>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber/40"
        >
          <option value="all">All categories</option>
          {scopes.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <EmptyState message={t("loading")} />
      ) : filtered.length === 0 ? (
        <EmptyState message={t("vendor_no_vendors")} hint={term || scope !== "all" ? "Try clearing filters" : undefined} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((v: any) => (
            <div key={v.id} className="rounded-xl border border-border/70 bg-surface/60 transition-colors hover:border-border-strong/70 hover:bg-surface">
              <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border/60">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{v.name}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {[v.scope, v.city].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {v.lead_time ? <StatusPill tone="neutral">{v.lead_time}</StatusPill> : null}
                  {v.portal_url ? (
                    <a href={v.portal_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                      <ExternalLink className="h-3 w-3" /> Portal
                    </a>
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 px-4 py-3">
                <DataField label={t("vendor_materials")} value={v.materials} />
                <DataField label={t("vendor_quality")} value={v.quality_level} />
                <DataField label={t("vendor_contact")} value={v.contact_name} />
                <DataField label={t("crm_phone")} value={v.contact_phone} mono />
              </div>
              {isManager && (v.reference_prices || v.internal_rating != null) ? (
                <div className="border-t border-amber/20 bg-amber/5 px-4 py-3">
                  <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-light">
                    <Lock className="h-3 w-3" /> Manager only
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <DataField label={t("vendor_ref_prices")} value={v.reference_prices} />
                    <DataField label={t("vendor_rating")} value={v.internal_rating != null ? `${v.internal_rating}/5` : null} />
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <ActionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("vendor_new")}
        submitLabel={t("crm_add")}
        fields={[
          { key: "name", type: "text", label: t("nav_vendors"), required: true },
          { key: "scope", type: "text", label: t("vendor_scope") },
          { key: "materials", type: "text", label: t("vendor_materials") },
          { key: "city", type: "text", label: t("crm_location") },
          { key: "leadTime", type: "text", label: t("vendor_lead_time") },
          { key: "qualityLevel", type: "text", label: t("vendor_quality") },
          { key: "contactName", type: "text", label: t("vendor_contact") },
          { key: "contactPhone", type: "text", label: t("crm_phone") },
          { key: "portalUrl", type: "text", label: t("vendor_portal") },
          { key: "referencePrices", type: "textarea", label: t("vendor_ref_prices") },
          { key: "internalRating", type: "text", label: t("vendor_rating") },
        ]}
        onSubmit={async (v) => {
          try {
            await createVendor({
              name: v.name,
              scope: v.scope || null,
              materials: v.materials || null,
              city: v.city || null,
              lead_time: v.leadTime || null,
              quality_level: v.qualityLevel || null,
              contact_name: v.contactName || null,
              contact_phone: v.contactPhone || null,
              portal_url: v.portalUrl || null,
              reference_prices: v.referencePrices || null,
              internal_rating: v.internalRating ? Number(v.internalRating) : null,
            });
            toast.success(t("crm_saved"));
            qc.invalidateQueries({ queryKey: ["vendors", source] });
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}
