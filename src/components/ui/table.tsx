// =============================================================================
// The one table in this application.
//
// Sixteen pages hand-rolled their own <table> and this file had no importers at
// all, so two lists of the same kind of record could differ by a third in row
// height: contacts rendered at text-base next to the award queue at text-xs.
// Density is not decoration on a sales system — it decides how many deals a
// person sees without scrolling, and a reader who learns one list should read
// every other one the same way.
//
// Three decisions live here rather than at 16 call sites:
//   · density — px-4 py-2.5, text-sm; headers a step smaller and quieter.
//   · direction — text-start, never text-left, so Arabic mirrors.
//   · semantics — every header cell is scope="col" by default, and the caption
//     is read by screen readers while staying out of the visual layout.
// =============================================================================

import * as React from "react";

import { cn } from "@/lib/utils";

/** Wraps the table so a wide one scrolls inside its own box, not the page. */
const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-x-auto">
      <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  ),
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b [&_tr]:border-border", className)} {...props} />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn("border-t border-border font-medium [&>tr]:last:border-b-0", className)}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b border-border/60 transition-colors hover:bg-surface-2 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, scope, ...props }, ref) => (
  <th
    ref={ref}
    // Defaulted, not required: a column header that does not say it is one
    // leaves a screen reader announcing cells with no context, and that was
    // true of 15 of the app's 16 tables.
    scope={scope ?? "col"}
    className={cn(
      "whitespace-nowrap px-4 py-2 text-start align-middle text-2xs font-semibold tracking-[0.02em] text-muted-foreground",
      className,
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td ref={ref} className={cn("px-4 py-2.5 text-start align-middle", className)} {...props} />
));
TableCell.displayName = "TableCell";

/**
 * Names the table for a screen reader.
 *
 * Hidden by default: sighted readers already have the section heading above
 * the table, and a second visible title repeats it. Pass a className to show
 * it where a real caption is wanted.
 */
const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn("sr-only", className)} {...props} />
));
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
