import { useCallback, useEffect, useState } from "react";

export type FontScale = "sm" | "md" | "lg" | "xl";

const STORAGE_KEY = "phc-font-scale";
const DEFAULT: FontScale = "md";
const ORDER: FontScale[] = ["sm", "md", "lg", "xl"];

function readInitial(): FontScale {
  if (typeof window === "undefined") return DEFAULT;
  const v = window.localStorage.getItem(STORAGE_KEY) as FontScale | null;
  return v && ORDER.includes(v) ? v : DEFAULT;
}

/**
 * User-controlled a11y font scale. Applies `data-font-scale` on <html>,
 * which the CSS reads to scale the root font-size (see src/styles.css).
 */
export function useFontScale() {
  const [scale, setScaleState] = useState<FontScale>(DEFAULT);

  useEffect(() => {
    const initial = readInitial();
    setScaleState(initial);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-font-scale", scale);
    try {
      window.localStorage.setItem(STORAGE_KEY, scale);
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [scale]);

  const setScale = useCallback((s: FontScale) => setScaleState(s), []);
  const increment = useCallback(() => {
    setScaleState((s) => ORDER[Math.min(ORDER.indexOf(s) + 1, ORDER.length - 1)]);
  }, []);
  const decrement = useCallback(() => {
    setScaleState((s) => ORDER[Math.max(ORDER.indexOf(s) - 1, 0)]);
  }, []);
  const reset = useCallback(() => setScaleState(DEFAULT), []);

  return { scale, setScale, increment, decrement, reset, options: ORDER };
}
