// Best-effort audit log for the WhatsApp click-to-chat compose action.
//
// Phase 1 rule: we log ONLY that a chat window was opened. We never log
// "sent" — real sending happens outside our app (in WhatsApp), and there is
// no WhatsApp Business API integration in Phase 1. If the underlying
// activities table cannot accept the row (e.g. no linked record at all), we
// swallow the error — the compose action itself must never be blocked by
// logging.

import { supabase } from "@/integrations/supabase/client";

export type WhatsAppComposeLog = {
  linked_record_type: string;
  linked_record_id: string;
  recipient_phone: string;
  message: string;
  opportunityId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
  rfqId?: string | null;
  tenderId?: string | null;
  templateId?: string | null;
};

export async function logWhatsAppOpened(input: WhatsAppComposeLog): Promise<void> {
  try {
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id ?? null;

    const summary = `[whatsapp_opened] ${input.message}`.slice(0, 500);
    const draftContent = [
      `Recipient: ${input.recipient_phone}`,
      `Linked: ${input.linked_record_type}#${input.linked_record_id}`,
      "",
      input.message,
    ]
      .join("\n")
      .slice(0, 8000);

    const hasLink =
      input.opportunityId || input.companyId || input.contactId || input.rfqId || input.tenderId;
    if (hasLink) {
      await supabase.from("activities").insert({
        activity_type: "whatsapp_draft",
        status: "draft",
        summary,
        draft_content: draftContent,
        related_opportunity_id: input.opportunityId ?? null,
        company_id: input.companyId ?? null,
        contact_id: input.contactId ?? null,
        related_rfq_id: input.rfqId ?? null,
        related_tender_id: input.tenderId ?? null,
        template_id: input.templateId ?? null,
        occurred_at: new Date().toISOString(),
        owner_id: uid,
        created_by: uid,
      });
    }

    await supabase.from("audit_log").insert({
      actor_id: uid,
      actor_type: "user",
      action: "whatsapp_compose_opened",
      entity_type: input.linked_record_type,
      entity_id: input.linked_record_id,
      after_value: {
        recipient_phone: input.recipient_phone,
        status: "compose_opened",
        opened_at: new Date().toISOString(),
      } as never,
    });
  } catch {
    // Silently ignore — Phase 1 must never block compose on a logging failure.
  }
}
