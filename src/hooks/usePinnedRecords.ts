import { useState, useCallback } from "react";

export type PinnedRecord = {
  id: string;
  type: "opportunity" | "account" | "contact" | "project" | "tender";
  label: string;
  to: string;
};

const STORAGE_KEY = "phc:pinned";
const MAX_PINS = 5;

function loadPinned(): PinnedRecord[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function savePinned(items: PinnedRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function usePinnedRecords() {
  const [pinned, setPinned] = useState<PinnedRecord[]>(loadPinned);

  const pin = useCallback((record: PinnedRecord) => {
    setPinned((prev) => {
      if (prev.some((p) => p.id === record.id)) return prev;
      const next = [record, ...prev].slice(0, MAX_PINS);
      savePinned(next);
      return next;
    });
  }, []);

  const unpin = useCallback((id: string) => {
    setPinned((prev) => {
      const next = prev.filter((p) => p.id !== id);
      savePinned(next);
      return next;
    });
  }, []);

  const isPinned = useCallback(
    (id: string) => pinned.some((p) => p.id === id),
    [pinned],
  );

  return { pinned, pin, unpin, isPinned };
}
