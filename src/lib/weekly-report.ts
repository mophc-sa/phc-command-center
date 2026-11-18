// =============================================================================
// The weekly sales report, built from what actually changed (Omar's CRM review,
// point 13; Mo, 2026-11-18). Stage changes come from the audit log
// (opportunity.fields_changed, every writer, since 2026-11-16), so a deal moved
// by a person and one moved by the master-list sync both show, with their source.
// The week runs Sunday to Saturday, Riyadh calendar.
// =============================================================================
import { addDays } from "@/lib/riyadh-day";

export type WeekRange = { from: string; to: string };

/** The Sunday-to-Saturday week containing `today`, shifted by `offset` weeks. `to` is exclusive. */
export function weekOf(today: string, offset = 0): WeekRange {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  const from = addDays(today, -dow + offset * 7);
  return { from, to: addDays(from, 7) };
}

export type StageChange = {
  opportunityId: string;
  from: string | null;
  to: string | null;
  at: string;
  /** "data_sync" when the master-list sync made the change. */
  source: string;
};

export type ChangeKind = "verbal" | "signed" | "held" | "lost" | "moved";

export function changeKind(to: string | null): ChangeKind {
  if (to === "verbally_awarded") return "verbal";
  if (to === "contract_received" || to === "contract_signed" || to === "won") return "signed";
  if (to === "on_hold") return "held";
  if (to === "lost") return "lost";
  return "moved";
}

/** Counts for the report's headline: each deal once per kind, by its latest change in the week. */
export function weeklyCounts(changes: StageChange[], newDeals: number, quotesSent: number) {
  const latest = new Map<string, StageChange>();
  for (const c of [...changes].sort((a, b) => a.at.localeCompare(b.at))) latest.set(c.opportunityId, c);
  const kinds = [...latest.values()].map((c) => changeKind(c.to));
  const n = (k: ChangeKind) => kinds.filter((x) => x === k).length;
  return { newDeals, quotesSent, verbal: n("verbal"), signed: n("signed"), held: n("held"), lost: n("lost"), moved: n("moved") };
}
