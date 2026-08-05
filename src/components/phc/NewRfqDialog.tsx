// PHC Sales OS — "+ New RFQ": the direct entry point spec §6 asks for.
//
// §6 wants a "+ New RFQ" button that "must remain visible or easily accessible
// throughout the application", and §24 defines the form behind it. §25 then
// requires that saving it produce the whole starting state in one go.
//
// Until now the only way in was New Intake, and reaching an opportunity from
// there took four screens: Intake → Classify → Convert → RFQ-to-Opportunity.
// Faisal, 2026-08-05: "my process starts with receiving an RFQ by email... why
// all these steps after filling in the form?"
//
// Intake is not replaced. It stays as the triage funnel for things that are not
// yet a known RFQ — market signals, incomplete captures, duplicates, items that
// turn out to be a company or a contact. This is the fast path for the case the
// business actually runs on: a real RFQ arrived, from a known kind of sender,
// with a deadline.
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ActionDialog, type DialogField } from "@/components/phc/ActionDialog";
import { useI18n } from "@/lib/i18n";
import { createRfqWithOpportunity } from "@/lib/rfq-actions";
import { INBOX_SOURCE_TYPES } from "@/lib/inbox-actions";

export function newRfqFields(t: (k: string) => string): DialogField[] {
  return [
    // §24 mandatory: Opportunity type. First field, because it is the single
    // most consequential decision in the system (JIH vs Tender) and everything
    // downstream branches on it.
    {
      key: "opportunityType",
      type: "select",
      label: t("rfq_opportunity_type"),
      required: true,
      options: [
        { value: "jih", label: t("ibx_project_type_jih") },
        { value: "tender", label: t("ibx_project_type_tender") },
      ],
    },
    { key: "dateReceived", type: "date", label: t("ibx_date_received"), defaultValue: new Date().toISOString().slice(0, 10) },
    {
      key: "sourceType",
      type: "select",
      label: t("ibx_source_type"),
      required: true,
      options: INBOX_SOURCE_TYPES.map((s) => ({ value: s, label: t(`src_${s}`) })),
    },
    { key: "projectName", type: "text", label: t("label_project"), required: true },
    { key: "location", type: "text", label: t("label_location") },
    { key: "companyName", type: "text", label: t("ibx_company_name"), required: true },
    { key: "contactName", type: "text", label: t("ibx_contact_name") },
    { key: "contactPhone", type: "text", label: t("label_phone") },
    { key: "responseDueDate", type: "date", label: t("ibx_deadline"), required: true },
    // §24 lists "Email reference" among the attachments, and the source list
    // leads with Email — so this takes a link or a file, not a file only.
    { key: "documentUrl", type: "file_or_url", label: t("rfq_source_reference"), folder: "rfq" },
    // Estimated value is deliberately absent. Per the 2026-08-03 client
    // decision it is a later-stage Finance field (canEditTotalValue in
    // roles.ts), not something captured at first contact — the same reason it
    // was removed from the intake form.
  ];
}

export function NewRfqDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("rfq_new_title")}
      description={t("rfq_new_desc")}
      submitLabel={t("crm_add")}
      fields={newRfqFields((k) => t(k as never))}
      onSubmit={async (v) => {
        try {
          const res = await createRfqWithOpportunity({
            companyName: v.companyName,
            contactName: v.contactName,
            contactPhone: v.contactPhone,
            projectScope: v.projectName,
            location: v.location || null,
            responseDueDate: v.responseDueDate,
            opportunityType: v.opportunityType === "tender" ? "tender" : "jih",
            sourceType: v.sourceType || null,
            documentUrl: v.documentUrl || null,
          });
          // Every surface that counts RFQs or opportunities is now stale.
          for (const key of [
            "ws-urgent-rfqs", "ws-rfqs", "ws-jih", "ws-stage-opps",
            "cc-core", "opportunities", "rfqs", "inbox-items",
          ]) {
            qc.invalidateQueries({ queryKey: [key] });
          }
          toast.success(t("rfq_new_created"));
          onOpenChange(false);
          // Land the user on the opportunity that was just created, rather than
          // leaving them to hunt for it — §25.10 "add the opportunity to the
          // correct pipeline" is only useful if they can see it happen.
          void navigate({ to: "/opportunities/$id", params: { id: res.opportunityId } });
        } catch (e) {
          toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
        }
      }}
    />
  );
}
