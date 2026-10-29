"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmptyState, LoadingSkeleton } from "./feedback";

export interface DataTableColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  /** Provide to make the column sortable. */
  sortValue?: (row: T) => string | number;
  className?: string;
  /** Hide on narrow viewports to avoid horizontal overflow. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  align?: "left" | "right";
}

export interface SortState {
  id: string;
  dir: "asc" | "desc";
}

/** Server-side paging: `data` is the current page; sorting is off (a page can't be sorted meaningfully on its own). */
export interface ServerPagination {
  /** 1-based, as in the API. */
  page: number;
  total: number;
  onPageChange: (page: number) => void;
}

const hideClass = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell", xl: "hidden xl:table-cell" } as const;

export function DataTable<T>({
  data,
  columns,
  getRowId,
  onRowClick,
  activeRowId,
  selectable = false,
  selectedIds,
  onSelectionChange,
  pageSize = 10,
  initialSort,
  isLoading = false,
  emptyTitle = "Nothing to show",
  emptyDescription = "Try adjusting your search or filters.",
  emptyAction,
  caption,
  serverPagination,
}: {
  data: T[];
  columns: DataTableColumn<T>[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  activeRowId?: string | null;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  pageSize?: number;
  initialSort?: SortState;
  isLoading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  caption: string;
  serverPagination?: ServerPagination;
}) {
  const server = serverPagination;
  const [sort, setSort] = useState<SortState | undefined>(initialSort);
  const [requestedPage, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (server || !sort) return data;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return data;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...data].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * factor;
      return String(va).localeCompare(String(vb)) * factor;
    });
  }, [data, columns, sort, server]);

  const totalRows = server ? server.total : sorted.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const page = server ? server.page - 1 : Math.min(requestedPage, pageCount - 1);
  const rows = server ? data : sorted.slice(page * pageSize, page * pageSize + pageSize);
  const goToPage = (p: number) => (server ? server.onPageChange(p + 1) : setPage(p));
  const pageIds = rows.map(getRowId);
  const allOnPageSelected = selectable && pageIds.length > 0 && pageIds.every((id) => selectedIds?.has(id));
  const someOnPageSelected = selectable && pageIds.some((id) => selectedIds?.has(id));

  function toggleSort(id: string) {
    setSort((prev) => (prev?.id !== id ? { id, dir: "asc" } : prev.dir === "asc" ? { id, dir: "desc" } : undefined));
  }

  function togglePage(checked: boolean) {
    const next = new Set(selectedIds);
    pageIds.forEach((id) => (checked ? next.add(id) : next.delete(id)));
    onSelectionChange?.(next);
  }

  function toggleRow(id: string, checked: boolean) {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    onSelectionChange?.(next);
  }

  if (isLoading) return <LoadingSkeleton variant="table" rows={Math.min(pageSize, 8)} />;

  return (
    <div className="min-w-0">
      <div className="scrollbar-thin overflow-x-auto px-2.5">
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {selectable ? (
                <th scope="col" className="w-10 bg-surface-muted py-2.5 pr-1 pl-3.5 first:rounded-l-xl">
                  <Checkbox
                    aria-label="Select all rows on this page"
                    checked={allOnPageSelected ? true : someOnPageSelected ? "indeterminate" : false}
                    onCheckedChange={(v) => togglePage(v === true)}
                  />
                </th>
              ) : null}
              {columns.map((col) => {
                const sorted = sort?.id === col.id ? sort.dir : undefined;
                return (
                  <th
                    key={col.id}
                    scope="col"
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                    className={cn(
                      "bg-surface-muted px-3 py-2.5 text-left text-[12px] font-medium whitespace-nowrap text-ink-muted first:rounded-l-xl first:pl-3.5 last:rounded-r-xl last:pr-3.5",
                      col.align === "right" && "text-right",
                      col.hideBelow && hideClass[col.hideBelow],
                      col.className
                    )}
                  >
                    {col.sortValue && !server ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.id)}
                        className={cn("inline-flex items-center gap-1 rounded-md hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none", col.align === "right" && "flex-row-reverse")}
                      >
                        {col.header}
                        {sorted === "asc" ? <ArrowUp className="size-3" /> : sorted === "desc" ? <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const id = getRowId(row);
              const selected = selectedIds?.has(id) ?? false;
              const active = activeRowId === id;
              return (
                <tr
                  key={id}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  aria-selected={selectable ? selected : undefined}
                  className={cn(
                    "group transition-colors duration-150 outline-none",
                    onRowClick && "cursor-pointer hover:bg-surface-muted/80 focus-visible:bg-surface-muted focus-visible:shadow-[inset_3px_0_0_var(--dv-brand)]",
                    (selected || active) && "bg-brand-tint hover:bg-brand-tint"
                  )}
                >
                  {selectable ? (
                    <td className="border-b border-line/70 py-3 pr-1 pl-3.5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox aria-label="Select row" checked={selected} onCheckedChange={(v) => toggleRow(id, v === true)} />
                    </td>
                  ) : null}
                  {columns.map((col) => (
                    <td
                      key={col.id}
                      className={cn(
                        "border-b border-line/70 px-3 py-3 align-middle text-ink first:pl-3.5 last:pr-3.5",
                        col.align === "right" && "text-right tabular",
                        col.hideBelow && hideClass[col.hideBelow],
                        col.className
                      )}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length === 0 ? <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} /> : null}

      {totalRows > pageSize ? (
        <nav className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-[13px] text-ink-muted" aria-label="Pagination">
          <span className="tabular">
            {page * pageSize + 1}–{Math.min(totalRows, (page + 1) * pageSize)} of {totalRows}
          </span>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="icon-sm" onClick={() => goToPage(Math.max(0, page - 1))} disabled={page === 0} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <span className="tabular min-w-16 text-center">
              {page + 1} / {pageCount}
            </span>
            <Button variant="outline" size="icon-sm" onClick={() => goToPage(Math.min(pageCount - 1, page + 1))} disabled={page >= pageCount - 1} aria-label="Next page">
              <ChevronRight />
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
