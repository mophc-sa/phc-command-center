// The supplier portal's calls (pricing loop PR 3). A supplier account has no
// table access: everything goes through the supplier_portal_* functions, which
// check the session's vendor and MFA themselves. File bytes come from
// sales-os-api (supplier_file_download), streamed under the neutral name: a
// supplier has no storage access and never sees a storage path or a signed link.
import { supabase } from "@/integrations/supabase/client";
import type { Lang } from "@/lib/i18n";
import type { PortalInvitation, PortalListRow, SubmissionLine, SubmissionTerms } from "@/lib/supplier-portal";

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw error;
  return data as T;
}

export const listPortalInvitations = () => call<PortalListRow[]>("supplier_portal_invitations", {});

export const getPortalInvitation = (invitationId: string) =>
  call<PortalInvitation>("supplier_portal_invitation", { _invitation_id: invitationId });

/** Answers only how many lines were sent (the quote id stays on PHC's side). */
export const submitPortalQuote = (invitationId: string, lines: SubmissionLine[], terms: SubmissionTerms, lang: Lang) =>
  call<{ lines: number }>("supplier_portal_submit", {
    _invitation_id: invitationId,
    _lines: lines,
    _terms: terms,
    _confirm_lang: lang,
  });

/** One file of the request, as the bytes sales-os-api streams back (no link, no storage path). */
export async function downloadPortalFile(invitationId: string, fileId: string): Promise<Blob> {
  const { data, error } = await supabase.functions.invoke("sales-os-api", {
    body: { action: "supplier_file_download", payload: { invitationId, fileId } },
  });
  if (error) {
    // Same as callBackend: surface the server's message (errors are JSON {error}).
    let message = error.message || "Could not download the file. | تعذّر تنزيل الملف.";
    try {
      const ctx = (error as { context?: Response }).context;
      const parsed = ctx ? await ctx.json() : null;
      if (parsed?.error) message = parsed.error;
    } catch {
      /* keep the generic message */
    }
    throw new Error(message);
  }
  if (!(data instanceof Blob)) throw new Error("Could not download the file. | تعذّر تنزيل الملف.");
  return data;
}
