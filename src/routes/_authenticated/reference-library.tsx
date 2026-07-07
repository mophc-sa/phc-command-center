import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { DataField } from "@/components/phc/DataField";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, formatCurrency } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { createReferenceProject } from "@/lib/vendor-actions";

export const Route = createFileRoute("/_authenticated/reference-library")({
  head: () => ({ meta: [{ title: "Reference Library — PHC" }, { name: "robots", content: "noindex" }] }),
  component: ReferenceLibraryPage,
});

function ReferenceLibraryPage() {
  const { t, lang } = useI18n();
  const { hasAnyRole } = useAuth();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [q, setQ] = useState("");
  const canEdit = hasAnyRole(["bd_manager", "sales_manager", "ceo"]);

  const { data: refs = [], isLoading } = useQuery({
    queryKey: ["reference-projects"],
    queryFn: async () => (await supabase.from("reference_projects").select("*").order("year", { ascending: false })).data ?? [],
  });

  const term = q.trim().toLowerCase();
  const filtered = term
    ? refs.filter((r: any) =>
        [r.name, r.sector, r.city, r.client_or_contractor, r.sign_types].some((f) => f && String(f).toLowerCase().includes(term)),
      )
    : refs;

  return (
    <div className="mx-auto max-w-7xl">
      <SectionHeader
        title={t("nav_reference_library")}
        count={filtered.length}
        action={
          canEdit ? (
            <button onClick={() => setCreateOpen(true)} className="rounded-md border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs text-amber-light hover:bg-amber/20">
              {t("ref_new")}
            </button>
          ) : null
        }
      />

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("ref_search")}
        className="mb-4 w-full max-w-md rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber/40"
      />

      {isLoading ? (
        <EmptyState message={t("loading")} />
      ) : filtered.length === 0 ? (
        <EmptyState message={t("ref_no_projects")} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r: any) => (
            <div key={r.id} className="flex flex-col rounded-lg border border-border bg-surface px-4 py-3">
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
              <div className="mt-3 grid grid-cols-2 gap-3">
                <DataField label={t("ref_scope")} value={r.phc_scope} />
                <DataField label={t("ref_sign_types")} value={r.sign_types} />
                <DataField label={t("crm_sector")} value={r.sector} />
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
