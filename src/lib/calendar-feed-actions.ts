// =============================================================================
// A person's private Outlook calendar link — the browser side.
//
// Every action acts on the signed-in caller's own link; none takes a user id.
// The link itself is returned once by createCalendarFeed and never again. See
// supabase/functions/sales-os-api/handlers/calendar-feed.ts.
// =============================================================================

import { callBackend } from "@/lib/backend";

export type CalendarFeedStatus = {
  active: boolean;
  created_at: string | null;
  last_fetched_at: string | null;
};

export async function getCalendarFeedStatus(): Promise<CalendarFeedStatus> {
  const r = await callBackend<Partial<CalendarFeedStatus>>("calendar_feed_status", {});
  return {
    active: r?.active === true,
    created_at: r?.created_at ?? null,
    last_fetched_at: r?.last_fetched_at ?? null,
  };
}

export async function createCalendarFeed(): Promise<{ url: string }> {
  const r = await callBackend<{ url?: string }>("calendar_feed_create", {});
  if (!r?.url) throw new Error("Could not create the calendar link");
  return { url: r.url };
}

export async function revokeCalendarFeed(): Promise<void> {
  await callBackend("calendar_feed_revoke", {});
}
