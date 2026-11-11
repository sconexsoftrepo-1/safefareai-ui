"use client";

import { Info, Wrench } from "lucide-react";
import type { Access } from "@/features/drive-vision/access/access-policy";
import type { MaintenanceFeed, MaintenanceNotification } from "@/features/drive-vision/api/maintenance";
import { cn } from "@/lib/utils";
import { EmptyState } from "../shared/feedback";
import { AlertDates, AlertKindBadge, ServerTime, SourceLabel, TONE_DOT } from "../vehicle-registry/vehicle-maintenance-panels";
import { maintenanceNotificationHref } from "./notifications-model";

/**
 * The Maintenance rows of the Notifications popover (its own tab, and a short section on the All tab). Rows show
 * the backend's message as sent, the source, the vehicle and the alert's own time. There is no read state (see
 * MAINTENANCE_HAS_READ_STATE), so rows have no unread dot and no Mark read button.
 */

export function MaintenanceRow({ n, access, onOpen, disabled }: { n: MaintenanceNotification; access: Access; onOpen: (href: string) => void; disabled?: boolean }) {
  const href = maintenanceNotificationHref(access, n);
  const body = (
    <>
      <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-ink">
        <span className="font-mono">{n.vehicleNumber}</span>
        <span className="text-ink-muted">·</span>
        {n.title}
      </span>
      <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
        <AlertKindBadge n={n} />
        <SourceLabel source={n.source} />
        {n.isReminder ? <span className="rounded-full bg-surface-muted px-1.5 py-px text-[10.5px] text-ink-muted">Reminder</span> : null}
      </span>
      {n.message ? <span className="mt-0.5 block text-xs text-ink-muted">{n.message}</span> : null}
      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-subtle">
        <ServerTime value={n.createdAt} />
        {n.severityLabel ? <span>{n.severityLabel}</span> : null}
        <AlertDates n={n} />
      </span>
    </>
  );
  return (
    <li className="flex items-start gap-2 px-4 py-3" data-maintenance-notification={n.id}>
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", TONE_DOT[n.tone])} aria-hidden />
      {href ? (
        <button type="button" onClick={() => onOpen(href)} disabled={disabled} className="min-w-0 flex-1 text-left">
          {body}
        </button>
      ) : (
        <div className="min-w-0 flex-1">{body}</div>
      )}
    </li>
  );
}

/** One line per source that failed or was capped, so a partial feed never reads as "no alerts". */
export function FeedNotes({ feed }: { feed: MaintenanceFeed }) {
  const notes: string[] = [];
  const { tyre, vehicle } = feed.sources;
  if (!tyre.ok) notes.push(`Tyre maintenance alerts couldn't be loaded${tyre.status ? ` (HTTP ${tyre.status})` : ""}.`);
  if (!vehicle.ok) notes.push(`Vehicle maintenance alerts couldn't be loaded${vehicle.status ? ` (HTTP ${vehicle.status})` : ""}.`);
  if (vehicle.ok && vehicle.failedVehicles > 0) notes.push(`Vehicle maintenance alerts couldn't be loaded for ${vehicle.failedVehicles} of ${vehicle.vehiclesChecked} vehicles.`);
  if (vehicle.ok && vehicle.truncated) notes.push(`Vehicle maintenance alerts cover the first ${vehicle.vehiclesChecked} vehicles with a schedule.`);
  if (!notes.length) return null;
  return (
    <p className="border-b border-line bg-warning-soft px-4 py-1.5 text-[11.5px] text-warning" role="status" data-testid="maintenance-feed-notes">
      {notes.join(" ")}
    </p>
  );
}

export function MaintenanceReadNote() {
  return (
    <p className="flex items-start gap-1.5 border-b border-line px-4 py-1.5 text-[11.5px] text-ink-muted" data-testid="maintenance-read-note">
      <Info className="mt-px size-3.5 shrink-0" aria-hidden />
      Maintenance alerts have no read state, so they aren&apos;t counted as unread and can&apos;t be marked read.
    </p>
  );
}

export function MaintenanceList({ items, access, onOpen, disabled }: { items: MaintenanceNotification[]; access: Access; onOpen: (href: string) => void; disabled?: boolean }) {
  if (items.length === 0) return <EmptyState icon={Wrench} title="No maintenance alerts" description="No vehicle or tyre maintenance alerts right now." className="py-8" />;
  return (
    <ul className="divide-y divide-line" data-testid="maintenance-notifications">
      {items.map((n) => (
        <MaintenanceRow key={n.id} n={n} access={access} onOpen={onOpen} disabled={disabled} />
      ))}
    </ul>
  );
}
