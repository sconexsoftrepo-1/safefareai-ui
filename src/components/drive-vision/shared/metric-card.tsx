"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { EASE_OUT } from "./motion";

type Accent = "neutral" | "brand" | "mint" | "sky" | "peach" | "lavender";

const accentChip: Record<Accent, string> = {
  neutral: "bg-surface-sunken text-ink-muted",
  brand: "bg-brand-soft text-brand-deep",
  mint: "bg-mint text-success",
  sky: "bg-sky text-info",
  peach: "bg-peach text-serious",
  lavender: "bg-lavender text-ai-ink",
};

export interface MetricTrend {
  /** e.g. "+12%" */
  label: string;
  direction: "up" | "down" | "flat";
  /** Whether this direction is good news (drives the colour, never colour alone — an arrow is shown too). */
  positive: boolean;
  hint?: string;
}

/** Compact bar sparkline. Last bar is emphasised; values are labelled for assistive tech. */
export function Sparkline({ values, label, className, inverted = false }: { values: number[]; label: string; className?: string; inverted?: boolean }) {
  const max = Math.max(1, ...values);
  return (
    <span role="img" aria-label={`${label}: ${values.join(", ")}`} className={cn("flex h-8 items-end gap-[3px]", className)}>
      {values.map((v, i) => {
        const last = i === values.length - 1;
        return (
          <span
            key={i}
            className={cn("w-[5px] rounded-full", inverted ? (last ? "bg-white" : "bg-white/40") : last ? "bg-brand" : "bg-ink/15")}
            style={{ height: `${Math.max(12, (v / max) * 100)}%` }}
          />
        );
      })}
    </span>
  );
}

/** Thin proportional bar (e.g. online vs offline). Each segment carries a title for hover. */
export function RatioBar({ segments, label }: { segments: { value: number; color: string; name: string }[]; label: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <span role="img" aria-label={`${label}: ${segments.map((s) => `${s.name} ${s.value}`).join(", ")}`} className="flex h-2 w-full gap-[3px] overflow-hidden rounded-full">
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <span key={s.name} title={`${s.name}: ${s.value}`} className="h-full rounded-full" style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
        ))}
    </span>
  );
}

export function TrendChip({ trend, inverted = false }: { trend: MetricTrend; inverted?: boolean }) {
  const TrendIcon = trend.direction === "down" ? ArrowDownRight : ArrowUpRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular",
        inverted
          ? "bg-white/20 text-white"
          : trend.direction === "flat"
            ? "bg-surface-sunken text-ink-muted"
            : trend.positive
              ? "bg-success-soft text-success"
              : "bg-danger-soft text-danger"
      )}
      title={trend.hint}
    >
      {trend.direction !== "flat" ? <TrendIcon className="size-3" aria-hidden /> : null}
      {trend.label}
      {trend.hint ? <span className="sr-only"> {trend.hint}</span> : null}
    </span>
  );
}

/**
 * KPI card (reference "Total Spending" tile): muted label with an icon chip on the right,
 * a large value, then a trend chip and a short period/secondary line.
 * `tone="featured"` renders the soft coral tile (white-led wash, coral chip and hairline) — use
 * once per view for the headline KPI so it stands out without dominating the page.
 */
export function MetricCard({
  label,
  value,
  sublabel,
  icon: Icon,
  accent = "neutral",
  tone = "surface",
  href,
  spark,
  footer,
  trend,
  live = false,
  index = 0,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sublabel?: React.ReactNode;
  icon: LucideIcon;
  accent?: Accent;
  tone?: "surface" | "muted" | "featured";
  href?: string;
  spark?: number[];
  footer?: React.ReactNode;
  trend?: MetricTrend;
  live?: boolean;
  index?: number;
  className?: string;
}) {
  const featured = tone === "featured";

  const body = (
    <div
      className={cn(
        "group @container relative flex h-full min-h-[132px] flex-col overflow-hidden rounded-card border p-[18px] transition-[box-shadow,border-color,transform] duration-200 ease-dv",
        featured
          ? "border-brand-line/80 bg-brand-wash shadow-brand-soft"
          : tone === "muted"
            ? "border-transparent bg-surface-muted"
            : "border-line/60 bg-surface shadow-card",
        href && "group-hover/link:-translate-y-0.5 group-active/link:translate-y-0 group-active/link:duration-75",
        href && featured && "group-hover/link:border-brand-line group-hover/link:shadow-brand",
        href && !featured && "group-hover/link:border-line-strong group-hover/link:bg-surface group-hover/link:shadow-hover",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <p className={cn("line-clamp-2 min-w-0 flex-1 pt-1.5 text-[13px] leading-[18px] font-medium", featured ? "text-brand-deep" : "text-ink-muted")}>{label}</p>
        {live ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success">
            <span className="size-1.5 rounded-full bg-success" aria-hidden />
            Live
          </span>
        ) : null}
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", featured ? "bg-brand text-white shadow-brand-soft" : accentChip[accent])}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>

      {/* Value block sits at the bottom so tiles stretched by the grid keep label-top / number-bottom alignment. */}
      <div className="mt-auto pt-2.5">
        <div className="flex items-end justify-between gap-3">
          <p className="text-[24px] leading-none font-semibold tracking-[-0.02em] whitespace-nowrap text-ink tabular @[12rem]:text-[30px]">{value}</p>
          {spark && spark.length > 0 ? <Sparkline values={spark} label={`${label} trend`} className="shrink-0" /> : null}
        </div>

        {trend || sublabel ? (
          <div className="mt-1.5 flex min-h-5 min-w-0 items-center gap-2">
            {trend ? <TrendChip trend={trend} /> : null}
            {sublabel ? <p className="min-w-0 truncate text-xs text-ink-muted">{sublabel}</p> : null}
          </div>
        ) : null}

        {footer ? <div className="pt-3">{footer}</div> : null}
      </div>
    </div>
  );

  return (
    <motion.div
      className="h-full"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE_OUT, delay: 0.04 + index * 0.05 }}
    >
      {href ? (
        <Link href={href} className="group/link block h-full rounded-card focus-visible:ring-[3px] focus-visible:ring-brand/40 focus-visible:outline-none" aria-label={`${label}: open details`}>
          {body}
        </Link>
      ) : (
        body
      )}
    </motion.div>
  );
}
