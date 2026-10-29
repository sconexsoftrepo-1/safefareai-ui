"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Route, SquareTerminal, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Alarm, CommandRecord, Trip, Vehicle, Driver } from "@/features/drive-vision/types";
import { ALARM_TYPES, DEMO_NOW } from "@/features/drive-vision/mock-data/catalog";
import { formatDateTime, formatDuration, formatKm, formatRelative } from "@/features/drive-vision/utils/format";
import { cn } from "@/lib/utils";
import { DetailRow, SlideOverPanel } from "../shared/slide-over-panel";
import { AlarmStatusBadge, SeverityBadge, StatusBadge } from "../shared/status-badge";

type Activity =
  | { kind: "alarm"; id: string; time: string; alarm: Alarm }
  | { kind: "trip"; id: string; time: string; trip: Trip }
  | { kind: "command"; id: string; time: string; command: CommandRecord };

/** Merged recent activity: events, completed trips and (simulated) commands. Items open a detail drawer. */
export function ActivityFeed({ alarms, trips, commands, vehicles, drivers }: { alarms: Alarm[]; trips: Trip[]; commands: CommandRecord[]; vehicles: Vehicle[]; drivers: Driver[] }) {
  const [open, setOpen] = useState<Activity | null>(null);
  const vehicleById = useMemo(() => new Map(vehicles.map((v) => [v.vehicleId, v])), [vehicles]);
  const now = DEMO_NOW.toISOString();

  const items = useMemo<Activity[]>(() => {
    const list: Activity[] = [
      ...alarms.slice(0, 12).map((a) => ({ kind: "alarm" as const, id: a.alarmId, time: a.alarmTime, alarm: a })),
      ...[...trips]
        .filter((t) => t.endTime <= now)
        .sort((a, b) => b.endTime.localeCompare(a.endTime))
        .slice(0, 6)
        .map((t) => ({ kind: "trip" as const, id: t.tripId, time: t.endTime, trip: t })),
      ...commands.slice(0, 4).map((c) => ({ kind: "command" as const, id: c.commandNo, time: c.issuedAt, command: c })),
    ];
    return list.sort((a, b) => b.time.localeCompare(a.time)).slice(0, 7);
  }, [alarms, trips, commands, now]);

  const vName = (id: string) => {
    const v = vehicleById.get(id);
    return v ? `${v.vehicleName} · ${v.plate}` : "Removed vehicle";
  };

  return (
    <>
      <ul className="px-3 pt-2 pb-3">
        {items.map((item) => {
          const icon =
            item.kind === "alarm" ? (
              <TriangleAlert className="size-4" />
            ) : item.kind === "trip" ? (
              <Route className="size-4" />
            ) : (
              <SquareTerminal className="size-4" />
            );
          const tone = item.kind === "alarm" ? (item.alarm.severity === "critical" || item.alarm.severity === "high" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning") : item.kind === "trip" ? "bg-mint text-success" : "bg-lavender text-ai-ink";
          const title = item.kind === "alarm" ? ALARM_TYPES[item.alarm.alarmType].label : item.kind === "trip" ? `Trip completed · ${formatKm(item.trip.distanceKm)}` : `${item.command.commandLabel} (simulated)`;
          const sub = item.kind === "alarm" ? vName(item.alarm.vehicleId) : item.kind === "trip" ? vName(item.trip.vehicleId) : `${item.command.plate} · ${item.command.result}`;
          return (
            <li key={`${item.kind}-${item.id}`}>
              <button type="button" onClick={() => setOpen(item)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none">
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", tone)} aria-hidden>
                  {icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{title}</span>
                  <span className="block truncate text-xs text-ink-muted">{sub}</span>
                </span>
                <span className="shrink-0 text-[11px] text-ink-subtle">{formatRelative(item.time, DEMO_NOW)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <SlideOverPanel
        open={open !== null}
        onOpenChange={(o) => !o && setOpen(null)}
        title={open?.kind === "alarm" ? ALARM_TYPES[open.alarm.alarmType].label : open?.kind === "trip" ? "Trip summary" : open?.kind === "command" ? open.command.commandLabel : ""}
        description={open ? formatDateTime(open.time) : undefined}
        headerExtra={
          open?.kind === "alarm" ? (
            <>
              <SeverityBadge severity={open.alarm.severity} size="sm" />
              <AlarmStatusBadge status={open.alarm.status} size="sm" />
            </>
          ) : open?.kind === "command" ? (
            <StatusBadge tone="lavender" size="sm">
              Simulated command
            </StatusBadge>
          ) : null
        }
        footer={
          open ? (
            <Button asChild>
              <Link href={open.kind === "alarm" ? `/drive-vision/alerts?alarm=${open.alarm.alarmId}` : open.kind === "trip" ? `/drive-vision/trips?trip=${open.trip.tripId}` : "/drive-vision/devices/commands"}>
                {open.kind === "alarm" ? "Open in Alerts" : open.kind === "trip" ? "Play back trip" : "Open Device Commands"} <ArrowRight />
              </Link>
            </Button>
          ) : null
        }
      >
        {open?.kind === "alarm" ? (
          <dl className="divide-y divide-line">
            <DetailRow label="Vehicle">{vName(open.alarm.vehicleId)}</DetailRow>
            <DetailRow label="Driver">{drivers.find((d) => d.driverId === open.alarm.driverId)?.name ?? "—"}</DetailRow>
            <DetailRow label="Category">{open.alarm.category}</DetailRow>
            <DetailRow label="Speed">{open.alarm.speed} km/h</DetailRow>
            <DetailRow label="Location">{open.alarm.address}</DetailRow>
            <DetailRow label="Event ID">{open.alarm.alarmId}</DetailRow>
          </dl>
        ) : null}
        {open?.kind === "trip" ? (
          <dl className="divide-y divide-line">
            <DetailRow label="Vehicle">{vName(open.trip.vehicleId)}</DetailRow>
            <DetailRow label="From">{open.trip.startAddress}</DetailRow>
            <DetailRow label="To">{open.trip.endAddress}</DetailRow>
            <DetailRow label="Distance">{formatKm(open.trip.distanceKm)}</DetailRow>
            <DetailRow label="Duration">{formatDuration(open.trip.durationMin)}</DetailRow>
            <DetailRow label="Stops">{open.trip.stopCount}</DetailRow>
            <DetailRow label="Events during trip">{open.trip.alarmCount}</DetailRow>
          </dl>
        ) : null}
        {open?.kind === "command" ? (
          <dl className="divide-y divide-line">
            <DetailRow label="Vehicle">{open.command.plate}</DetailRow>
            <DetailRow label="Device ID">{open.command.terminalNo}</DetailRow>
            <DetailRow label="Issued by">{open.command.issuedBy}</DetailRow>
            <DetailRow label="Result">{open.command.result}</DetailRow>
            <DetailRow label="Response">{open.command.resultResponse ?? open.command.failResult ?? "—"}</DetailRow>
            <DetailRow label="Command no.">{open.command.commandNo}</DetailRow>
          </dl>
        ) : null}
      </SlideOverPanel>
    </>
  );
}
