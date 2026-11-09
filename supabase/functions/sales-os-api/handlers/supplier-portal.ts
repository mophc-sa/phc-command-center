// =============================================================================
// Supplier accounts and supplier downloads (pricing loop PR 3).
//
// supplier_account_create: a pricer (or the system administrator) creates a
//   portal account for one vendor. The database decides who may and records the
//   request (supplier_account_prepare, as the caller); the sign-in account is
//   created here with the service role, carrying the request id in
//   app_metadata (the only way past the @phc-sa.com rule, which a sign-up
//   cannot set); supplier_account_activate links it to the vendor. The answer
//   is a one-time set-password link the pricer sends to the supplier: no
//   automated email exists yet (Postmark is not approved, info@ is deferred).
// supplier_account_password_link: a new set-password link for an existing
//   supplier account (the old one expired, or the supplier lost it).
// supplier_file_download: the one action a supplier account may call. The
//   database checks, as the caller, that the file is its own and the exact
//   version sent (supplier_portal_file answers with the neutral name only);
//   then, with the service client, _supplier_portal_file_location re-runs the
//   same checks for this caller's user id, audits the download and says where
//   the bytes are. The bytes are read here with the service client, the
//   object's version and time are read again (_supplier_portal_object_state) so
//   bytes replaced after the check are refused, and then streamed back under
//   the neutral name. A supplier never sees the database's error text. No signed URL and no storage path
//   ever leave this function: both carry the deal id and the original file
//   name, which is often the client's.
// =============================================================================

import type { HandlerModule, SalesOsContext } from "../contracts.ts";
import { json, err } from "../shared.ts";
import { corsHeaders } from "../../_shared/cors.ts";
import { appUrl, attachmentHeader, normalizeSupplierEmail } from "../../_shared/supplier-portal.ts";

const env = (k: string) => Deno.env.get(k);
// Largest supplier download served (the bytes are loaded into memory); PHC uploads are capped at 25 MB.
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

type DbError = { message?: string; code?: string } | null;

/** What anyone gets for a database error the functions did not raise on purpose. */
export const UNKNOWN_DB_ERROR = "The request could not be completed; try again. | تعذّر إتمام الطلب؛ أعد المحاولة.";
// The codes our SQL raises with its own bilingual rule text.
const RULE_CODES = new Set(["42501", "23514", "P0001"]);

/**
 * Staff get the database's own bilingual text for the rule codes, and the fixed
 * message for anything else (Postgres' text can name relations or internals).
 * A supplier never gets the database's text at all: `fallback` only.
 */
function dbError(e: DbError, fallback: string, forSupplier = false): Response {
  // A malformed id: never echo the input or Postgres' text.
  if (e?.code === "22P02") return err("Invalid request. | طلب غير صالح.", 400);
  const status = e?.code === "42501" ? 403 : e?.code === "23514" ? 400 : 409;
  if (forSupplier) return err(fallback, status);
  if (!e) return err(fallback, status);
  return err(e.code && RULE_CODES.has(e.code) && e.message ? e.message : UNKNOWN_DB_ERROR, status);
}

const FILE_CHANGED = "This file changed while it was being prepared; try again. | تغيّر هذا الملف أثناء تجهيزه؛ أعد المحاولة.";
type ObjectState = { version?: string | null; updated_at?: string | null } | null;

