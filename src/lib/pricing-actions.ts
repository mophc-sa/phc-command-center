// RPC wrappers for the pricing loop. Authorization is in SQL; these only call it
// and throw what the database says (the bilingual message is on error.message).
import { supabase } from "@/integrations/supabase/client";
import type { PricingState } from "@/lib/pricing";

async function call<T = Record<string, unknown>>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw error;
  return data as T;
}

/** Opens the deal's pricing file, or returns the one that is already open. */
export const openPricingFile = (opportunityId: string, rfqId?: string | null) =>
  call("open_pricing_file", { _opportunity_id: opportunityId, _rfq_id: rfqId ?? null });

/** Moves the file; the database checks the move against pricing_file_transitions. Closing and sending lines back need a note. */
export const movePricingFile = (fileId: string, to: PricingState, note?: string) =>
  call("pricing_file_move", { _file_id: fileId, _to: to, _note: note ?? null });

/** Package review -> needs_info. `due` is a date, YYYY-MM-DD, from today on. */
export const askNeedsInfo = (fileId: string, items: string[], due: string) =>
  call("pricing_file_set_needs_info", { _file_id: fileId, _items: items, _due: due });

export const answerNeedsInfo = (fileId: string, note: string) =>
  call("pricing_file_answer_needs_info", { _file_id: fileId, _note: note });

/** Returns how many new suggestions were added. */
export const suggestExtras = (fileId: string) =>
  call<number>("pricing_suggest_extras", { _file_id: fileId });

/** Accept (optionally with a different quantity or rate) or dismiss with a reason. */
export const decideExtra = (
  extraId: string,
  accept: boolean,
  opts: { quantity?: number; rate?: number; reason?: string } = {},
) =>
  call("pricing_decide_extra", {
    _extra_id: extraId,
    _accept: accept,
    _quantity: opts.quantity ?? null,
    _rate: opts.rate ?? null,
    _reason: opts.reason ?? null,
  });
