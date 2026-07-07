import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { DataField } from "@/components/phc/DataField";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { createVendor } from "@/lib/vendor-actions";

export const Route = createFileRoute("/_authenticated/vendors")({
  head: () => ({ meta: [{ title: "Vendors — PHC" }, { name: "robots", content: "noindex" }] }),
  component: VendorsPage,
});

function VendorsPage() {
  const { t } = useI18n();
  const { hasAnyRole } = useAuth();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  // Managers read the full record; the sales team reads the public-safe view
  // (no prices, no internal ratings).
  const isManager = hasAnyRole(["bd_manager", "sales_manager", "ceo"]);
  const source = isManager ? "vendors" : "vendors_public";

  const { data: vendors = [], isLoading } = useQuery({
    queryKey: ["vendors", source],
    queryFn: async () => (await supabase.from(source as "vendors").select("*").order("name")).data ?? [],
  });

  return (
    <div className="mx-auto max-w-7xl">
      <SectionHeader
        title={t("nav_vendors")}
        count={vendors.length}
        hint={isManager ? undefined : t("vendor_sensitive_hidden")}
        action={
          isManager ? (
            <button onClick={() => setCreateOpen(true)} className="rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs text-amber-light hover:bg-amber/20">
              {t("vendor_new")}
            </button>
          ) : null
        }
      />

      {isLoading ? (
        <EmptyState message={t("loading")} />
      ) : vendors.length === 0 ? (
        <EmptyState message={t("vendor_no_vendors")} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {vendors.map((v: any) => (
            <div key={v.id} className="rounded-lg border border-border bg-surface px-4 py-3">
              <div className="text-sm font-medium text-foreground">{v.name}</div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <DataField label={t("vendor_scope")} value={v.scope} />
                <DataField label={t("vendor_materials")} value={v.materials} />
                <DataField label={t("vendor_lead_time")} value={v.lead_time} />
                <DataField label={t("vendor_quality")} value={v.quality_level} />
                <DataField label={t("vendor_contact")} value={v.contact_name || v.contact_phone} />
                {isManager ? (
                  <>
                    <DataField label={t("vendor_ref_prices")} value={v.reference_prices} />
                    <DataField label={t("vendor_rating")} value={v.internal_rating != null ? `${v.internal_rating}/5` : null} />
                  </>
                ) : null}
              </div>
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