async function setPasswordLink(ctx: SalesOsContext, email: string): Promise<string | null> {
  const { data, error } = await ctx.svc.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${appUrl(env)}/reset-password` },
  });
  if (error) return null;
  return data?.properties?.action_link ?? null;
}

async function supplier_account_create(payload: Record<string, unknown>, ctx: SalesOsContext) {
  const vendorId = String(payload.vendorId ?? "");
  const fullName = String(payload.fullName ?? "").trim();
  const email = normalizeSupplierEmail(payload.email);
  if (!email) return err("Enter the supplier's email address. | أدخل بريد المورد.", 400);

  // 1. The database decides who may, and records the request.
  const { data: inviteId, error: prepareError } = await ctx.asCaller.rpc("supplier_account_prepare", {
    _vendor_id: vendorId,
    _email: email,
    _full_name: fullName,
  });
  if (prepareError || typeof inviteId !== "string") return dbError(prepareError, "Could not prepare the supplier account");

  // 2. The sign-in account. Only the service role can set app_metadata.
  const { data: created, error: createError } = await ctx.svc.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { phc_supplier_invite: inviteId },
  });
  if (createError || !created?.user) return err("Could not create the sign-in account", 409);

  // 3. Link it to the vendor and give it the supplier role; undo the sign-in account if that fails.
  const { error: activateError } = await ctx.svc.rpc("supplier_account_activate", {
    _invite_id: inviteId,
    _user_id: created.user.id,
  });
  if (activateError) {
    const { error: cleanupError } = await ctx.svc.auth.admin.deleteUser(created.user.id);
    if (cleanupError) {
      // Loud: an unlinked sign-in account is left behind. It holds no staff role and the
      // database guard stops it being approved as staff, but someone must delete it.
      console.error(`[supplier-portal] CLEANUP FAILED: sign-in account ${created.user.id} was created but not linked and could not be deleted: ${cleanupError.message}`);
      return err(
        `The supplier account could not be linked and the half-made sign-in account (${created.user.id}) could not be removed. Do not approve it; ask the administrator to delete it.`,
        500,
      );
    }
    return dbError(activateError, "Could not link the supplier account");
  }

  const url = await setPasswordLink(ctx, email);
  if (url) {
    await ctx.audit(ctx.svc, ctx.caller.userId, "supplier_account.link_issued", "user", created.user.id,
      { issued_by: ctx.caller.userId, had_mfa: false }, ctx.caller.roles);
  }
  return json({ ok: true, user_id: created.user.id, set_password_url: url });
}

async function supplier_account_password_link(payload: Record<string, unknown>, ctx: SalesOsContext) {
  const userId = String(payload.userId ?? "");
  const { data: email, error } = await ctx.asCaller.rpc("supplier_account_email", { _user_id: userId });
  if (error || typeof email !== "string") return dbError(error, "Not an active supplier account");
  // A link lets its holder set the password and sign in. For an account that already
  // has a verified second factor that would hand over half of the login, so only the
  // system administrator may re-link it (the password alone still cannot pass aal2).
  const { data: hadMfa, error: mfaError } = await ctx.svc.rpc("_supplier_account_has_verified_mfa", { _user_id: userId });
  if (mfaError || typeof hadMfa !== "boolean") return err("Could not check the account", 502);
  if (hadMfa && !ctx.caller.roles.includes("system_admin")) {
    return err(
      "This supplier already secured its account; ask the system administrator to reset it. | هذا المورد أمّن حسابه بالفعل؛ اطلب من مدير النظام إعادة تعيينه.",
      403,
    );
  }
  const url = await setPasswordLink(ctx, email);
  if (!url) return err("Could not make a set-password link", 502);
  await ctx.audit(ctx.svc, ctx.caller.userId, "supplier_account.link_issued", "user", userId,
    { issued_by: ctx.caller.userId, had_mfa: hadMfa }, ctx.caller.roles);
  return json({ ok: true, set_password_url: url });
}

async function supplier_file_download(payload: Record<string, unknown>, ctx: SalesOsContext) {
  const args = { _invitation_id: String(payload.invitationId ?? ""), _file_id: String(payload.fileId ?? "") };

  // 1. As the supplier (its session, aal2): its own request and file, the version sent.
  const { data: checked, error: checkError } = await ctx.asCaller.rpc("supplier_portal_file", args);
  if (checkError || !checked) return dbError(checkError, "This file is not available. | هذا الملف غير متاح.", true);

  // 2. As the service, for the same user: where the bytes are (and the audit row).
  const { data: located, error: locateError } = await ctx.svc.rpc("_supplier_portal_file_location", {
    ...args,
    _supplier_user: ctx.caller.userId,
  });
  if (locateError || !located) return dbError(locateError, "This file is not available. | هذا الملف غير متاح.", true);
  const file = located as {
    bucket: string; path: string; name: string; size_bytes: number | null;
    object_version: string | null; object_updated_at: string | null;
  };
  // The object is held in memory before it is streamed back. The size is storage's own;
  // an unknown size is refused rather than trusted.
  if (file.size_bytes == null || Number(file.size_bytes) > MAX_DOWNLOAD_BYTES) {
    return err("This file is too large to download here. | هذا الملف كبير جداً للتنزيل هنا.", 413);
  }

  // 3. The bytes, read with the service client and streamed back: never a link, never the path.
  const { data: blob, error: downloadError } = await ctx.svc.storage.from(file.bucket).download(file.path);
  if (downloadError || !blob) return err("Could not prepare the download. | تعذّر تجهيز التنزيل.", 502);

  // 4. The object could have been replaced between the check and the read: read its
  //    version and time again and serve the bytes only if they are still the ones checked.
  const { data: state, error: stateError } = await ctx.svc.rpc("_supplier_portal_object_state", { _file_id: args._file_id });
  const now = state as ObjectState;
  if (stateError || !now || (now.version ?? null) !== (file.object_version ?? null)
      || (now.updated_at ?? null) !== (file.object_updated_at ?? null)) {
    return err(FILE_CHANGED, 409);
  }
  return new Response(blob.stream(), {
    status: 200,
    headers: {
      ...corsHeaders,
      // octet-stream so supabase-js functions.invoke hands the portal a Blob; the
      // portal already has the file's type from supplier_portal_invitation.
      "Content-Type": "application/octet-stream",
      "Content-Length": String(blob.size),
      "Content-Disposition": attachmentHeader(file.name),
      "Access-Control-Expose-Headers": "Content-Disposition",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const supplierPortalModule: HandlerModule = {
  name: "supplier-portal",
  handlers: { supplier_account_create, supplier_account_password_link, supplier_file_download },
};
