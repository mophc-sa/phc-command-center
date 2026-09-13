/** Dates select a creation cohort, not a historical snapshot or outcome period. */
export type ReportScope = { owner: string; from: string; to: string };
export function inReportCohort(row: { created_at?: string | null; owner_id?: string | null }, scope: ReportScope): boolean {
  if (scope.owner !== "all" && row.owner_id !== scope.owner) return false;
  if (!scope.from && !scope.to) return true;
  const date = row.created_at?.slice(0, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return (!scope.from || date >= scope.from) && (!scope.to || date <= scope.to);
}
