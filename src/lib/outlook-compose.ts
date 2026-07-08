// Best-effort audit log for the "Email via Outlook" compose action.
//
// Phase 1 rule: we log ONLY that a compose window was opened. We never log
// "sent" — real sending happens outside our app (in Outlook), and we do not
// integrate with Microsoft Graph in Phase 1. If the underlying activities
// table cannot accept the row (e.g. no linked opportunity), we swallow the
// error — the compose action itself must never be blocked by logging.

import { supabase } from "@/integrations/supabase/client";

export type OutlookComposeLog = {
  linked_record_type: string;
  linked_record_id: string;
  recipient_email: string;
  subject: string;
  body?: string | null;
  opportunityId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
};

export async function logOutlookComposeOpened(input: OutlookComposeLog): Promise<void> {
  try {
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id ?? null;

    // Reuse the existing `activities` table with the `email_draft` type,
    // status stays "draft" (never "sent"), and we tag the summary with the
    // compose_opened marker so timelines can filter these entries.
    const summary = `[outlook_compose_opened] ${input.subject}`.slice(0, 500);
    const draftContent = [
      `Recipient: ${input.recipient_email}`,
      `Linked: ${input.linked_record_type}#${input.linked_record_id}`,
      "",
      input.body ?? "",
    ]
      .join("\n")
      .slice(0, 8000);

    // Only attempt the insert if we can attach it to at least one FK that RLS
    // will allow the current user to see. Otherwise, fall back to audit_log.
    if (input.opportunityId || input.companyId || input.contactId) {
      await supabase.from("activities").insert({
        activity_type: "email_draft",
        status: "draft",
        summary,
        draft_content: draftContent,
        related_opportunity_id: input.opportunityId ?? null,
        company_id: input.companyId ?? null,
        contact_id: input.contactId ?? null,
        occurred_at: new Date().toISOString(),
        owner_id: uid,
        created_by: uid,
      });
    }

    await supabase.from("audit_log").insert({
      actor_id: uid,
      actor_type: "user",
      action: "outlook_compose_opened",
      entity_type: input.linked_record_type,
      entity_id: input.linked_record_id,
      after_value: {
        recipient_email: input.recipient_email,
        subject: input.subject,
        status: "compose_opened",
        opened_at: new Date().toISOString(),
      } as never,
    });
  } catch {
    // Silently ignore — Phase 1 must never block compose on a logging failure.
  }
}
