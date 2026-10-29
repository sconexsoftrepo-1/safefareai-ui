"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Table2 } from "lucide-react";
import type { TrendBucket } from "@/features/drive-vision/selectors";
import { AXIS_PROPS, ChartLegend, ChartTooltip, GRID_PROPS, SERIES } from "../charts/chart-kit";
import { EASE_OUT, transitions } from "../shared/motion";

export type TrendView = "chart" | "table";

/** Header action that switches between chart and accessible table view. */
export function TrendViewToggle({ view, onChange }: { view: TrendView; onChange: (v: TrendView) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(view === "chart" ? "table" : "chart")}
      className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-ink-muted transition-colors duration-150 hover:bg-surface-sunken hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
      aria-pressed={view === "table"}
    >
      {view === "chart" ? <Table2 className="size-3.5" aria-hidden /> : <BarChart3 className="size-3.5" aria-hidden />}
      {view === "chart" ? "Table" : "Chart"}
    </button>
  );
}

/**
 * Stacked counts of AI events vs routine alarms. Recharts' own animation is off
 * (it did not complete reliably). The first render gets a short bottom-up reveal;
 * later range changes only crossfade, so switching periods feels quick rather than
 * replaying the entrance. Both are reduced to a fade under reduced motion.
 */
export function AlarmTrendChart({
  data,
  rangeKey,
  view,
  unavailable,
}: {
  data: TrendBucket[];
  rangeKey: string;
  view: TrendView;
  /** Series whose source failed to load: legend shows "n/a" instead of a misleading 0. */
  unavailable?: { ai?: boolean; general?: boolean };
}) {
  const reduce = useReducedMotion();
  const [revealed, setRevealed] = useState(false);
  const reveal = !reduce && !revealed;
  const totals = data.reduce((acc, d) => ({ ai: acc.ai + d.ai, general: acc.general + d.general }), { ai: 0, general: 0 });
  const dense = data.length > 14;

  return (
    <div className="flex h-full flex-col">
      <ChartLegend
        className="px-5 pt-4"
        items={[
          { label: "AI events (ADAS · DSM · BSD)", color: SERIES.s1, value: unavailable?.ai ? "n/a" : totals.ai },
          { label: "Routine alarms", color: SERIES.s2, value: unavailable?.general ? "n/a" : totals.general },
        ]}
      />
      <AnimatePresence mode="wait" initial={false}>
        {view === "chart" ? (
          <motion.div
            key={`chart-${rangeKey}`}
            className="h-[264px] min-w-0 px-3 pt-3 pb-4 xl:h-auto xl:min-h-[264px] xl:flex-1"
            initial={reveal ? { opacity: 0, clipPath: "inset(100% 0 0 0)" } : { opacity: 0 }}
            animate={reveal ? { opacity: 1, clipPath: "inset(0% 0 0 0)" } : { opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ duration: reveal ? 0.42 : 0.2, ease: EASE_OUT }}
            onAnimationComplete={() => setRevealed(true)}
          >
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 248 }}>
              <BarChart data={data} margin={{ top: 4, right: 8, left: -6, bottom: 0 }} barCategoryGap={dense ? "26%" : "40%"}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" {...AXIS_PROPS} interval={dense ? 3 : 0} />
                <YAxis {...AXIS_PROPS} allowDecimals={false} width={40} />
                <Tooltip cursor={{ fill: "var(--dv-surface-sunken)", radius: 8 }} content={<ChartTooltip />} />
                <Bar dataKey="ai" name="AI events" stackId="a" fill={SERIES.s1} stroke="var(--dv-surface-muted)" strokeWidth={2} radius={[0, 0, 4, 4]} maxBarSize={24} isAnimationActive={false} />
                <Bar dataKey="general" name="Routine alarms" stackId="a" fill={SERIES.s2} stroke="var(--dv-surface-muted)" strokeWidth={2} radius={[6, 6, 0, 0]} maxBarSize={24} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </motion.div>
        ) : (
          <motion.div key="table" className="scrollbar-thin max-h-[280px] overflow-y-auto px-5 pt-3 pb-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transitions.base}>
            <table className="w-full text-[13px]">
              <caption className="sr-only">Alarm and AI event counts</caption>
              <thead>
                <tr className="text-left text-[11px] tracking-wide text-ink-muted uppercase">
                  <th className="py-1.5 font-semibold">Period</th>
                  <th className="py-1.5 text-right font-semibold">AI events</th>
                  <th className="py-1.5 text-right font-semibold">Routine</th>
                  <th className="py-1.5 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.key} className="border-t border-line/70">
                    <td className="py-1.5">{d.label}</td>
                    <td className="py-1.5 text-right tabular">{d.ai}</td>
                    <td className="py-1.5 text-right tabular">{d.general}</td>
                    <td className="py-1.5 text-right font-semibold tabular">{d.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
