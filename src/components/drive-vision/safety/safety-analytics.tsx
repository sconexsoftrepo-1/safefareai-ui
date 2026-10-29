"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, Info, Route, Siren } from "lucide-react";
import { useFleet } from "@/features/drive-vision/store/fleet-store";
import {
  alarmsInRange,
  categoryDistribution,
  driverScores,
  fleetScore,
  isSafetyEvent,
  scoreBand,
  SEVERITY_WEIGHTS,
  tripsInRange,
  typeRanking,
  vehicleScores,
  weeklySeverity,
  type ScoreRow,
} from "@/features/drive-vision/selectors";
import { ALARM_CATEGORIES, DEMO_NOW } from "@/features/drive-vision/mock-data/catalog";
import { resolveDateRange } from "@/features/drive-vision/utils/time";
import { formatKm } from "@/features/drive-vision/utils/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "../shared/page-header";
import { Panel, PanelHeader } from "../shared/panel";
import { SegmentedControl } from "../shared/filter-bar";
import { DemoBadge, LoadingSkeleton, SNAPSHOT_LABEL, useSimulatedLoading } from "../shared/feedback";
import { MetricCard } from "../shared/metric-card";
import { StatusBadge } from "../shared/status-badge";
import { AXIS_PROPS, ChartLegend, ChartTooltip, GRID_PROPS, SERIES, SEVERITY_COLORS } from "../charts/chart-kit";
import { EASE_OUT } from "../shared/motion";

/** Semicircle gauge (echoes the reference screenshot's progress arc). */
function ScoreGauge({ score }: { score: number }) {
  const band = scoreBand(score);
  const r = 80;
  const circumference = Math.PI * r;
  return (
    <div className="relative mx-auto w-[220px]">
      <svg viewBox="0 0 200 110" className="w-full" role="img" aria-label={`Fleet safety score ${score} out of 100, ${band.label}`}>
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="var(--dv-surface-muted)" strokeWidth="18" strokeLinecap="round" />
        <motion.path
          d="M20 100 A80 80 0 0 1 180 100"
          fill="none"
          stroke="var(--dv-brand-deep)"
          strokeWidth="18"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - score / 100) }}
          transition={{ duration: 0.7, ease: EASE_OUT }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <p className="text-4xl font-semibold tracking-tight tabular">{score}</p>
        <p className="text-xs text-ink-muted">of 100 · {band.label}</p>
      </div>
    </div>
  );
}

