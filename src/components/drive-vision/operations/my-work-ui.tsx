"use client";

import type { LucideIcon } from "lucide-react";
import { CalendarDays, IdCard, MapPin, Truck } from "lucide-react";
import type { AlertRow, DispatchDto, DriverDto, KeyedCount, LeaveDto, ShiftDto } from "@/features/drive-vision/api/types";
import { formatDate, formatDateTime, formatNumber, formatSeconds, formatTime, initials } from "@/features/drive-vision/utils/format";
import { cn } from "@/lib/utils";
import { StatusBadge } from "../shared/status-badge";
import { humanize as label, statusTone } from "./my-work-model";

export { elapsedSince } from "./my-work-model";

/**
 * Presentational pieces for the driver screens (My Work). Everything shown comes from the
 * /driver/* responses; a missing value renders "—", never a guess. No data fetching here.
 */

/** Comfortable touch target on phones without inflating desktop buttons. */
export const TOUCH = "max-sm:h-11 max-sm:px-4";

const dash = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : String(v));
export const when = (v?: string) => (v ? formatDateTime(v) : "—");

export function ServerStatus({ value, size = "sm" }: { value?: string; size?: "sm" | "md" }) {
  if (!value) return null;
  return (
    <StatusBadge size={size} tone={statusTone(value)}>
      {label(value)}
    </StatusBadge>
  );
}

/** Compact identity strip shown on every driver screen: name, licence and status from GET /driver/me. */
export function DriverIdentity({ me }: { me: DriverDto }) {
  const lic = me.licence;
  const days = lic?.daysToExpiry;
  return (
    <div className="mb-4 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-line/60 bg-surface px-4 py-3 shadow-card">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand-deep" aria-hidden>
        {initials(me.name ?? "?")}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-ink" title={me.name}>
          {me.name ?? "Driver"}
        </p>
        <p className="truncate text-xs text-ink-muted">{[me.email, me.phone].filter(Boolean).join(" · ") || "No contact details on file"}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <ServerStatus value={me.status} />
        {lic ? (
          <StatusBadge size="sm" tone={statusTone(lic.status)} icon={IdCard}>
            {lic.status ? label(lic.status) : "Licence"}
            {lic.expiresOn ? ` · ${formatDate(lic.expiresOn)}` : ""}
            {typeof days === "number" && days >= 0 && lic.status !== "VALID" ? ` (${days} d)` : ""}
          </StatusBadge>
        ) : null}
      </div>
    </div>
  );
}

export function StatTile({ icon: Icon, label: name, value, hint, tone = "neutral" }: { icon: LucideIcon; label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "neutral" | "brand" | "success" | "warning" }) {
  const chip = { neutral: "bg-surface-sunken text-ink-muted", brand: "bg-brand-soft text-brand-deep", success: "bg-success-soft text-success", warning: "bg-warning-soft text-warning" }[tone];
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-card border border-line/60 bg-surface p-4 shadow-card">
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", chip)} aria-hidden>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-ink-muted">{name}</p>
        <div className="mt-0.5 truncate text-[15px] leading-6 font-semibold text-ink">{value}</div>
        {hint ? <p className="truncate text-[11.5px] text-ink-subtle">{hint}</p> : null}
      </div>
    </div>
  );
}

/** One trip (dispatch) — used for the featured current/next trip and for list rows. */
export function TripSummary({ trip, featured = false }: { trip: DispatchDto; featured?: boolean }) {
  const route = [trip.origin, trip.destination].filter(Boolean);
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <p className={cn("min-w-0 truncate font-semibold text-ink", featured ? "text-[17px]" : "text-[13.5px]")} title={trip.title}>
          {trip.title ?? `Trip ${trip.id}`}
        </p>
        <ServerStatus value={trip.status} />
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-muted">
        <span className="inline-flex items-center gap-1 tabular">
          <CalendarDays className="size-3.5" aria-hidden />
          {trip.scheduledStart ? formatDateTime(trip.scheduledStart) : "Not scheduled"}
          {trip.scheduledEnd ? ` – ${formatTime(trip.scheduledEnd)}` : ""}
        </span>
        {route.length ? (
          <span className="inline-flex min-w-0 items-center gap-1">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{route.length === 2 ? `${route[0]} → ${route[1]}` : route[0]}</span>
          </span>
        ) : null}
        {trip.deviceName ? (
          <span className="inline-flex items-center gap-1">
            <Truck className="size-3.5" aria-hidden /> {trip.deviceName}
          </span>
        ) : null}
      </p>
      {featured && trip.instructions ? <p className="mt-2 rounded-inner bg-surface-muted px-3 py-2 text-[12.5px] text-ink">{trip.instructions}</p> : null}
      {featured && trip.reportingTime ? <p className="mt-1.5 text-xs text-ink-muted">Report by {formatDateTime(trip.reportingTime)}</p> : null}
    </div>
  );
}

