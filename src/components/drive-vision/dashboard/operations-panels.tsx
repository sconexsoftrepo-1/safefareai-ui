"use client";

import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarClock, CalendarOff, IdCard, Repeat2, Route, UserRoundCheck } from "lucide-react";
import type { ActiveTrips, DashboardOperations } from "@/features/drive-vision/api/types";
import { formatKm, formatNumber, formatShortDate } from "@/features/drive-vision/utils/format";
import { cn } from "@/lib/utils";
import { EmptyState } from "../shared/feedback";
import { AXIS_PROPS, ChartLegend, ChartTooltip, GRID_PROPS, SERIES } from "../charts/chart-kit";
import { describeStatusCounts, sumColumn, type TrendRow } from "./dashboard-api-model";

const n = (v: number | undefined | null) => (typeof v === "number" ? formatNumber(v) : "—");

/** Trips and dispatch work today, and pending workforce items — straight from GET /dashboard/overview. */
export function OperationsSnapshot({ trips, operations }: { trips: ActiveTrips | undefined; operations: DashboardOperations | undefined }) {
  const byStatus = describeStatusCounts(trips?.dispatchesTodayByStatus);
  const tiles = [
    { label: "Licences expiring", value: operations?.licencesExpiring30Days, note: "next 30 days", icon: IdCard, href: "/drive-vision/drivers?licence=expiring" },
    { label: "Pending leave", value: operations?.pendingLeaveRequests, note: "awaiting decision", icon: CalendarOff, href: "/drive-vision/workforce?tab=leave" },
    { label: "Pending swaps", value: operations?.pendingSwapRequests, note: "awaiting decision", icon: Repeat2, href: "/drive-vision/dispatch?tab=swaps" },
    { label: "On leave today", value: operations?.driversOnLeaveToday, note: `${n(operations?.activeDrivers)} active driver${operations?.activeDrivers === 1 ? "" : "s"}`, icon: UserRoundCheck, href: "/drive-vision/workforce?tab=availability" },
  ];
  return (
    <div className="space-y-3 px-5 pt-3 pb-5">
      <dl className="grid grid-cols-3 divide-x divide-line/80 rounded-inner bg-surface-muted py-2 text-center">
        <div className="px-2">
          <dt className="text-[11.5px] font-medium text-ink-muted">Trips in progress</dt>
          <dd className="text-[20px] leading-7 font-semibold tabular">{n(trips?.tripsInProgress)}</dd>
        </div>
        <div className="px-2">
          <dt className="text-[11.5px] font-medium text-ink-muted">Trips today</dt>
          <dd className="text-[20px] leading-7 font-semibold tabular">{n(trips?.tripsToday)}</dd>
        </div>
        <div className="px-2">
          <dt className="text-[11.5px] font-medium text-ink-muted">Dispatches today</dt>
          <dd className="text-[20px] leading-7 font-semibold tabular">{n(trips?.dispatchesToday)}</dd>
        </div>
      </dl>
      <p className="flex items-center gap-1.5 text-xs text-ink-muted">
        <Route className="size-3.5 shrink-0" aria-hidden />
        <span>
          {n(trips?.dispatchesInProgress)} dispatch{trips?.dispatchesInProgress === 1 ? "" : "es"} in progress
          {byStatus ? <> · today: <span className="font-mono text-[11px]">{byStatus}</span></> : null}
        </span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        {tiles.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className={cn(
              "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
              t.value ? "border-line bg-surface hover:bg-surface-muted" : "border-transparent bg-surface-muted/60 hover:bg-surface-muted"
            )}
          >
            <t.icon className={cn("size-3.5 shrink-0", t.value ? "text-serious" : "text-ink-subtle")} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ink-muted">{t.label}</span>
              <span className="block truncate text-[11px] text-ink-subtle">{t.note}</span>
            </span>
            <span className={t.value ? "font-semibold text-ink tabular" : "text-ink-subtle tabular"}>{n(t.value)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Trips per day with distance and alarm counts — GET /dashboard/trends. Missing values stay "—". */
export function DailyTrendPanel({ rows }: { rows: TrendRow[] }) {
  if (rows.length === 0) return <EmptyState icon={CalendarClock} title="No days returned" description="The server returned no trend days for this period." className="py-8" />;
  const distance = sumColumn(rows, "distanceKm");
  const trips = sumColumn(rows, "trips");
  const chart = rows.map((r) => ({ label: formatShortDate(r.day), trips: r.trips ?? 0, alarms: r.alarms ?? 0 }));
  return (
    <div className="px-5 pt-2 pb-5">
      <ChartLegend
        className="mb-2"
        items={[
          { label: "Trips", color: SERIES.s1, value: trips === null ? "—" : formatNumber(trips) },
          { label: "Alarms", color: SERIES.s3, value: n(sumColumn(rows, "alarms")) },
          { label: "Distance", color: "transparent", value: distance === null ? "—" : formatKm(distance) },
        ]}
      />
      <div className="h-[180px]" role="img" aria-label={`Trips and alarms per day: ${rows.map((r) => `${r.day} ${r.trips ?? "no data"} trips, ${r.alarms ?? "no data"} alarms`).join("; ")}`}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 180 }}>
          <BarChart data={chart} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="label" {...AXIS_PROPS} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} {...AXIS_PROPS} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--dv-surface-muted)" }} />
            <Bar dataKey="trips" name="Trips" fill={SERIES.s1} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="alarms" name="Alarms" fill={SERIES.s3} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {rows.some((r) => r.trips === null || r.alarms === null) ? <p className="mt-1 text-[11px] text-ink-subtle">Bars for days without a value are drawn at zero; see the table for gaps.</p> : null}
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-ink-muted hover:text-ink">Show as table</summary>
        <table className="mt-2 w-full text-left tabular">
          <thead className="text-ink-subtle">
            <tr>
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">Trips</th>
              <th className="py-1 text-right font-medium">Distance</th>
              <th className="py-1 text-right font-medium">Alarms</th>
              <th className="py-1 text-right font-medium">Severe</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day} className="border-t border-line/60">
                <td className="py-1">{formatShortDate(r.day)}</td>
                <td className="py-1 text-right">{n(r.trips)}</td>
                <td className="py-1 text-right">{r.distanceKm === null ? "—" : formatKm(r.distanceKm)}</td>
                <td className="py-1 text-right">{n(r.alarms)}</td>
                <td className="py-1 text-right">{n(r.severeAlarms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
