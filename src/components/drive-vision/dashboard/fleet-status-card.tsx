"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChartTooltip } from "../charts/chart-kit";
import { EASE_OUT } from "../shared/motion";

export interface StatusSegment {
  key: string;
  label: string;
  value: number;
  color: string;
  href: string;
}

export interface HealthIssue {
  label: string;
  /** null = not derivable from the API; rendered as "—" with `note` as the tooltip. */
  value: number | null;
  icon: LucideIcon;
  href: string;
  note?: string;
}

/** Status distribution donut (e.g. realtime onlineCount / offlineCount) with device-health issues. */
export function FleetStatusCard({ segments, total, online, issues }: { segments: StatusSegment[]; total: number; online: number; issues: HealthIssue[] }) {
  const data = segments.map((s) => ({ key: s.key, name: s.label, value: s.value, color: s.color, href: s.href }));
  const onlinePct = total ? Math.round((online / total) * 100) : 0;

  return (
    <div className="@container flex h-full flex-col px-5 pt-3 pb-5">
      {/* Donut beside its legend keeps the card (and so the whole first dashboard row) compact; stacks in narrow cards. */}
      <div className="flex flex-1 flex-col items-center gap-3 @[19rem]:flex-row @[19rem]:justify-center @[19rem]:gap-5">
        <motion.div
          className="relative size-[132px] shrink-0"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.32, ease: EASE_OUT }}
        >
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 132, height: 132 }}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius={47}
                outerRadius={64}
                paddingAngle={3}
                stroke="var(--dv-surface)"
                strokeWidth={2}
                cornerRadius={6}
                startAngle={90}
                endAngle={-270}
                isAnimationActive={false}
              >
                {data.map((d) => (
                  <Cell key={d.key} fill={d.color} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip hideTotal unit="vehicles" />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-[23px] leading-none font-semibold tracking-tight tabular">{onlinePct}%</p>
              <p className="mt-0.5 text-[11px] font-medium text-ink-muted">online</p>
              <p className="text-[11px] text-ink-subtle tabular">
                {online} of {total}
              </p>
            </div>
          </div>
        </motion.div>

        <ul className="grid w-full min-w-0 grid-cols-2 gap-x-3 gap-y-0.5 @[19rem]:max-w-60 @[19rem]:flex-1 @[19rem]:grid-cols-1" aria-label="Vehicle status breakdown">
          {data.map((d) => (
            <li key={d.key}>
              <Link
                href={d.href}
                className="grid grid-cols-[8px_1fr_auto_2.25rem] items-center gap-2 rounded-lg px-2 py-1 text-[13px] transition-colors duration-150 hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none"
              >
                <span className="size-2 rounded-full" style={{ background: d.color }} aria-hidden />
                <span className="text-ink-muted">{d.name}</span>
                <span className="font-semibold tabular">{d.value}</span>
                <span className="text-right text-xs text-ink-subtle tabular">{total ? Math.round((d.value / total) * 100) : 0}%</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3.5 border-t border-line/70 pt-3.5">
        <p className="mb-2 text-[11px] font-semibold tracking-wide text-ink-subtle uppercase">Device health</p>
        <div className="grid grid-cols-2 gap-2">
          {issues.map((i) => (
            <Link
              key={i.label}
              href={i.href}
              title={i.note}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
                i.value !== null && i.value > 0 ? "border-line bg-surface hover:bg-surface-muted" : "border-transparent bg-surface-muted/60 hover:bg-surface-muted"
              )}
            >
              <i.icon className={cn("size-3.5 shrink-0", i.value !== null && i.value > 0 ? "text-serious" : "text-ink-subtle")} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-ink-muted">{i.label}</span>
              <span className={i.value !== null && i.value > 0 ? "font-semibold text-ink tabular" : "text-ink-subtle tabular"}>{i.value ?? "—"}</span>
              {i.value === null && i.note ? <span className="sr-only">{i.note}</span> : null}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
