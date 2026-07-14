import { useState, useRef, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Input } from "@/components/ui/input";
import { ChevronUp, ChevronDown, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type { ColumnDef };

interface EntityDataGridProps<TData> {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
  /** Row count estimate used for virtual height. Defaults to data.length. */
  estimatedRowHeight?: number;
  /** Maximum visible height before virtual scroll kicks in (px). Default 520. */
  maxHeight?: number;
  /** Show a global filter input. Default true. */
  globalFilter?: boolean;
  /** Enable row selection checkboxes. Default false. */
  selectable?: boolean;
  onSelectionChange?: (selected: TData[]) => void;
  loading?: boolean;
  emptyMessage?: string;
  className?: string;
}

type Density = "compact" | "normal" | "comfortable";

const DENSITY_ROW_HEIGHT: Record<Density, number> = {
  compact: 32,
  normal: 40,
  comfortable: 52,
};

const DENSITY_PADDING: Record<Density, string> = {
  compact: "px-2 py-0.5",
  normal: "px-3 py-1.5",
  comfortable: "px-3 py-3",
};

export function EntityDataGrid<TData>({
  data,
  columns: columnDefs,
  estimatedRowHeight,
  maxHeight = 520,
  globalFilter: showFilter = true,
  selectable = false,
  onSelectionChange,
  loading = false,
  emptyMessage = "No records.",
  className,
}: EntityDataGridProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filter, setFilter] = useState("");
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [density, setDensity] = useState<Density>("normal");

  const rowHeight = estimatedRowHeight ?? DENSITY_ROW_HEIGHT[density];

  const selectionColumn: ColumnDef<TData, unknown> = useMemo(
    () => ({
      id: "_select",
      header: ({ table }) => (
        <input
          type="checkbox"
          className="accent-emerald-500"
          checked={table.getIsAllPageRowsSelected()}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          className="accent-emerald-500"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
          onClick={(e) => e.stopPropagation()}
        />
      ),
      size: 32,
      enableSorting: false,
    }),
    [],
  );

  const columns = useMemo(
    () => (selectable ? [selectionColumn, ...columnDefs] : columnDefs),
    [selectable, selectionColumn, columnDefs],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: filter, rowSelection },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    onRowSelectionChange: (updater) => {
      setRowSelection((old) => {
        const next = typeof updater === "function" ? updater(old) : updater;
        if (onSelectionChange) {
          const rows = table.getRowModel().rows.filter((r) => next[r.id]);
          onSelectionChange(rows.map((r) => r.original));
        }
        return next;
      });
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const rows = table.getRowModel().rows;
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  if (loading) {
    return (
      <div className="space-y-2 py-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-8 rounded bg-muted/30 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2">
        {showFilter ? (
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="pl-8 h-8 text-xs"
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        ) : <div />}
        <div className="flex items-center gap-1">
          {(["compact", "normal", "comfortable"] as Density[]).map((d) => (
            <button
              key={d}
              onClick={() => setDensity(d)}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                density === d
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {d === "compact" ? "S" : d === "normal" ? "M" : "L"}
            </button>
          ))}
          {selectable && Object.keys(rowSelection).length > 0 && (
            <span className="text-[10px] text-muted-foreground ml-1">
              {Object.keys(rowSelection).length} selected
            </span>
          )}
        </div>
      </div>

      {/* Table */}
      <div
        ref={parentRef}
        className="overflow-auto rounded-md border border-border"
        style={{ maxHeight }}
      >
        <table className="w-full text-xs border-collapse">
          {/* Sticky header */}
          <thead className="sticky top-0 z-10 bg-surface">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border">
                {hg.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  return (
                    <th
                      key={header.id}
                      className={cn(
                        "text-left font-medium text-muted-foreground select-none",
                        DENSITY_PADDING[density],
                        canSort && "cursor-pointer hover:text-foreground",
                      )}
                      style={{ width: header.getSize() }}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort && (
                          sorted === "asc" ? (
                            <ChevronUp className="h-3 w-3 shrink-0" />
                          ) : sorted === "desc" ? (
                            <ChevronDown className="h-3 w-3 shrink-0" />
                          ) : (
                            <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-40" />
                          )
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          {/* Virtualised body */}
          <tbody style={{ height: totalHeight, position: "relative" }}>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="py-10 text-center text-muted-foreground"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              virtualItems.map((vi) => {
                const row = rows[vi.index];
                return (
                  <tr
                    key={row.id}
                    data-index={vi.index}
                    ref={virtualizer.measureElement}
                    className="border-b border-border/50 hover:bg-muted/10 transition-colors"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${vi.start}px)`,
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={cn("text-foreground/90", DENSITY_PADDING[density])}
                        style={{ width: cell.column.getSize() }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && (
        <p className="text-[10px] text-muted-foreground text-right">
          {rows.length} row{rows.length !== 1 ? "s" : ""}
          {data.length !== rows.length ? ` (filtered from ${data.length})` : ""}
        </p>
      )}
    </div>
  );
}