function ScoreTable({ rows, nameFor, hrefFor, caption }: { rows: ScoreRow[]; nameFor: (id: string) => string; hrefFor: (id: string) => string; caption: string }) {
  return (
    <div className="overflow-x-auto px-2 pb-3">
      <table className="w-full text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-left text-[11px] tracking-wide text-ink-muted uppercase">
            <th className="px-3 py-2 font-semibold">#</th>
            <th className="px-3 py-2 font-semibold">Name</th>
            <th className="px-3 py-2 font-semibold">Score</th>
            <th className="hidden px-3 py-2 text-right font-semibold sm:table-cell">Events</th>
            <th className="hidden px-3 py-2 text-right font-semibold md:table-cell">Distance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const band = scoreBand(r.score);
            return (
              <tr key={r.id} className="border-t border-line/70">
                <td className="px-3 py-2 text-ink-subtle tabular">{i + 1}</td>
                <td className="px-3 py-2">
                  <Link href={hrefFor(r.id)} className="font-medium hover:underline">
                    {nameFor(r.id)}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="w-7 font-semibold tabular">{r.score}</span>
                    <span className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-surface-muted sm:block" aria-hidden>
                      <span className={cn("block h-full rounded-full", { success: "bg-success", warning: "bg-warning", serious: "bg-serious", danger: "bg-danger" }[band.tone])} style={{ width: `${r.score}%` }} />
                    </span>
                    <StatusBadge tone={band.tone} size="sm">
                      {band.label}
                    </StatusBadge>
                  </div>
                </td>
                <td className="hidden px-3 py-2 text-right tabular sm:table-cell">
                  {r.events}
                  {r.critical > 0 ? <span className="ml-1 text-xs text-danger">({r.critical} crit.)</span> : null}
                </td>
                <td className="hidden px-3 py-2 text-right text-ink-muted tabular md:table-cell">{formatKm(r.distanceKm)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SafetyAnalytics() {
  const alarms = useFleet((s) => s.alarms);
  const trips = useFleet((s) => s.trips);
  const vehicles = useFleet((s) => s.vehicles);
  const drivers = useFleet((s) => s.drivers);
  const [rangeKey, setRangeKey] = useState<"7d" | "30d">("30d");
  const [scoreView, setScoreView] = useState<"drivers" | "vehicles">("drivers");
  const [order, setOrder] = useState<"risk" | "best">("risk");
  const loading = useSimulatedLoading("safety");
  const range = useMemo(() => resolveDateRange(rangeKey, DEMO_NOW), [rangeKey]);

  const events = useMemo(() => alarmsInRange(alarms, range).filter((a) => isSafetyEvent(a) && a.status !== "false_positive"), [alarms, range]);
  const vRows = useMemo(() => vehicleScores(alarms, trips, range), [alarms, trips, range]);
  const dRows = useMemo(() => driverScores(alarms, trips, range), [alarms, trips, range]);
  const score = fleetScore(vRows);
  const distance = tripsInRange(trips, range).reduce((s, t) => s + t.distanceKm, 0);
  const per100 = distance ? (events.length / distance) * 100 : 0;
  const weekly = useMemo(() => weeklySeverity(alarms, rangeKey === "7d" ? 2 : 4), [alarms, rangeKey]);
  const categories = categoryDistribution(events);
  const types = typeRanking(events).slice(0, 6);
  const maxType = types[0]?.count ?? 1;
  const catTotal = Object.values(categories).reduce((a, b) => a + b, 0) || 1;
  const fpCount = alarmsInRange(alarms, range).filter((a) => a.status === "false_positive").length;

  const rows = (scoreView === "drivers" ? dRows : vRows).filter((r) => r.distanceKm > 0).sort((a, b) => (order === "risk" ? a.score - b.score : b.score - a.score)).slice(0, 10);
  const nameFor = (id: string) => (scoreView === "drivers" ? drivers.find((d) => d.driverId === id)?.name : (() => {
    const v = vehicles.find((x) => x.vehicleId === id);
    return v ? `${v.vehicleName} · ${v.plate}` : undefined;
  })()) ?? "Removed";
  const hrefFor = (id: string) => (scoreView === "drivers" ? `/drive-vision/drivers?driver=${id}` : `/drive-vision/vehicles/${id}`);

  return (
    <div>
      <PageHeader
        eyebrow={<DemoBadge label="Illustrative scores · sample data" />}
        title="Safety Analytics"
        description={SNAPSHOT_LABEL}
        actions={
          <SegmentedControl
            label="Date range"
            value={rangeKey}
            onChange={setRangeKey}
            options={[
              { value: "7d", label: "Last 7 days" },
              { value: "30d", label: "Last 30 days" },
            ]}
          />
        }
      />

      <div className="grid gap-4 xl:grid-cols-12">
        <Panel className="flex flex-col xl:col-span-4">
          <PanelHeader title="Fleet safety score" description={range.label} />
          <div className="flex flex-1 flex-col justify-center px-5 pt-3 pb-5">
            {loading ? <LoadingSkeleton /> : <ScoreGauge score={score} />}
            <p className="mt-4 text-center text-xs text-ink-muted">
              {events.length} events over {formatKm(distance)} · {fpCount} false positives excluded
            </p>
          </div>
        </Panel>
        <div className="grid gap-4 sm:grid-cols-3 xl:col-span-8 xl:grid-cols-3">
          <MetricCard label="Safety events" value={events.length} sublabel={range.label} icon={Activity} accent="peach" href="/drive-vision/alerts?status=all" />
          <MetricCard label="Events / 100 km" value={per100.toFixed(1)} sublabel={`${formatKm(distance)} driven`} icon={Route} accent="sky" />
          <MetricCard label="Critical events" value={events.filter((e) => e.severity === "critical").length} sublabel="Collision, fatigue, SOS" icon={Siren} accent="lavender" href="/drive-vision/alerts?severity=critical&status=all" />
          <Panel className="sm:col-span-3" aria-labelledby="weekly-title">
            <PanelHeader titleId="weekly-title" title="Weekly severity trend" description="Events per week by severity (false positives excluded)" />
            <div className="px-5 pt-3">
              <ChartLegend items={(["critical", "high", "medium", "low"] as const).map((s) => ({ label: s[0].toUpperCase() + s.slice(1), color: SEVERITY_COLORS[s] }))} />
            </div>
            {loading ? (
              <LoadingSkeleton variant="chart" className="h-[220px]" />
            ) : (
              <motion.div key={rangeKey} className="h-[220px] px-2 pt-2 pb-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22, ease: EASE_OUT }}>
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 700, height: 210 }}>
                  <BarChart data={weekly} margin={{ top: 8, right: 12, left: -4, bottom: 0 }} barCategoryGap="38%">
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="label" {...AXIS_PROPS} tickFormatter={(l: string) => `Wk of ${l}`} />
                    <YAxis {...AXIS_PROPS} allowDecimals={false} width={44} />
                    <Tooltip cursor={{ fill: "var(--dv-surface-muted)", radius: 6 }} content={<ChartTooltip />} />
                    <Bar dataKey="low" name="Low" stackId="s" fill={SEVERITY_COLORS.low} stroke="var(--dv-surface)" strokeWidth={1} maxBarSize={44} isAnimationActive={false} />
                    <Bar dataKey="medium" name="Medium" stackId="s" fill={SEVERITY_COLORS.medium} stroke="var(--dv-surface)" strokeWidth={1} maxBarSize={44} isAnimationActive={false} />
                    <Bar dataKey="high" name="High" stackId="s" fill={SEVERITY_COLORS.high} stroke="var(--dv-surface)" strokeWidth={1} maxBarSize={44} isAnimationActive={false} />
                    <Bar dataKey="critical" name="Critical" stackId="s" fill={SEVERITY_COLORS.critical} stroke="var(--dv-surface)" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </motion.div>
            )}
          </Panel>
        </div>

        <Panel className="xl:col-span-4" aria-labelledby="cat-title">
          <PanelHeader titleId="cat-title" title="Event categories" description="Vendor alarm families" />
          <ul className="space-y-3 px-5 pt-4 pb-5">
            {ALARM_CATEGORIES.map((c, i) => {
              const n = categories[c.value];
              const color = [SERIES.s1, SERIES.s2, SERIES.s3, SERIES.s4][i];
              return (
                <li key={c.value}>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="flex items-center gap-2">
                      <span className="size-2.5 rounded-sm" style={{ background: color }} aria-hidden />
                      {c.label}
                    </span>
                    <span className="font-semibold tabular">
                      {n} <span className="font-normal text-ink-muted">({Math.round((n / catTotal) * 100)}%)</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-muted">
                    <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${(n / catTotal) * 100}%` }} transition={{ duration: 0.45, ease: EASE_OUT }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel className="xl:col-span-4" aria-labelledby="types-title">
          <PanelHeader titleId="types-title" title="Most frequent events" description={range.label} />
          <ol className="space-y-2.5 px-5 pt-4 pb-5">
            {types.map((t) => (
              <li key={t.type}>
                <div className="flex justify-between text-[13px]">
                  <span className="truncate">{t.label}</span>
                  <span className="font-semibold tabular">{t.count}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                  <motion.div className="h-full rounded-full bg-brand" initial={{ width: 0 }} animate={{ width: `${(t.count / maxType) * 100}%` }} transition={{ duration: 0.45, ease: EASE_OUT }} />
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel tone="lavender" className="border-transparent xl:col-span-4">
          <PanelHeader title="How scores are calculated" description="Illustrative formula — not derived from real telemetry" />
          <div className="space-y-3 px-5 pt-3 pb-5 text-[13px] leading-relaxed text-ai-ink">
            <p className="flex gap-2">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> Weighted events = Σ severity weight (critical {SEVERITY_WEIGHTS.critical}, high {SEVERITY_WEIGHTS.high}, medium {SEVERITY_WEIGHTS.medium}, low {SEVERITY_WEIGHTS.low}). False positives and device-offline events are excluded.
            </p>
            <p className="rounded-xl bg-white/60 px-3 py-2 font-mono text-xs">
              rate = weighted ÷ max(km, 50) × 100
              <br />
              score = clamp(100 − 3 × rate, 0, 100)
            </p>
            <p className="text-xs">Bands: ≥85 Good · 70–84 Fair · 50–69 At risk · &lt;50 High risk. The production score (BFF) may also weigh night driving and overspeed duration.</p>
          </div>
        </Panel>

        <Panel className="xl:col-span-12" aria-labelledby="scores-title">
          <PanelHeader
            titleId="scores-title"
            title={order === "risk" ? "Highest-risk drivers & vehicles" : "Safest drivers & vehicles"}
            description={`Top 10 · ${range.label.toLowerCase()} · only those with recorded distance`}
            action={
              <div className="flex flex-wrap gap-2">
                <SegmentedControl
                  size="sm"
                  label="Score subject"
                  value={scoreView}
                  onChange={setScoreView}
                  options={[
                    { value: "drivers", label: "Drivers" },
                    { value: "vehicles", label: "Vehicles" },
                  ]}
                />
                <SegmentedControl
                  size="sm"
                  label="Order"
                  value={order}
                  onChange={setOrder}
                  options={[
                    { value: "risk", label: "Riskiest" },
                    { value: "best", label: "Safest" },
                  ]}
                />
              </div>
            }
          />
          {loading ? <LoadingSkeleton variant="table" rows={6} /> : <ScoreTable rows={rows} nameFor={nameFor} hrefFor={hrefFor} caption="Safety scores" />}
        </Panel>
      </div>
    </div>
  );
}
