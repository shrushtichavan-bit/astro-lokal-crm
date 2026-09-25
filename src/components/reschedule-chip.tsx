import { fmtSlot } from "@/lib/format";
import { cn } from "@/lib/utils";

/** "Rescheduled N" chip with the latest slot underneath — Round 1 actions panel and the dashboard. */
export function RescheduleChip({ count, latestTo, className }: { count: number; latestTo: string | null; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <span className="inline-flex items-center whitespace-nowrap rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
        Rescheduled {count}
      </span>
      {latestTo && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">for {fmtSlot(latestTo)}</div>}
    </div>
  );
}
