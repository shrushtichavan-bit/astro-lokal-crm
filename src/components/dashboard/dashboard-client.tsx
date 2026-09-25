"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ListChecks, UserPlus, Settings2, ArrowRight, ChevronDown } from "lucide-react";
import { getRecentActivity } from "@/lib/actions/admin-actions";
import { getPipelineSnapshot, getAdminDashboardExtras, getPoolDashboard } from "@/lib/actions/dashboard-actions";
import type { ShellUser } from "@/components/app-shell";
import { PriorityBadge } from "@/components/priority-badge";
import { ActivityFeed } from "@/components/activity-feed";
import { RescheduleChip } from "@/components/reschedule-chip";
import {
  ColumnFilterPopover,
  distinctValues,
  rowPassesFilters,
  type FilterColumn,
  type SortDir,
} from "@/components/column-filter-popover";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type DateFilter = { from: string | null; to: string | null };
const NO_FILTER: DateFilter = { from: null, to: null };

type PendingDoneStat = { key: string; label: string; pending: number; done: number };
type LeadRow = {
  id: string;
  lead_id: string;
  name: string;
  contact: string;
  source: string | null;
  lead_date: string | null;
  priority: number;
  /** Who completed each earlier stage, keyed caller / r1_taker / ec_taker / rN_taker (pool dashboard Pending rows only). */
  takers?: Record<string, string | null | undefined> | null;
  /** Round 1 reschedule status while the lead is waiting on Round 1 (pool dashboard only). */
  reschedule?: { count: number; latest_to: string | null } | null;
};
type PendingGroup = { key: string; label: string; leads: LeadRow[] };
type RoleDashboardData = {
  pendingTotal: number;
  stats: PendingDoneStat[];
  pendingGroups: PendingGroup[];
  doneLeads: LeadRow[];
  myStages?: string[];
  /** Configured round count — decides how many R{n} Taker columns the Done table gets. */
  numRounds?: number;
};

