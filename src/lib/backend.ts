import { supabase } from "@/integrations/supabase/client";

// Single entry point to the PHC Sales OS backend layer (the `sales-os-api`
// Edge Function). Sensitive commercial decisions go through here so the rules
// are enforced server-side, not in the browser.
export async function callBackend<T = unknown>(
  action: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("sales-os-api", {
    body: { action, payload },
  });
  if (error) {
    // Surface the server-provided message when available.
    let message = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      const parsed = ctx ? await ctx.json() : null;
      if (parsed?.error) message = parsed.error;
    } catch {
      /* keep the generic message */
    }
    throw new Error(message);
  }
  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}
