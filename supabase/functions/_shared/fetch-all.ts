type PageQuery<T> = { range(from: number, to: number): PromiseLike<{ data: T[] | null; error: unknown }> };
/** Callers must order by a unique key. Never turn a failed/truncated read into success. */
export async function fetchComplete<T>(query: () => PageQuery<T>, maxRows = 100_000): Promise<{ data: T[] }> {
  const data: T[] = [];
  for (let offset = 0; offset <= maxRows; offset += 500) {
    const page = await query().range(offset, offset + 499);
    if (page.error) throw page.error;
    if (!page.data) throw new Error("Missing query result");
    data.push(...page.data);
    if (data.length > maxRows) throw new Error(`Result exceeds ${maxRows} rows; narrow the batch`);
    if (page.data.length < 500) return { data };
  }
  throw new Error("Incomplete query result");
}
