import Link from "next/link";
import { BrainCircuit, Siren } from "lucide-react";
import { formatDateTime, formatRelative } from "@/features/drive-vision/utils/format";
import { cn } from "@/lib/utils";
import { EmptyState } from "../shared/feedback";
import { StatusBadge } from "../shared/status-badge";
import type { LiveAlarm } from "./live-dashboard-model";

/**
 * Latest alarms from GET /alarms/ai and /alarms/routine, newest first. With `hrefFor`, a row whose record has a link
 * (activity-links.ts) is one link to that exact alert: whole row clickable, Enter opens it, visible focus ring.
 */
export function LiveActivityList({ alarms, now, limit = 6, hrefFor }: { alarms: LiveAlarm[]; now: Date; limit?: number; hrefFor?: (a: LiveAlarm) => string | null }) {
  if (alarms.length === 0) return <EmptyState icon={Siren} title="No events in this period" description="No AI events or routine alarms were returned for the selected range." className="py-8" />;
  return (
    <ul className="px-3 pt-2 pb-3">
      {alarms.slice(0, limit).map((a) => {
        const href = hrefFor?.(a) ?? null;
        const content = (
          <>
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-control", a.kind === "ai" ? "bg-lavender text-ai-ink" : "bg-peach text-serious")} aria-hidden>
              {a.kind === "ai" ? <BrainCircuit className="size-4" /> : <Siren className="size-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink">{a.alarmName ?? `Alarm type ${a.alarmTypeId ?? "?"}`}</span>
              <span className="block truncate text-xs text-ink-muted">
                {[a.deviceName ?? a.terminalNo, typeof a.speedKmh === "number" ? `${a.speedKmh} km/h` : null, a.kind === "ai" ? "AI event" : "Routine alarm"].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              {a.handlingStatus ? (
                <StatusBadge size="sm" tone={a.handlingStatus === "NEW" ? "serious" : "neutral"}>
                  {a.handlingStatus}
                </StatusBadge>
              ) : null}
              {a.alarmTime ? (
                <time dateTime={a.alarmTime} title={formatDateTime(a.alarmTime)} className="text-[11px] text-ink-subtle">
                  {formatRelative(a.alarmTime, now)}
                </time>
              ) : null}
            </span>
          </>
        );
        return (
          <li key={`${a.kind}-${a.id}`}>
            {href ? (
              <Link
                href={href}
                className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 transition-colors duration-150 hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:ring-[3px] focus-visible:ring-brand/30 focus-visible:outline-none"
                data-testid="activity-link"
                title={`Open this ${a.kind === "ai" ? "AI event" : "routine alarm"} in Alerts & Events`}
              >
                {content}
              </Link>
            ) : (
              <div className="flex items-center gap-3 rounded-xl px-2 py-2.5">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
