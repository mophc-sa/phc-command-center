import { useCallback } from "react";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { draftKey, hasContent, readDraft, type Draft } from "@/lib/form-draft";

/**
 * The browser-storage side of a draft, for forms that are not an ActionDialog
 * (which has this built in). Every access is wrapped: private windows and
 * blocked site data throw, and a form must never fail because of its draft.
 * See form-draft.ts for the rules.
 */
export function useFormDraft(formId: string | null) {
  const { user } = useAuth();
  const key = formId ? draftKey(user?.id, formId) : null;

  const read = useCallback((): Draft | null => {
    if (!key) return null;
    try {
      return readDraft(localStorage.getItem(key), Date.now());
    } catch {
      return null;
    }
  }, [key]);

  const save = useCallback(
    (values: Record<string, string>) => {
      if (!key) return;
      try {
        if (hasContent(values)) localStorage.setItem(key, JSON.stringify({ values, savedAt: Date.now() }));
        else localStorage.removeItem(key);
      } catch {
        // Storage full or disabled: the old behaviour, not a new failure.
      }
    },
    [key],
  );

  const clear = useCallback(() => {
    if (!key) return;
    try {
      localStorage.removeItem(key);
    } catch {
      // As above.
    }
  }, [key]);

  return { read, save, clear };
}
