import { Link } from "@tanstack/react-router";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** A short action list (image 04): verbal awards to close, overdue follow-ups. */
export function CloseList({ title, empty, head, rows }: {
  title: string; empty: string; head: string[];
  rows: { id: string; project: string; account: string; third: string; fourth: string; action?: boolean }[];
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-2 text-base font-semibold text-foreground">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <Table>
          <TableHeader><TableRow>{head.map((h, i) => <TableHead key={i}>{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell><Link to="/opportunities/$id" params={{ id: r.id }} className="font-medium text-foreground hover:underline">{r.project}</Link></TableCell>
                <TableCell className="text-muted-foreground">{r.account}</TableCell>
                <TableCell className="tabular-nums">{r.third}</TableCell>
                <TableCell>
                  {r.action ? (
                    <Link to="/opportunities/$id" params={{ id: r.id }} className="inline-flex min-h-8 items-center rounded-md border border-primary/50 px-3 text-sm font-medium hover:bg-primary/10">{r.fourth}</Link>
                  ) : (
                    <span className="text-sm text-primary">{r.fourth}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

