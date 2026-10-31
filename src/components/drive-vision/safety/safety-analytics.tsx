"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, CheckCircle2, Clock, RefreshCw, ShieldAlert, Siren } from "lucide-react";
import { Button } from "@/components/ui/button";
import { insightService } from "@/features/drive-vision/api/insight-service";
import type { KeyedCount, RankedEntity, ScoreDto } from "@/features/drive-vision/api/types";
import { useApiQuery } from "@/features/drive-vision/hooks/use-api-query";
import type { DateRangeKey } from "@/features/drive-vision/types";
import { DATE_RANGE_OPTIONS, resolveDateRange } from "@/features/drive-vision/utils/time";
import { formatKm, formatNumber, formatShortDate } from "@/features/drive-vision/utils/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "../shared/page-header";
import { Panel, PanelHeader } from "../shared/panel";
import { SegmentedControl } from "../shared/filter-bar";
import { EmptyState, LoadingSkeleton } from "../shared/feedback";
import { ApiErrorState, DataSourceBadge } from "../shared/api-states";
import { MetricCard } from "../shared/metric-card";
import { DataTable, type DataTableColumn } from "../shared/data-table";
import { StatusBadge } from "../shared/status-badge";
import { AXIS_PROPS, ChartTooltip, GRID_PROPS, SERIES } from "../charts/chart-kit";

const SCORE_PAGE = 20;
const n = (v: number | undefined | null) => (typeof v === "number" && Number.isFinite(v) ? formatNumber(v) : "—");

