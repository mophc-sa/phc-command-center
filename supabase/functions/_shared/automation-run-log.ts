// PHC Sales OS — run log for the automation engine.
//
// Extracted from handlers/automation.ts, which is held to a 700-line ceiling by
// sales-os-api-modularization.contract.test.ts. Also the right home on its own
// terms: this is bookkeeping about a run, not a rule.
//
// Why it exists at all: once run_automations is on a scheduler, a job that
// silently stops firing is indistinguishable from a quiet day — the queue just
// goes quiet, and nothing surfaces that. This table is how you answer "did it
// actually run?".

type Svc = {
  from: (table: string) => any;
};

export type AutomationTrigger = "manual" | "cron";

/** Reads the trigger off the request payload. Anything unrecognised is manual. */
export function readTrigger(payload: Record<string, unknown>): AutomationTrigger {
  return payload.trigger === "cron" ? "cron" : "manual";
}

/**
 * Opens a run record. Best-effort by design: a logging failure must never stop
 * the rules from running, so this swallows its own errors and returns null.
 */
export async function startRun(svc: Svc, trigger: AutomationTrigger): Promise<string | null> {
  try {
    const { data } = await svc
      .from("automation_runs")
      .insert({ trigger })
      .select("id")
      .single();
    return (data as { id: string } | null)?.id ?? null;
  } catch (_) {
    return null;
  }
}

/**
 * Closes a run record.
 *
 * If a rule throws, this never runs, and the row keeps `finished_at IS NULL`.
 * That is the intended failure signal — a started-but-never-finished run is
 * exactly what you want to see when diagnosing:
 *
 *   SELECT * FROM automation_runs WHERE finished_at IS NULL ORDER BY started_at DESC;
 */
export async function finishRun(
  svc: Svc,
  runId: string | null,
  raised: number,
  error?: unknown,
): Promise<void> {
  if (!runId) return;
  try {
    await svc
      .from("automation_runs")
      .update({
        finished_at: new Date().toISOString(),
        raised,
        error: error ? String(error).slice(0, 500) : null,
      })
      .eq("id", runId);
  } catch (_) {
    // Logging must not mask the real outcome of the run.
  }
}
