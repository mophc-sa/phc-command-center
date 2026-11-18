import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { createCompany, createOpportunityForCompany } from "@/lib/crm-actions";
import { listTeamMembers, scheduleFollowUp } from "@/lib/opportunity-actions";
import { isAssignableTeamMember } from "@/lib/team-members";
import { similarNames } from "@/lib/similar-names";
import { canAssignOwner } from "@/lib/roles";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n } from "@/lib/i18n";

const SOURCES = [
  { value: "email_rfq", en: "RFQ by email", ar: "طلب تسعير بالبريد" },
  { value: "tender_portal", en: "Tender portal", ar: "بوابة مناقصات" },
  { value: "client_visit", en: "Client visit / meeting", ar: "زيارة أو اجتماع" },
  { value: "referral", en: "Referral", ar: "توصية" },
  { value: "website", en: "Website inquiry", ar: "استفسار من الموقع" },
  { value: "other", en: "Other", ar: "أخرى" },
];

/**
 * New opportunity, the short way (Omar's CRM review, image 08): project, target
 * company, owner, source, next action and its date. Starts at RFQ received;
 * the rest is asked for as the deal moves stage. A company not on file is
 * created pending review, after the similar-name warning.
 */
export function QuickOpportunityDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { user, roles } = useAuth();
  const navigate = useNavigate();
  const companies = useQuery({
    queryKey: ["companies-min"],
    enabled: open,
    queryFn: async () => ((await supabase.from("companies").select("id, name").order("name")).data ?? []) as { id: string; name: string }[],
  });
  const team = useQuery({ queryKey: ["team"], enabled: open, queryFn: listTeamMembers });
  const names = (companies.data ?? []).map((c) => c.name);
  const canPickOwner = canAssignOwner(roles);

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={ar ? "فرصة جديدة" : "New opportunity"}
      description={ar ? "تبدأ في مرحلة «طلب تسعير مستلم»؛ تُطلب البيانات الأخرى عند الانتقال بين المراحل." : "Starts at RFQ received; the rest is asked for as it moves stage."}
      submitLabel={ar ? "حفظ الفرصة" : "Save opportunity"}
      fields={[
        { key: "projectName", type: "text", label: ar ? "اسم المشروع" : "Project name", required: true },
        {
          key: "company", type: "autocomplete", label: ar ? "الشركة المستهدفة" : "Target company", required: true,
          suggestions: names,
          hintFor: (v: string) => {
            const m = similarNames(v, names);
            return m.length && !names.some((n) => n.toLowerCase() === v.trim().toLowerCase())
              ? (ar ? `مشابه لسجل موجود: ${m.join("، ")}` : `Looks like an existing record: ${m.join(", ")}`)
              : null;
          },
        },
        ...(canPickOwner
          ? [{
              key: "ownerId", type: "select" as const, label: ar ? "مسؤول المبيعات" : "Sales owner", required: true, defaultValue: user?.id ?? "",
              options: (team.data ?? []).filter(isAssignableTeamMember).map((m: any) => ({ value: m.id, label: m.full_name ?? m.email })),
            }]
          : []),
        { key: "source", type: "select", label: ar ? "المصدر" : "Source", required: true, options: SOURCES.map((x) => ({ value: x.value, label: ar ? x.ar : x.en })) },
        { key: "nextAction", type: "text", label: ar ? "الإجراء التالي" : "Next action", required: true },
        { key: "nextDate", type: "date", label: ar ? "موعد المتابعة" : "Follow-up date", required: true },
      ]}
      onSubmit={async (v) => {
        try {
          const typed = String(v.company).trim();
          const known = (companies.data ?? []).find((c) => c.name.toLowerCase() === typed.toLowerCase());
          const companyId = known?.id ?? (await createCompany({ name: typed, companyType: "target_account", claimOwner: true })).id;
          const opp = await createOpportunityForCompany({
            companyId, projectName: v.projectName, ownerId: v.ownerId || null, source: v.source,
            nextAction: v.nextAction, nextActionDue: v.nextDate,
          });
          await scheduleFollowUp({ opportunityId: opp.id, dueDate: v.nextDate, notes: v.nextAction, ownerId: v.ownerId || undefined });
          toast.success(ar ? "أُنشئت الفرصة" : "Opportunity created");
          void navigate({ to: "/opportunities/$id", params: { id: opp.id } });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
          throw e;
        }
      }}
    />
  );
}