export function ShiftRow({ shift }: { shift: ShiftDto }) {
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 py-2.5 text-[13px] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]">
      <span className="min-w-0 tabular">
        <span className="font-medium text-ink">{shift.startedAt ? formatDate(shift.startedAt) : "—"}</span>
        <span className="text-ink-muted">
          {" "}
          · {shift.startedAt ? formatTime(shift.startedAt) : "?"} – {shift.endedAt ? formatTime(shift.endedAt) : shift.open ? "now" : "?"}
        </span>
      </span>
      <span className="order-3 col-span-2 truncate text-xs text-ink-muted sm:order-none sm:col-span-1">{shift.deviceName ?? "No vehicle"}</span>
      <span className="text-right font-medium text-ink tabular">{typeof shift.durationSeconds === "number" ? formatSeconds(shift.durationSeconds) : shift.open ? "Open" : "—"}</span>
    </li>
  );
}

export function LeaveRow({ leave, action }: { leave: LeaveDto; action?: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex w-full min-w-0 items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-inner bg-surface-muted text-ink-muted" aria-hidden>
          <CalendarDays className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold text-ink">
            {leave.leaveType ? label(leave.leaveType) : "Leave"}
            <ServerStatus value={leave.status} />
          </p>
          <p className="text-[12.5px] text-ink-muted tabular">
            {leave.startDate ? formatDate(leave.startDate) : "?"} – {leave.endDate ? formatDate(leave.endDate) : "?"}
            {typeof leave.days === "number" ? ` · ${leave.days} day${leave.days === 1 ? "" : "s"}` : ""}
          </p>
          {leave.reason ? <p className="mt-1 text-[12.5px] break-words text-ink">{leave.reason}</p> : null}
          {leave.decidedAt || leave.decisionNote ? (
            <p className="mt-1 text-xs text-ink-muted">
              {leave.decidedAt ? `Decided ${formatDateTime(leave.decidedAt)}${leave.decidedByName ? ` by ${leave.decidedByName}` : ""}` : null}
              {leave.decisionNote ? `${leave.decidedAt ? " · " : ""}“${leave.decisionNote}”` : null}
            </p>
          ) : leave.createdAt ? (
            <p className="mt-1 text-xs text-ink-subtle">Requested {formatDateTime(leave.createdAt)}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 sm:pt-0.5">{action}</div> : null}
    </li>
  );
}

/** Server breakdown (e.g. DriverScoreDto.byType) as labelled bars. Rows without a count are skipped. */
export function CountBars({ rows }: { rows: KeyedCount[] | undefined }) {
  const list = (rows ?? []).filter((r) => typeof r.count === "number");
  const max = Math.max(1, ...list.map((r) => r.count!));
  if (list.length === 0) return null;
  return (
    <ul className="space-y-2.5" aria-label="Events by type">
      {list.map((r, i) => (
        <li key={r.key ?? i} className="text-[13px]">
          <div className="mb-1 flex justify-between gap-2">
            <span className="truncate text-ink">{r.label || r.key || "—"}</span>
            <span className="font-semibold tabular">{formatNumber(r.count!)}</span>
          </div>
          <span className="block h-1.5 rounded-full bg-surface-sunken">
            <span className="block h-full rounded-full bg-brand" style={{ width: `${(r.count! / max) * 100}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function EventRow({ event }: { event: AlertRow }) {
  return (
    <li className="flex items-start gap-3 py-2.5 text-[13px]">
      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-serious" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-ink">{event.alarmName ?? (event.alarmTypeId !== undefined ? `Alarm type ${event.alarmTypeId}` : "Event")}</p>
        <p className="truncate text-xs text-ink-muted">{[event.deviceName, typeof event.speedKmh === "number" ? `${event.speedKmh} km/h` : null, event.address].filter(Boolean).join(" · ") || "—"}</p>
      </div>
      <span className="shrink-0 text-xs text-ink-muted tabular">{when(event.alarmTime)}</span>
    </li>
  );
}

/** Label/value grid for profile sections; long values wrap instead of overflowing. */
export function FieldGrid({ fields }: { fields: { label: string; value: unknown }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.label} className="min-w-0">
          <dt className="text-[11.5px] font-medium tracking-wide text-ink-subtle uppercase">{f.label}</dt>
          <dd className={cn("mt-0.5 text-[13.5px] break-words", f.value === undefined || f.value === null || f.value === "" ? "text-ink-subtle" : "text-ink")}>{dash(f.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionTitle({ icon: Icon, children, id }: { icon: LucideIcon; children: React.ReactNode; id?: string }) {
  return (
    <h3 id={id} className="mb-2.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
      <Icon className="size-4 text-brand" aria-hidden /> {children}
    </h3>
  );
}

