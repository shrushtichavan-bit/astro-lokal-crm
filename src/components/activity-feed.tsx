"use client";

import Link from "next/link";

export type ActivityItem = {
  id: string;
  action: string;
  description: string;
  performed_by: string;
  performed_at: string;
  lead: { id: string; name: string } | null;
};

export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function activityDotColor(action: string): string {
  if (/^attempt_\d+:connected$/.test(action) || action === "stage_change:profile_created" || action === "stage_change:active") return "bg-success";
  if (
    /^attempt_\d+:(junk|not_interested)$/.test(action) ||
    action === "stage_change:junk" ||
    action === "stage_change:not_interested" ||
    action === "stage_change:failed" ||
    action === "stage_change:terminated"
  )
    return "bg-destructive";
  if (/^attempt_\d+:(rnr|reconnect)$/.test(action)) return "bg-primary";
  if (/^stage_change:round_\d+_pending$/.test(action) || action === "stage_change:profile_creation_pending") return "bg-blue-500";
  return "bg-muted-foreground";
}

/** Audit-log activity list — used by the dashboard's Recent Activity and the People page drill-down. */
export function ActivityFeed({
  rows,
  loading,
  emptyText = "Nothing in this range.",
}: {
  rows: ActivityItem[];
  loading?: boolean;
  emptyText?: string;
}) {
  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  if (rows.length === 0) return <div className="p-6 text-sm text-muted-foreground">{emptyText}</div>;
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => {
        const initials = r.performed_by.slice(0, 2).toUpperCase();
        return (
          <li key={r.id} className="flex items-start gap-3 px-4 py-3 text-sm">
            <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
              {initials}
              <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card ${activityDotColor(r.action)}`} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate">
                <span className="font-medium text-foreground">{r.performed_by}</span>{" "}
                <span className="text-muted-foreground">
                  {r.action.startsWith("Duplicate blocked") ? `🚫 ${r.description}` : r.description}
                </span>
                {r.lead && !r.action.startsWith("Duplicate blocked") && (
                  <>
                    {" — "}
                    <Link href={`/leads/${r.lead.id}`} className="font-medium text-primary hover:underline">{r.lead.name}</Link>
                  </>
                )}
              </p>
              <p className="text-xs text-muted-foreground">{timeAgo(r.performed_at)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
