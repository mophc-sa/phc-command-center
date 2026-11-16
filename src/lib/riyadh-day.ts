// Business "today" is the Riyadh calendar day, whatever the browser's or the
// server's clock zone. Pure (no Supabase) so metric modules can import it.

export function riyadhDay(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** A YYYY-MM-DD day plus `n` calendar days. Day arithmetic, no clock zone. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
