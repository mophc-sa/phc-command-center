// =============================================================================
// Sending email from inside the system — the browser side.
//
// Thin on purpose. The browser never holds the provider token and never builds
// the message headers: it sends what the person typed to the backend, which
// decides the sender, validates everything and talks to the provider. See
// supabase/functions/sales-os-api/handlers/mail.ts.
// =============================================================================

import { callBackend } from "@/lib/backend";

export type OutlookStatus = {
  /** Outlook connection is set up and the caller may connect. */
  available: boolean;
  connected: boolean;
  status: "active" | "needs_reconnect" | null;
  email: string | null;
};

export type MailStatus = { sending: boolean; capture: boolean; outlook: OutlookStatus };

export async function getMailStatus(): Promise<MailStatus> {
  const r = await callBackend<{ sending?: boolean; capture?: boolean; outlook?: Partial<OutlookStatus> }>("mail_status", {});
  const o = r?.outlook ?? {};
  return {
    sending: r?.sending === true,
    capture: r?.capture === true,
    outlook: {
      available: o.available === true,
      connected: o.connected === true,
      status: o.status === "active" || o.status === "needs_reconnect" ? o.status : null,
      email: typeof o.email === "string" ? o.email : null,
    },
  };
}

/** Where to send the browser to sign in to Microsoft. The backend keeps the verifier. */
export async function startOutlookConnect(): Promise<string> {
  const r = await callBackend<{ url?: string }>("outlook_connect_start", {});
  if (!r?.url) throw new Error("Could not start the Outlook sign-in");
  return r.url;
}

export async function disconnectOutlook(): Promise<void> {
  await callBackend("outlook_disconnect", {});
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

export type SendEmailResult = { sent: boolean; logged: boolean; activityId: string | null; via: "outlook" | "postmark" | null };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const r = await callBackend<{ sent?: boolean; logged?: boolean; activity_id?: string; via?: string }>("send_email", {
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
  const via = r?.via === "outlook" || r?.via === "postmark" ? r.via : null;
  return { sent: r?.sent === true, logged: r?.logged === true, activityId: r?.activity_id ?? null, via };
}
