"use client";

import { cn } from "@/lib/utils";

/** Shared chart styling: recessive axes, hairline grid, text tokens for labels. */
export const AXIS_PROPS = {
  stroke: "var(--dv-border)",
  tick: { fill: "var(--dv-ink-subtle)", fontSize: 11 },
  tickLine: false,
  axisLine: false,
  tickMargin: 8,
} as const;

export const GRID_PROPS = {
  stroke: "var(--dv-border)",
  strokeOpacity: 0.7,
  strokeDasharray: "3 4",
  vertical: false,
} as const;

/** Validated categorical slots (see drive-vision-theme.css). */
export const SERIES = {
  s1: "var(--dv-series-1)",
  s2: "var(--dv-series-2)",
  s3: "var(--dv-series-3)",
  s4: "var(--dv-series-4)",
} as const;

export const SEVERITY_COLORS = {
  critical: "var(--dv-danger)",
  high: "var(--dv-serious)",
  medium: "var(--dv-warning)",
  low: "var(--dv-info)",
} as const;

interface TooltipEntry {
  name?: string | number;
  value?: number | string | (number | string)[];
  color?: string;
  dataKey?: string | number | ((obj: unknown) => unknown);
  payload?: Record<string, unknown>;
}

/** Tooltip body used by every Recharts chart (passed as `content`). */
export function ChartTooltip({
  active,
  payload,
  label,
  unit,
  hideTotal,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  unit?: string;
  hideTotal?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (typeof p.value === "number" ? p.value : 0), 0);
  return (
    <div className="min-w-44 rounded-2xl border border-line/70 bg-surface/98 px-3 py-2.5 text-xs shadow-pop backdrop-blur-sm">
      {label !== undefined ? <p className="mb-2 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">{label}</p> : null}
      <ul className="space-y-1.5">
        {[...payload].reverse().map((p) => (
          <li key={String(p.dataKey ?? p.name)} className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden />
            <span className="flex-1 text-ink-muted">{p.name}</span>
            <span className="font-semibold text-ink tabular">
              {typeof p.value === "number" ? p.value.toLocaleString("en-IN") : String(p.value)}
              {unit ? ` ${unit}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {!hideTotal && payload.length > 1 ? (
        <p className="mt-2 flex justify-between border-t border-line pt-2 text-ink-muted">
          Total <span className="font-semibold text-ink tabular">{total.toLocaleString("en-IN")}</span>
        </p>
      ) : null}
    </div>
  );
}

export function ChartLegend({ items, className }: { items: { label: string; color: string; value?: React.ReactNode }[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-ink-muted", className)}>
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: i.color }} aria-hidden />
          {i.label}
          {i.value !== undefined ? <span className="font-semibold text-ink tabular">{i.value}</span> : null}
        </li>
      ))}
    </ul>
  );
}
