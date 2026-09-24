"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ArrowDownAZ, ArrowUpZA, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc";
export type FilterValue = { value: string; count: number };

/**
 * Google-Sheets-style column filter: a funnel icon for a column header that
 * opens a popover with Sort A→Z / Z→A and a searchable checklist of the
 * column's distinct values. `selected === null` means "everything checked".
 *
 * Presentational only — the owning table keeps the selection/sort state and
 * decides which rows to hide (see `rowPassesFilters`).
 */
export function ColumnFilterPopover({
  label,
  values,
  selected,
  onChange,
  sortDir,
  onSort,
}: {
  label: string;
  /** Distinct values in the column, in display order, with how many rows have each. */
  values: FilterValue[];
  selected: Set<string> | null;
  onChange: (next: Set<string> | null) => void;
  /** Current sort on this column, if it's the sorted one. */
  sortDir?: SortDir | null;
  onSort?: (dir: SortDir) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Set<string>>(new Set());
  const [query, setQuery] = React.useState("");
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const active = selected !== null && values.some((v) => !selected.has(v.value));
  const PANEL_WIDTH = 256;

  function openPanel() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - PANEL_WIDTH - 8);
      setPos({ top: rect.bottom + 4, left });
    }
    setDraft(new Set(selected ?? values.map((v) => v.value)));
    setQuery("");
    setOpen(true);
  }

  // Close on outside click, Escape, or any scroll/resize (the panel is
  // fixed-positioned, so it would otherwise drift away from its header).
  React.useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const shown = q ? values.filter((v) => v.value.toLowerCase().includes(q)) : values;
  const totalRows = values.reduce((s, v) => s + v.count, 0);
  const displayingRows = values.reduce((s, v) => s + (draft.has(v.value) ? v.count : 0), 0);

  function toggle(value: string) {
    setDraft((d) => {
      const next = new Set(d);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }
  function setShown(checked: boolean) {
    setDraft((d) => {
      const next = new Set(d);
      for (const v of shown) {
        if (checked) next.add(v.value);
        else next.delete(v.value);
      }
      return next;
    });
  }
  function commit() {
    const allChecked = values.every((v) => draft.has(v.value));
    onChange(allChecked ? null : draft);
    setOpen(false);
  }
  function sort(dir: SortDir) {
    onSort?.(dir);
    setOpen(false);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Filter ${label}`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          if (open) setOpen(false);
          else openPanel();
        }}
        className={cn(
          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-accent",
          active ? "text-primary" : "text-muted-foreground/70 hover:text-foreground",
        )}
      >
        <Filter className={cn("h-3 w-3", active && "fill-current")} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={`Filter ${label}`}
            style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH }}
            className="fixed z-50 rounded-md border border-border bg-card text-sm normal-case tracking-normal text-foreground shadow-lg"
          >
            {onSort && (
              <div className="border-b border-border p-1">
                <button
                  type="button"
                  onClick={() => sort("asc")}
                  className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent", sortDir === "asc" && "text-primary")}
                >
                  <ArrowDownAZ className="h-4 w-4" /> Sort A→Z
                </button>
                <button
                  type="button"
                  onClick={() => sort("desc")}
                  className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent", sortDir === "desc" && "text-primary")}
                >
                  <ArrowUpZA className="h-4 w-4" /> Sort Z→A
                </button>
              </div>
            )}

            <div className="space-y-2 p-2">
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search values…" className="h-8" autoFocus />
              <div className="flex gap-3 px-1 text-xs">
                <button type="button" onClick={() => setShown(true)} className="font-medium text-primary hover:underline">Select all</button>
                <button type="button" onClick={() => setShown(false)} className="font-medium text-primary hover:underline">Clear</button>
              </div>
              <ul className="max-h-56 overflow-y-auto">
                {shown.map((v) => (
                  <li key={v.value}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-accent">
                      <input
                        type="checkbox"
                        checked={draft.has(v.value)}
                        onChange={() => toggle(v.value)}
                        className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                      />
                      <span className="min-w-0 flex-1 truncate">{v.value}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{v.count}</span>
                    </label>
                  </li>
                ))}
                {shown.length === 0 && <li className="px-1 py-2 text-xs text-muted-foreground">No matching values</li>}
              </ul>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-2">
              <span className="text-xs text-muted-foreground">Displaying {displayingRows} of {totalRows}</span>
              <div className="flex gap-1.5">
                <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="button" size="sm" className="h-7 px-3" onClick={commit}>OK</Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * Helpers for a table using one or more ColumnFilterPopovers. A column is
 * described by how to read its display value from a row; filters is a map of
 * column key → selected values (absent/null = no filter on that column).
 */
export type FilterColumn<Row> = { key: string; valueOf: (row: Row) => string };

export function rowPassesFilters<Row>(
  row: Row,
  columns: FilterColumn<Row>[],
  filters: Record<string, Set<string> | null>,
  exceptKey?: string,
): boolean {
  for (const c of columns) {
    if (c.key === exceptKey) continue;
    const sel = filters[c.key];
    if (sel && !sel.has(c.valueOf(row))) return false;
  }
  return true;
}

/**
 * Distinct values for one column, counted over the rows that pass every
 * *other* column's filter (as Sheets does), so "Displaying X of Y" is exact.
 */
export function distinctValues<Row>(
  rows: Row[],
  column: FilterColumn<Row>,
  columns: FilterColumn<Row>[],
  filters: Record<string, Set<string> | null>,
  compare: (a: string, b: string) => number = (a, b) => a.localeCompare(b),
): FilterValue[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!rowPassesFilters(r, columns, filters, column.key)) continue;
    const v = column.valueOf(r);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return Array.from(counts, ([value, count]) => ({ value, count })).sort((a, b) => compare(a.value, b.value));
}
