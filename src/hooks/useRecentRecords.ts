import { useState, useCallback } from "react";

export type RecentRecord = {
  id: string;
  type: string;
  label: string;
  to: string;
  visitedAt: number;
};

const STORAGE_KEY = "phc:recent";
const MAX_RECENT = 5;

function loadRecent(): RecentRecord[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveRecent(items: RecentRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function useRecentRecords() {
  const [recent, setRecent] = useState<RecentRecord[]>(loadRecent);

  const trackRecent = useCallback((record: RecentRecord) => {
    setRecent((prev) => {
      const filtered = prev.filter((r) => r.to !== record.to);
      const next = [record, ...filtered].slice(0, MAX_RECENT);
      saveRecent(next);
      return next;
    });
  }, []);

  const removeRecent = useCallback((to: string) => {
    setRecent((prev) => {
      const next = prev.filter((r) => r.to !== to);
      saveRecent(next);
      return next;
    });
  }, []);

  return { recent, trackRecent, removeRecent };
}
