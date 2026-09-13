// =============================================================================
// Sending email from inside the system — the browser side.
//
// Thin on purpose. The browser never holds the provider token and never builds
// the message headers: it sends what the person typed to the backend, which
// decides the sender, validates everything and talks to the provider. See
// supabase/functions/sales-os-api/handlers/mail.ts.
// =============================================================================

import { callBackend } from "@/lib/backend";

export type MailStatus = { sending: boolean; capture: boolean };

export async function getMailStatus(): Promise<MailStatus> {
  const r = await callBackend<{ sending?: boolean; capture?: boolean }>("mail_status", {});
  return { sending: r?.sending === true, capture: r?.capture === true };
}

export type SendEmailInput = {
  to: string;
  cc?: string;
  subject: string;
  body: string;
  opportunityId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
  rfqId?: string | null;
  tenderId?: string | null;
  templateId?: string | null;
};

export type SendEmailResult = { sent: boolean; logged: boolean; activityId: string | null };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const r = await callBackend<{ sent?: boolean; logged?: boolean; activity_id?: string }>("send_email", {
    to: input.to,
    cc: input.cc ?? "",
    subject: input.subject,
    body: input.body,
    opportunityId: input.opportunityId ?? null,
    companyId: input.companyId ?? null,
    contactId: input.contactId ?? null,
    rfqId: input.rfqId ?? null,
    tenderId: input.tenderId ?? null,
    templateId: input.templateId ?? null,
  });
  return { sent: r?.sent === true, logged: r?.logged === true, activityId: r?.activity_id ?? null };
}