function formatContact(c: string): string {
  const digits = (c ?? "").replace(/\D/g, "");
  return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : c;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function todayLong(): string {
  return new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

function DateRangeFilter({ onApply }: { onApply: (f: DateFilter) => void }) {
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  return (
    <div className="mb-6 flex flex-wrap items-end gap-3">
      <div>
        <Label className="text-xs">From</Label>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </div>
      <div>
        <Label className="text-xs">To</Label>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <Button size="sm" onClick={() => onApply({ from: from || null, to: to || null })}>
        Apply
      </Button>
    </div>
  );
}

/** "lead_date" | "priority" | "source", or a taker column key (caller, r1_taker, …). */
type LeadSortKey = string;

const EMPTY_TAKER = "—";
const sourceOf = (l: LeadRow) => l.source ?? "Direct";
const priorityLabel = (l: LeadRow) => `S${l.priority}`;
const takerOf = (key: string) => (l: LeadRow) => l.takers?.[key] || EMPTY_TAKER;
const BASE_FILTER_COLUMNS: FilterColumn<LeadRow>[] = [
  { key: "source", valueOf: sourceOf },
  { key: "priority", valueOf: priorityLabel },
];
const byPriorityLabel = (a: string, b: string) => Number(a.slice(1)) - Number(b.slice(1));
// Names A→Z, with "—" (stage not taken yet) always listed last.
const byTakerName = (a: string, b: string) =>
  a === EMPTY_TAKER ? (b === EMPTY_TAKER ? 0 : 1) : b === EMPTY_TAKER ? -1 : a.localeCompare(b);

/**
 * An extra column after the base five. Taker columns only need key + label
 * (value = that stage's taker, or "—"); others like Reschedule supply their
 * own filter/sort value and cell renderer.
 */
type TakerColumn = {
  key: string;
  label: string;
  value?: (l: LeadRow) => string;
  render?: (l: LeadRow) => React.ReactNode;
};
const columnValue = (c: TakerColumn) => c.value ?? takerOf(c.key);

const RESCHEDULE_COLUMN: TakerColumn = {
  key: "reschedule",
  label: "Reschedule",
  value: (l) => (l.reschedule ? `Rescheduled ${l.reschedule.count}` : EMPTY_TAKER),
  render: (l) =>
    l.reschedule ? <RescheduleChip count={l.reschedule.count} latestTo={l.reschedule.latest_to} /> : <span className="text-muted-foreground">{EMPTY_TAKER}</span>,
};

/** Every taker column in pipeline order: Caller, R1 Taker, EC Taker, R2 Taker … R{numRounds} Taker. */
function allTakerColumns(numRounds: number): TakerColumn[] {
  const laterRounds = Array.from({ length: Math.max(numRounds - 1, 0) }, (_, i) => ({ key: `r${i + 2}_taker`, label: `R${i + 2} Taker` }));
  return [{ key: "caller", label: "Caller" }, { key: "r1_taker", label: "R1 Taker" }, { key: "ec_taker", label: "EC Taker" }, ...laterRounds];
}

/**
 * Taker columns for a Pending group: one for every stage before the group's
 * own, in pipeline order (Calling → Round 1 → Expert Creation → Round 2 → …).
 */
function takerColumnsFor(groupKey: string, numRounds: number): TakerColumn[] {
  const all = allTakerColumns(Math.max(numRounds, 2));
  if (groupKey === "round_1") return all.slice(0, 1);
  if (groupKey === "expert_creation") return all.slice(0, 2);
  const m = groupKey.match(/^round_(\d+)$/);
  if (m && Number(m[1]) >= 2) return all.slice(0, Number(m[1]) + 1);
  return [];
}

// Fixed pixel widths (table-fixed) so every table shares the same px-3
// gutter and column slots; Name has no fixed width and absorbs the slack.
// SP is sized to its chip, not to a long header label.
const COL_W = { contact: 120, source: 150, sp: 68, date: 104, taker: 130, action: 116 };
const NAME_MIN_W = 160;

function LeadRowsTable({ leads, takerColumns = [] }: { leads: LeadRow[]; takerColumns?: TakerColumn[] }) {
  const [sortKey, setSortKey] = React.useState<LeadSortKey | null>(null);
  const [sortDir, setSortDir] = React.useState<SortDir>("asc");
  const [filters, setFilters] = React.useState<Record<string, Set<string> | null>>({});

  function toggleSort(key: LeadSortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }
  function sortBy(key: LeadSortKey, dir: SortDir) {
    setSortKey(key);
    setSortDir(dir);
  }

  const takerFilterColumns = React.useMemo(
    () => takerColumns.map((c): FilterColumn<LeadRow> => ({ key: c.key, valueOf: columnValue(c) })),
    [takerColumns],
  );
  const filterColumns = React.useMemo(() => [...BASE_FILTER_COLUMNS, ...takerFilterColumns], [takerFilterColumns]);

  const visible = leads.filter((l) => rowPassesFilters(l, filterColumns, filters));
  const sorted = [...visible].sort((a, b) => {
    if (!sortKey) return 0;
    if (sortKey !== "lead_date" && sortKey !== "source" && sortKey !== "priority") {
      const col = takerColumns.find((c) => c.key === sortKey);
      const valueOf = col ? columnValue(col) : takerOf(sortKey);
      const cmp = byTakerName(valueOf(a), valueOf(b));
      return sortDir === "asc" ? cmp : -cmp;
    }
    const av = sortKey === "lead_date" ? (a.lead_date ?? "") : sortKey === "source" ? sourceOf(a).toLowerCase() : a.priority;
    const bv = sortKey === "lead_date" ? (b.lead_date ?? "") : sortKey === "source" ? sourceOf(b).toLowerCase() : b.priority;
    if (av === bv) return 0;
    return sortDir === "asc" ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });

  const sourceValues = distinctValues(leads, BASE_FILTER_COLUMNS[0], filterColumns, filters);
  const priorityValues = distinctValues(leads, BASE_FILTER_COLUMNS[1], filterColumns, filters, byPriorityLabel);
  const setFilter = (key: string) => (next: Set<string> | null) => setFilters((f) => ({ ...f, [key]: next }));
  const hiddenCount = leads.length - visible.length;

  const sortArrow = (key: LeadSortKey) => (sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "");
  const colCount = 6 + takerColumns.length;
  const minWidth = NAME_MIN_W + COL_W.contact + COL_W.source + COL_W.sp + COL_W.date + COL_W.action + COL_W.taker * takerColumns.length;

  return (
    <>
      <Table className="table-fixed" style={{ minWidth }}>
        <colgroup>
          <col />
          <col style={{ width: COL_W.contact }} />
          <col style={{ width: COL_W.source }} />
          <col style={{ width: COL_W.sp }} />
          <col style={{ width: COL_W.date }} />
          {takerColumns.map((c) => <col key={c.key} style={{ width: COL_W.taker }} />)}
          <col style={{ width: COL_W.action }} />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap">Name</TableHead>
            <TableHead className="whitespace-nowrap">Contact</TableHead>
            <TableHead className="whitespace-nowrap">
              <div className="flex items-center gap-1">
                <span>Source{sortArrow("source")}</span>
                <ColumnFilterPopover
                  label="Source"
                  values={sourceValues}
                  selected={filters.source ?? null}
                  onChange={setFilter("source")}
                  sortDir={sortKey === "source" ? sortDir : null}
                  onSort={(dir) => sortBy("source", dir)}
                />
              </div>
            </TableHead>
            <TableHead className="whitespace-nowrap">
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => toggleSort("priority")} className="uppercase tracking-wide hover:text-foreground">
                  SP{sortArrow("priority")}
                </button>
                <ColumnFilterPopover
                  label="SP"
                  values={priorityValues}
                  selected={filters.priority ?? null}
                  onChange={setFilter("priority")}
                  sortDir={sortKey === "priority" ? sortDir : null}
                  onSort={(dir) => sortBy("priority", dir)}
                />
              </div>
            </TableHead>
            <TableHead onClick={() => toggleSort("lead_date")} className="cursor-pointer select-none whitespace-nowrap hover:text-foreground">
              Date{sortArrow("lead_date")}
            </TableHead>
            {takerColumns.map((c, i) => (
              <TableHead key={c.key} className="whitespace-nowrap">
                <div className="flex items-center gap-1">
                  <span>{c.label}{sortArrow(c.key)}</span>
                  <ColumnFilterPopover
                    label={c.label}
                    values={distinctValues(leads, takerFilterColumns[i], filterColumns, filters, byTakerName)}
                    selected={filters[c.key] ?? null}
                    onChange={setFilter(c.key)}
                    sortDir={sortKey === c.key ? sortDir : null}
                    onSort={(dir) => sortBy(c.key, dir)}
                  />
                </div>
              </TableHead>
            ))}
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((l) => (
            <TableRow key={l.id}>
              <TableCell className="truncate font-medium text-foreground">{l.name}</TableCell>
              <TableCell className="truncate tabular-nums text-muted-foreground">{formatContact(l.contact)}</TableCell>
              <TableCell className="truncate">
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{sourceOf(l)}</span>
              </TableCell>
              <TableCell><PriorityBadge priority={l.priority} /></TableCell>
              <TableCell className="truncate text-muted-foreground">{l.lead_date ?? "—"}</TableCell>
              {takerColumns.map((c) => {
                if (c.render) return <TableCell key={c.key}>{c.render(l)}</TableCell>;
                const person = l.takers?.[c.key];
                return (
                  <TableCell key={c.key} className={cn("truncate", person ? "text-foreground" : "text-muted-foreground")}>
                    {person || EMPTY_TAKER}
                  </TableCell>
                );
              })}
              <TableCell className="text-right">
                <Button asChild size="sm">
                  <Link href={`/leads/${l.id}`}>View Lead</Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {sorted.length === 0 && (
            <TableRow>
              <TableCell colSpan={colCount} className="py-6 text-center text-sm text-muted-foreground">
                No leads match the column filters.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {hiddenCount > 0 && (
        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <span>{hiddenCount} lead{hiddenCount === 1 ? "" : "s"} hidden by column filters</span>
          <button type="button" onClick={() => setFilters({})} className="font-medium text-primary hover:underline">Clear filters</button>
        </div>
      )}
    </>
  );
}

/** A snapshot stat card showing a Pending (orange) / Done (green) pair. Always renders, even at 0/0. */
function StatCard({ stat }: { stat: PendingDoneStat }) {
  return (
    <Card className="w-44 shrink-0">
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{stat.label}</p>
        <div className="mt-2 flex items-baseline gap-5">
          <div>
            <p className="text-xl font-bold tabular-nums text-primary">{stat.pending}</p>
            <p className="text-[11px] text-muted-foreground">Pending</p>
          </div>
          <div>
            <p className="text-xl font-bold tabular-nums text-success">{stat.done}</p>
            <p className="text-[11px] text-muted-foreground">Done</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardClient({ user }: { user: ShellUser }) {
  if (user.role === "admin") return <AdminDashboard user={user} />;
  return <PoolDashboard user={user} />;
}

/* ===================== ADMIN / KAM (identical view) ===================== */

function AdminDashboard({ user }: { user: ShellUser }) {
  const [dateFilter, setDateFilter] = React.useState<DateFilter>(NO_FILTER);

  const snapshotQ = useQuery({ queryKey: ["dashboard-pipeline-snapshot", dateFilter], queryFn: () => getPipelineSnapshot(dateFilter), staleTime: 0, refetchInterval: 30_000 });
  const extrasQ = useQuery({ queryKey: ["dashboard-admin-extras", dateFilter], queryFn: () => getAdminDashboardExtras(dateFilter), staleTime: 0, refetchInterval: 30_000 });
  const activityQ = useQuery({ queryKey: ["dashboard-activity", dateFilter], queryFn: () => getRecentActivity(dateFilter), staleTime: 0, refetchInterval: 30_000 });

  const unassignedCount = extrasQ.data?.unassigned_count ?? 0;
  const cards = snapshotQ.data?.cards ?? [];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{greeting()}, {user.name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{todayLong()}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href="/admin/allotment"><ListChecks className="h-4 w-4" />Assign Telecallers</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/admin/leads/add"><UserPlus className="h-4 w-4" />Add Lead</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/admin/config"><Settings2 className="h-4 w-4" />Configure Rounds</Link>
          </Button>
        </div>
      </div>

      {!extrasQ.isLoading && unassignedCount > 0 && (
        <div className="mb-6 flex items-center gap-3 rounded-md bg-[#FFF9F1] px-4 py-3 text-sm text-[#B3721E]">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{unassignedCount} lead{unassignedCount === 1 ? "" : "s"} have no telecaller assigned —</span>
          <Link href="/admin/allotment" className="font-medium underline">Go to Allotment</Link>
        </div>
      )}

      {snapshotQ.isLoading ? (
        <div className="mb-6 flex gap-3 overflow-x-auto pb-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 w-44 shrink-0 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : (
        <div className="mb-6 flex gap-3 overflow-x-auto pb-2">
          {cards.map((c) => (
            <Link key={c.key} href={c.href} className="shrink-0">
              <StatCard stat={c} />
            </Link>
          ))}
        </div>
      )}

      <DateRangeFilter onApply={setDateFilter} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[65fr_35fr]">
        <div>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Recent Activity</h2>
          <Card>
            <CardContent className="p-0">
              <ActivityFeed rows={activityQ.data?.rows ?? []} loading={activityQ.isLoading} />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Unassigned Leads</h2>
          <Card>
            <CardContent className="p-4">
              <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${unassignedCount > 0 ? "bg-[#FEEEE9] text-primary" : "bg-muted text-muted-foreground"}`}>
                {unassignedCount} lead{unassignedCount === 1 ? "" : "s"} unassigned
              </span>
              {extrasQ.isLoading ? (
                <div className="mt-4 text-sm text-muted-foreground">Loading…</div>
              ) : (extrasQ.data?.top_unassigned ?? []).length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">Nothing unassigned right now.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {(extrasQ.data?.top_unassigned ?? []).map((l) => (
                    <li key={l.id} className="flex items-center gap-3 text-sm">
                      <PriorityBadge priority={l.priority} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{l.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{l.source ?? "Direct"} · {l.lead_date ?? "—"}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/admin/allotment" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                Go to Allotment <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ===================== SHARED: TELECALLER / LMA (fixed snapshot cards) ===================== */

function RolePendingDoneDashboard({
  user,
  queryKey,
  queryFn,
  emptyState,
}: {
  user: ShellUser;
  queryKey: string;
  queryFn: (f: DateFilter) => Promise<RoleDashboardData>;
  /** Shown instead of the usual snapshot/pending/done view once data has loaded, if isEmpty(data) is true. */
  emptyState?: { isEmpty: (data: RoleDashboardData) => boolean; message: string };
}) {
  const [dateFilter, setDateFilter] = React.useState<DateFilter>(NO_FILTER);
  const q = useQuery({ queryKey: [queryKey, dateFilter], queryFn: () => queryFn(dateFilter), staleTime: 0, refetchInterval: 30_000 });
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({});
  const [doneOpen, setDoneOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const stats = q.data?.stats ?? [];
  const pendingGroups = q.data?.pendingGroups ?? [];
  const doneLeads = q.data?.doneLeads ?? [];
  const pendingTotal = q.data?.pendingTotal ?? 0;
  const numRounds = q.data?.numRounds ?? 2;
  const doneTakerColumns = React.useMemo(() => allTakerColumns(numRounds), [numRounds]);

  const term = search.trim().toLowerCase();
  const termDigits = term.replace(/\D/g, "");
  function matchesSearch(l: LeadRow) {
    if (!term) return true;
    if (l.name.toLowerCase().includes(term)) return true;
    if (termDigits) return l.contact.replace(/\D/g, "").includes(termDigits);
    return l.contact.toLowerCase().includes(term);
  }
  const filteredPendingGroups = pendingGroups
    .map((g) => ({ ...g, leads: g.leads.filter(matchesSearch) }))
    .filter((g) => g.leads.length > 0);
  const filteredDoneLeads = doneLeads.filter(matchesSearch);

  function isGroupOpen(key: string) {
    return openGroups[key] ?? true;
  }
  function toggleGroup(key: string) {
    setOpenGroups((s) => ({ ...s, [key]: !isGroupOpen(key) }));
  }

  if (!q.isLoading && q.data && emptyState?.isEmpty(q.data)) {
    return (
      <div>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{greeting()}, {user.name.split(" ")[0]}</h1>
          <span className="text-sm text-muted-foreground">{todayLong()}</span>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">{emptyState.message}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{greeting()}, {user.name.split(" ")[0]}</h1>
        <span className="text-sm text-muted-foreground">{todayLong()}</span>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        {q.isLoading ? "Loading…" : pendingTotal > 0 ? `${pendingTotal} lead${pendingTotal === 1 ? "" : "s"} need your attention` : "All caught up! Nothing assigned right now."}
      </p>

      <div className="mb-4 max-w-sm">
        <Label className="text-xs">Search</Label>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or contact number…"
        />
      </div>

      <DateRangeFilter onApply={setDateFilter} />

      {q.isLoading ? (
        <div className="mb-8 flex gap-3 overflow-x-auto pb-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 w-44 shrink-0 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : (
        <div className="mb-8 flex gap-3 overflow-x-auto pb-2">
          {stats.map((s) => <StatCard key={s.key} stat={s} />)}
        </div>
      )}

      {!q.isLoading && (
        <>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Pending</h2>
          {filteredPendingGroups.length === 0 ? (
            <p className="mb-8 text-sm text-muted-foreground">Nothing pending in this range.</p>
          ) : (
            <div className="mb-8 space-y-3">
              {filteredPendingGroups.map((g) => (
                <Card key={g.key}>
                  <button type="button" onClick={() => toggleGroup(g.key)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isGroupOpen(g.key) && "rotate-180")} />
                    <span className="text-sm font-semibold text-foreground">{g.label}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{g.leads.length}</span>
                  </button>
                  {isGroupOpen(g.key) && (
                    <CardContent className="border-t border-border p-0">
                      <LeadRowsTable
                        leads={g.leads}
                        takerColumns={[
                          ...takerColumnsFor(g.key, numRounds),
                          // Only on Round 1, and only once something in the group was rescheduled.
                          ...(g.key === "round_1" && g.leads.some((l) => l.reschedule) ? [RESCHEDULE_COLUMN] : []),
                        ]}
                      />
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
          )}

          <button type="button" onClick={() => setDoneOpen((v) => !v)} className="flex items-center gap-2 text-sm font-semibold text-foreground">
            Done ({filteredDoneLeads.length})
            <ChevronDown className={cn("h-4 w-4 transition-transform", doneOpen && "rotate-180")} />
          </button>
          {doneOpen && (
            <Card className="mt-3">
              <CardContent className="p-0">
                {filteredDoneLeads.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">Nothing completed in this range.</p>
                ) : (
                  <LeadRowsTable leads={filteredDoneLeads} takerColumns={doneTakerColumns} />
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/** Every non-admin role — renders only the stages the logged-in user is a member of in stage_pools. */
function PoolDashboard({ user }: { user: ShellUser }) {
  return (
    <RolePendingDoneDashboard
      user={user}
      queryKey="dashboard-pool"
      queryFn={getPoolDashboard}
      emptyState={{
        isEmpty: (data) => (data.myStages?.length ?? 0) === 0,
        message: "You haven't been added to any stage pools yet. Contact your admin to get assigned.",
      }}
    />
  );
}
