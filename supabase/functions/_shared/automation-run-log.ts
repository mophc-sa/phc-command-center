// PHC Sales OS — automation trigger parsing.
//
// This module used to own the run log too (startRun/finishRun). Those are gone
// because the rules moved into the database on 2026-08-06: public.run_sales_automations()
// opens and closes its own automation_runs row in the same transaction as the
// rules it logs, which is strictly better — a run can no longer be recorded as
// finished when the work didn't finish, and vice versa.
//
// What remains is the one thing the HTTP layer still decides: whether this
// invocation came from a person clicking the button or from the scheduler.

export type AutomationTrigger = "manual" | "cron";

/**
 * Reads the trigger off the request payload. Anything unrecognised is "manual",
 * because a request that reached the authenticated Edge Function had a user
 * behind it by definition — only pg_cron calls the SQL function directly, and
 * it passes its own trigger value.
 */
export function readTrigger(payload: Record<string, unknown>): AutomationTrigger {
  return payload.trigger === "cron" ? "cron" : "manual";
}