/** Horizontal share bars for a server breakdown (by type / severity). Labels come from the server. */
function CountList({ rows, empty }: { rows: KeyedCount[] | undefined; empty: string }) {
  const list = (rows ?? []).filter((r) => typeof r.count === "number");
  const max = Math.max(1, ...list.map((r) => r.count!));
  if (list.length === 0) return <p className="px-5 pb-5 text-[13px] text-ink-muted">{empty}</p>;
  return (
    <ul className="space-y-2 px-5 pb-5">
      {list.map((r, i) => (
        <li key={r.key ?? i} className="text-[13px]">
          <div className="mb-1 flex justify-between gap-2">
            <span className="truncate">{r.label || r.key || "—"}</span>
            <span className="font-semibold tabular">{n(r.count)}</span>
          </div>
          <span className="block h-1.5 rounded-full bg-surface-sunken">
            <span className="block h-full rounded-full bg-brand" style={{ width: `${(r.count! / max) * 100}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function RankedList({ rows, hrefFor, empty }: { rows: RankedEntity[] | undefined; hrefFor: (id: number) => string; empty: string }) {
  const list = rows ?? [];
  if (list.length === 0) return <p className="px-5 pb-5 text-[13px] text-ink-muted">{empty}</p>;
  return (
    <ol className="divide-y divide-line px-5 pb-3">
      {list.map((r, i) => (
        <li key={r.id ?? i} className="flex items-center gap-3 py-2 text-[13px]">
          <span className="w-5 text-ink-subtle tabular">{i + 1}</span>
          {r.id !== undefined ? (
            <Link href={hrefFor(r.id)} className="min-w-0 flex-1 truncate font-medium hover:underline">
              {r.name ?? `#${r.id}`}
            </Link>
          ) : (
            <span className="min-w-0 flex-1 truncate font-medium">{r.name ?? "—"}</span>
          )}
          <span className="text-xs text-ink-muted tabular">{n(r.count)} events</span>
          <span className="w-16 text-right text-xs tabular" title="Penalty points (server)">
            {n(r.penaltyPoints)} pts
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Safety Analytics on live BFF data (safety-controller): GET /safety/analytics for totals and
 * breakdowns, /safety/scores/drivers and /vehicles for server-computed scores. No score or grade
 * is calculated in the browser — missing values show "—".
 */
export function SafetyAnalytics() {
  const [rangeKey, setRangeKey] = useState<DateRangeKey>("30d");
  const [scoreView, setScoreView] = useState<"drivers" | "vehicles">("drivers");
  const [scorePage, setScorePage] = useState(1);
  const [now, setNow] = useState(() => new Date());
  const range = useMemo(() => resolveDateRange(rangeKey, now), [rangeKey, now]);
  const win = { from: range.from.toISOString(), to: range.to.toISOString() };

  const analyticsQ = useApiQuery(`safety:analytics:${win.from}:${win.to}`, () => insightService.safetyAnalytics(win));
  const scoresQ = useApiQuery(`safety:scores:${scoreView}:${win.from}:${win.to}:${scorePage}`, () => insightService.scores(scoreView, { ...win, pageNumber: scorePage, pageSize: SCORE_PAGE }));
  const a = analyticsQ.data?.data;
  const totals = a?.totals;
  const byDay = (a?.byDay ?? []).filter((d) => d.day).map((d) => ({ label: formatShortDate(d.day!), count: d.count ?? 0, severe: d.severe ?? 0 }));
  const byHour = (a?.byHour ?? []).map((h) => ({ label: h.label || h.key || "", count: h.count ?? 0 }));
  const hrefFor = (kind: "drivers" | "vehicles") => (id: number) => (kind === "drivers" ? `/drive-vision/drivers?driver=${id}` : `/drive-vision/vehicles/${id}`);

  const scoreColumns: DataTableColumn<ScoreDto>[] = [
    {
      id: "name",
      header: scoreView === "drivers" ? "Driver" : "Vehicle",
      cell: (s) =>
        s.id !== undefined ? (
          <Link href={hrefFor(scoreView)(s.id)} className="font-medium hover:underline">
            {s.name ?? `#${s.id}`}
          </Link>
        ) : (
          (s.name ?? "—")
        ),
    },
    {
      id: "score",
      header: "Score",
      align: "right",
      cell: (s) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="font-semibold">{n(s.score)}</span>
          {s.grade ? <StatusBadge size="sm" tone="neutral">{s.grade}</StatusBadge> : null}
        </span>
      ),
    },
    { id: "alarms", header: "Alarms", align: "right", cell: (s) => n(s.alarmCount) },
    { id: "severe", header: "Severe", align: "right", cell: (s) => n(s.severeCount) },
    { id: "penalty", header: "Penalty pts", align: "right", hideBelow: "md", cell: (s) => n(s.penaltyPoints) },
    { id: "trips", header: "Trips", align: "right", hideBelow: "lg", cell: (s) => n(s.tripCount) },
    { id: "distance", header: "Distance", align: "right", hideBelow: "lg", cell: (s) => (typeof s.distanceKm === "number" ? formatKm(s.distanceKm) : "—") },
  ];

  return (
    <div>
      <PageHeader
        title="Safety Analytics"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <DataSourceBadge source={analyticsQ.data?.source} />
            <span>Scores and grades are computed by the SafeFare server · {range.label.toLowerCase()}</span>
          </span>
        }
        actions={
          <>
            <SegmentedControl label="Date range" value={rangeKey} onChange={(v) => (setRangeKey(v), setScorePage(1))} options={DATE_RANGE_OPTIONS} />
            <Button variant="outline" size="sm" onClick={() => (setNow(new Date()), analyticsQ.refetch(), scoresQ.refetch())} disabled={analyticsQ.loading}>
              <RefreshCw className={cn(analyticsQ.refreshing && "animate-spin")} /> Refresh
            </Button>
          </>
        }
      />

      {analyticsQ.error && !a ? (
        <Panel>
          <ApiErrorState error={analyticsQ.error} onRetry={analyticsQ.refetch} />
        </Panel>
      ) : !a ? (
        <LoadingSkeleton variant="chart" className="h-[360px]" />
      ) : (
        <>
          <section aria-label="Totals" className="mb-4 grid grid-cols-2 gap-3 @3xl:grid-cols-4">
            <MetricCard index={0} tone="featured" label="Events" value={n(totals?.total)} sublabel={`${n(totals?.ai)} AI · ${n(totals?.routine)} routine`} icon={Siren} />
            <MetricCard index={1} label="Severe" value={n(totals?.severe)} sublabel="Server severity threshold" icon={ShieldAlert} accent="peach" />
            <MetricCard index={2} label="Open" value={n(totals?.open)} sublabel={`${n(totals?.resolved)} resolved · ${n(totals?.dismissed)} dismissed`} icon={CheckCircle2} accent="brand" href="/drive-vision/alerts" />
            <MetricCard
              index={3}
              label="Avg. resolution"
              value={typeof totals?.avgResolutionMinutes === "number" ? `${formatNumber(Math.round(totals.avgResolutionMinutes))} min` : "—"}
              sublabel="Resolved alerts"
              icon={Clock}
              accent="sky"
            />
          </section>

          <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-12">
            <Panel className="@5xl:col-span-8" aria-labelledby="sa-day">
              <PanelHeader titleId="sa-day" title="Events per day" description="All events and the severe share" />
              {byDay.length === 0 ? (
                <EmptyState icon={Activity} title="No events in this period" description="The server returned no daily counts." className="py-8" />
              ) : (
                <div className="h-[240px] px-3 pb-4" role="img" aria-label={`Events per day: ${byDay.map((d) => `${d.label} ${d.count} (${d.severe} severe)`).join("; ")}`}>
                  <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 240 }}>
                    <BarChart data={byDay} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="label" {...AXIS_PROPS} interval="preserveStartEnd" />
                      <YAxis allowDecimals={false} {...AXIS_PROPS} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--dv-surface-muted)" }} />
                      <Bar dataKey="count" name="Events" fill={SERIES.s1} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                      <Bar dataKey="severe" name="Severe" fill={SERIES.s3} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Panel>
            <Panel className="@5xl:col-span-4" aria-labelledby="sa-type">
              <PanelHeader titleId="sa-type" title="By event type" />
              <CountList rows={a.byType} empty="No events by type." />
            </Panel>
            <Panel className="@5xl:col-span-4" aria-labelledby="sa-sev">
              <PanelHeader titleId="sa-sev" title="By severity" description="Severity labels as supplied by the server" />
              <CountList rows={a.bySeverity} empty="No severity breakdown." />
            </Panel>
            <Panel className="@5xl:col-span-8" aria-labelledby="sa-hour">
              <PanelHeader titleId="sa-hour" title="By hour of day" />
              {byHour.length === 0 ? (
                <p className="px-5 pb-5 text-[13px] text-ink-muted">No hourly breakdown.</p>
              ) : (
                <div className="h-[180px] px-3 pb-4" role="img" aria-label={`Events by hour: ${byHour.map((h) => `${h.label} ${h.count}`).join("; ")}`}>
                  <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 180 }}>
                    <BarChart data={byHour} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="label" {...AXIS_PROPS} interval="preserveStartEnd" />
                      <YAxis allowDecimals={false} {...AXIS_PROPS} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--dv-surface-muted)" }} />
                      <Bar dataKey="count" name="Events" fill={SERIES.s2} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Panel>
            <Panel className="@5xl:col-span-6" aria-labelledby="sa-topd">
              <PanelHeader titleId="sa-topd" title="Most events · drivers" />
              <RankedList rows={a.topDrivers} hrefFor={hrefFor("drivers")} empty="No driver rankings." />
            </Panel>
            <Panel className="@5xl:col-span-6" aria-labelledby="sa-topv">
              <PanelHeader titleId="sa-topv" title="Most events · vehicles" />
              <RankedList rows={a.topVehicles} hrefFor={hrefFor("vehicles")} empty="No vehicle rankings." />
            </Panel>
          </div>
        </>
      )}

      <Panel className="mt-4 overflow-hidden" aria-labelledby="sa-scores">
        <PanelHeader
          titleId="sa-scores"
          title="Safety scores"
          description="Server-computed score and grade per driver or vehicle"
          action={<SegmentedControl label="Scores for" value={scoreView} onChange={(v) => (setScoreView(v), setScorePage(1))} options={[{ value: "drivers", label: "Drivers" }, { value: "vehicles", label: "Vehicles" }]} />}
        />
        {scoresQ.error ? (
          <ApiErrorState error={scoresQ.error} onRetry={scoresQ.refetch} compact />
        ) : !scoresQ.data ? (
          <LoadingSkeleton variant="table" rows={6} />
        ) : (
          <DataTable
            caption={`Safety scores · ${scoreView}`}
            data={scoresQ.data.items}
            columns={scoreColumns}
            getRowId={(s) => String(s.id ?? s.name)}
            isLoading={scoresQ.refreshing}
            pageSize={SCORE_PAGE}
            serverPagination={{ page: scorePage, total: scoresQ.data.total, onPageChange: setScorePage }}
            emptyTitle="No scores"
            emptyDescription="The server returned no scores for this period."
          />
        )}
      </Panel>
    </div>
  );
}
