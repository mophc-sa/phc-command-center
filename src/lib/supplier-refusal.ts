// Defence in depth (pricing loop PR 3): a supplier session is never handed to a
// third-party app (OAuth consent) or to the MCP tools. The database already
// refuses a supplier everything staff can read; this refuses earlier, and says why.
import type { Bi } from "@/lib/pricing-text";

export const SUPPLIER_REFUSED: Bi = {
  en: "Supplier accounts cannot connect apps or use this integration.",
  ar: "حسابات الموردين لا يمكنها ربط التطبيقات أو استخدام هذا التكامل.",
};
export const SUPPLIER_REFUSED_TEXT = `${SUPPLIER_REFUSED.en} | ${SUPPLIER_REFUSED.ar}`;

type RolesClient = {
  from: (t: "user_roles") => {
    select: (c: "role") => { eq: (c: "user_id", v: string) => PromiseLike<{ data: { role: string }[] | null; error: unknown }> };
  };
};

/** True when the user holds the supplier role. A failed lookup counts as a supplier: it fails closed. */
export async function isSupplierSession(sb: unknown, userId: string): Promise<boolean> {
  const { data, error } = await (sb as RolesClient).from("user_roles").select("role").eq("user_id", userId);
  if (error || !data) return true;
  return data.some((r) => r.role === "supplier");
}
