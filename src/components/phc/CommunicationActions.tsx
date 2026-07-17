// Communication Hub Phase 1 — the reusable action bundle dropped onto
// contact / company / opportunity / RFQ / tender pages: Log Activity
// (call/visit/meeting/note), Email via Outlook, WhatsApp click-to-chat, and
// an optional "Schedule follow-up" quick action when an opportunity is in
// context. Every write goes through the existing logActivity/scheduleFollowUp
// actions, so everything logged here shows up in CommunicationTimeline.

import { useState } from "react";
import { toast } from "sonner";
import { Phone, ListPlus, MessageCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { ActionDialog, type DialogField } from "@/components/phc/ActionDialog";
import { EmailComposeButton } from "@/components/phc/EmailComposeButton";
import { WhatsAppComposeModal } from "@/components/phc/WhatsAppComposeModal";
import { logActivity, type ActivityType } from "@/lib/activity-actions";
import { scheduleFollowUp } from "@/lib/opportunity-actions";
import type { EmailContext, EmailTemplateKind } from "@/lib/email-templates";

const LOGGABLE_TYPES: ActivityType[] = ["call", "visit", "meeting", "note"];

export type CommunicationLinked = {
  type: "company" | "contact" | "opportunity" | "tender" | "rfq" | "project" | "quotation";
  id: string;
  label?: string | null;
  opportunityId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
  rfqId?: string | null;
  tenderId?: string | null;
};

export function CommunicationActions({
  linked,
  recipientEmail,
  recipientName,
  recipientPhone,
  emailTemplate = "opportunity_follow_up",
  emailContext,
  size = "sm",
}: {
  linked: CommunicationLinked;
  recipientEmail?: string | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  emailTemplate?: EmailTemplateKind;
  emailContext?: Partial<EmailContext>;
  size?: "xs" | "sm";
}) {
  const { t, lang } = useI18n();
  const [logOpen, setLogOpen] = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const sizing = size === "xs" ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-xs";

  const linkedIds = {
    opportunityId: linked.opportunityId ?? (linked.type === "opportunity" ? linked.id : null),
    companyId: linked.companyId ?? (linked.type === "company" ? linked.id : null),
    contactId: linked.contactId ?? (linked.type === "contact" ? linked.id : null),
    rfqId: linked.rfqId ?? (linked.type === "rfq" ? linked.id : null),
    tenderId: linked.tenderId ?? (linked.type === "tender" ? linked.id : null),
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => setLogOpen(true)}
        className={`inline-flex items-center gap-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground font-medium ${sizing}`}
      >
        <Phone className="h-3.5 w-3.5" /> {t("comm_log_activity")}
      </button>

      <EmailComposeButton
        template={emailTemplate}
        context={{
          recipientName: recipientName ?? undefined,
          recipientEmail: recipientEmail ?? undefined,
          lang,
          ...emailContext,
        }}
        linked={{
          type: linked.type === "quotation" ? "opportunity" : linked.type,
          id: linked.id,
          label: linked.label,
          ...linkedIds,
        }}
        size={size}
      />

      <button
        type="button"
        onClick={() => setWaOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-won/40 bg-won/10 text-won hover:bg-won/[0.16] font-medium px-3 py-1.5 text-xs transition-colors duration-150"
      >
        <MessageCircle className="h-3.5 w-3.5" /> {t("wa_button")}
      </button>

      {linkedIds.opportunityId ? (
        <button
          type="button"
          onClick={() => setFollowUpOpen(true)}
          className={`inline-flex items-center gap-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground font-medium ${sizing}`}
        >
          <ListPlus className="h-3.5 w-3.5" /> {t("comm_add_followup")}
        </button>
      ) : null}

      <ActionDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        title={t("comm_log_activity")}
        submitLabel={t("crm_add")}
        fields={
          [
            {
              key: "type",
              type: "select",
              label: t("crm_filter_all_types"),
              required: true,
              defaultValue: "call",
              options: LOGGABLE_TYPES.map((a) => ({ value: a, label: t(`activity_type_${a}` as never) })),
            },
            { key: "summary", type: "text", label: t("activity_summary") },
          ] satisfies DialogField[]
        }
        onSubmit={async (v) => {
          try {
            await logActivity({
              type: v.type as ActivityType,
              summary: v.summary || undefined,
              ...linkedIds,
            });
            toast.success(t("crm_saved"));
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />

      <WhatsAppComposeModal
        open={waOpen}
        onOpenChange={setWaOpen}
        recipientPhone={recipientPhone}
        vars={{ contact_name: recipientName, record_name: linked.label }}
        linked={{
          type: linked.type === "project" || linked.type === "quotation" ? "opportunity" : linked.type,
          id: linked.id,
          label: linked.label,
          ...linkedIds,
        }}
      />

      <ActionDialog
        open={followUpOpen}
        onOpenChange={setFollowUpOpen}
        title={t("comm_add_followup")}
        submitLabel={t("crm_add")}
        fields={
          [
            { key: "dueDate", type: "date", label: t("label_due"), required: true },
            { key: "notes", type: "textarea", label: t("wf_notes") },
          ] satisfies DialogField[]
        }
        onSubmit={async (v) => {
          if (!linkedIds.opportunityId) return;
          try {
            await scheduleFollowUp({
              opportunityId: linkedIds.opportunityId,
              dueDate: v.dueDate,
              notes: v.notes || undefined,
            });
            toast.success(t("crm_saved"));
          } catch (e) {
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </div>
  );
}
