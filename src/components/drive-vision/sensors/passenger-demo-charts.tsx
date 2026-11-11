"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS_PROPS, ChartLegend, ChartTooltip, GRID_PROPS, SERIES } from "../charts/chart-kit";
import { ProgressMeter } from "../shared/panel";
import type { DemoPassengerJourney } from "./passenger-demo";

/**
 * Sensor vs BMS charts for the DEMO journey only (live mode never renders them). Every value comes from the one
 * derived journey (passenger-demo.ts) that also feeds the comparison table below, which is the charts' table view.
 * Existing chart kit: recessive axes, hairline grid, validated categorical slots in fixed order, shared tooltip.
 */
export function PassengerDemoCharts({ journey: j }: { journey: DemoPassengerJourney }) {
  const rows = j.stops.map((s) => ({
    stop: s.stop,
    bms: s.bmsActual,
    sensor: s.sensorReported,
    bmsIn: s.bmsIn,
    sensorIn: s.sensorIn,
    bmsOut: s.bmsOut,
    sensorOut: s.sensorOut,
    difference: s.difference,
  }));
  const c = j.comparison;
  return (
    <section aria-label="Demo journey charts" className="mb-3 grid gap-3 @4xl:grid-cols-2" data-testid="passenger-demo-charts">
      <ChartCard
        title="Passengers on board · BMS vs sensor"
        legend={[
          { label: "BMS", color: SERIES.s1 },
          { label: "Sensor", color: SERIES.s2 },
        ]}
      >
        <LineChart data={rows} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="stop" {...AXIS_PROPS} interval={0} tick={{ ...AXIS_PROPS.tick, fontSize: 11 }} />
          <YAxis {...AXIS_PROPS} allowDecimals={false} domain={[0, "auto"]} />
          <Tooltip cursor={{ stroke: "var(--dv-border)" }} content={<ChartTooltip hideTotal />} />
          <Line
            type="monotone"
            dataKey="bms"
            name="BMS"
            stroke={SERIES.s1}
            strokeWidth={2}
            dot={{ r: 4, strokeWidth: 2, stroke: "var(--dv-surface)" }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="sensor"
            name="Sensor"
            stroke={SERIES.s2}
            strokeWidth={2}
            dot={{ r: 4, strokeWidth: 2, stroke: "var(--dv-surface)" }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartCard>

      <ChartCard
        title="Boarded and alighted per stop"
        legend={[
          { label: "Boarded · BMS", color: SERIES.s1 },
          { label: "Boarded · sensor", color: SERIES.s2 },
          { label: "Alighted · BMS", color: SERIES.s3 },
          { label: "Alighted · sensor", color: SERIES.s4 },
        ]}
      >
        <BarChart data={rows} margin={{ top: 8, right: 12, left: -18, bottom: 0 }} barCategoryGap="22%" barGap={2}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="stop" {...AXIS_PROPS} interval={0} tick={{ ...AXIS_PROPS.tick, fontSize: 11 }} />
          <YAxis {...AXIS_PROPS} allowDecimals={false} />
          <Tooltip cursor={{ fill: "var(--dv-surface-sunken)", radius: 8 }} content={<ChartTooltip hideTotal />} />
          <Bar dataKey="bmsIn" name="Boarded · BMS" fill={SERIES.s1} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
          <Bar dataKey="sensorIn" name="Boarded · sensor" fill={SERIES.s2} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
          <Bar dataKey="bmsOut" name="Alighted · BMS" fill={SERIES.s3} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
          <Bar dataKey="sensorOut" name="Alighted · sensor" fill={SERIES.s4} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
        </BarChart>
      </ChartCard>

      <ChartCard title="Difference per stop (sensor − BMS)">
        <BarChart data={rows} margin={{ top: 8, right: 12, left: -18, bottom: 0 }} barCategoryGap="40%">
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="stop" {...AXIS_PROPS} interval={0} tick={{ ...AXIS_PROPS.tick, fontSize: 11 }} />
          <YAxis {...AXIS_PROPS} allowDecimals={false} domain={[(min: number) => Math.min(min, -1), (max: number) => Math.max(max, 1)]} />
          <ReferenceLine y={0} stroke="var(--dv-ink-subtle)" />
          <Tooltip cursor={{ fill: "var(--dv-surface-sunken)", radius: 8 }} content={<ChartTooltip hideTotal />} />
          <Bar dataKey="difference" name="Difference" fill={SERIES.s1} radius={4} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ChartCard>

      <div className="flex flex-col justify-center gap-3 rounded-card border border-line/70 bg-surface p-4 shadow-card" data-testid="demo-match-rate">
        <p className="text-[13px] font-semibold text-ink">Match rate</p>
        <p className="text-[28px] leading-none font-semibold text-ink tabular">{Math.round(c.matchRate * 10) / 10}%</p>
        <ProgressMeter value={c.matchRate} label={`Match rate ${c.matchRate}%`} tone="success" />
        <p className="text-xs text-ink-muted">
          {c.exactMatches} of {c.compared} stops exact · {c.mismatches} mismatched · mean abs. error {c.meanAbsoluteError.toFixed(2)} · max {c.maxAbsoluteError}
        </p>
      </div>
    </section>
  );
}

function ChartCard({ title, legend, children }: { title: string; legend?: { label: string; color: string }[]; children: React.ReactElement }) {
  return (
    <figure className="min-w-0 rounded-card border border-line/70 bg-surface p-4 shadow-card">
      <figcaption className="mb-2 text-[13px] font-semibold text-ink">{title}</figcaption>
      {legend ? <ChartLegend items={legend} className="mb-2" /> : null}
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height: 200 }}>
          {children}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
