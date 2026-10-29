import Link from "next/link";
import { CalendarClock, IdCard, ShieldCheck, Wrench, type LucideIcon } from "lucide-react";
import type { Reminder, ReminderKind } from "@/features/drive-vision/selectors";
import { formatDate } from "@/features/drive-vision/utils/format";
import { cn } from "@/lib/utils";
import { EmptyState } from "../shared/feedback";
import { StatusBadge } from "../shared/status-badge";

const KIND_ICON: Record<ReminderKind, LucideIcon> = { service: CalendarClock, insurance: ShieldCheck, maintenance: Wrench, licence: IdCard };

/** Expiry, insurance, maintenance and licence reminders (BFF reminder feature). */
export function RemindersList({ reminders, limit = 6 }: { reminders: Reminder[]; limit?: number }) {
  if (reminders.length === 0) return <EmptyState icon={CalendarClock} title="Nothing due" description="No reminders in the selected window." className="py-8" />;
  return (
    <ul className="px-3 pt-2 pb-3">
      {reminders.slice(0, limit).map((r) => {
        const Icon = KIND_ICON[r.kind];
        const overdue = r.daysLeft < 0;
        return (
          <li key={r.id}>
            <Link href={r.href} className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none">
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", overdue ? "bg-danger-soft text-danger" : r.daysLeft <= 7 ? "bg-peach text-serious" : "bg-sky text-info")}>
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{r.label}</span>
                <span className="block truncate text-xs text-ink-muted">
                  {r.subject} · {formatDate(r.dueDate)}
                </span>
              </span>
              <StatusBadge size="sm" tone={overdue ? "danger" : r.daysLeft <= 7 ? "serious" : "info"}>
                {overdue ? `Overdue ${-r.daysLeft} d` : r.daysLeft === 0 ? "Today" : `${r.daysLeft} d`}
              </StatusBadge>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
