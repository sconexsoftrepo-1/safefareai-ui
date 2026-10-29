import { cn } from "@/lib/utils";

type PanelTone = "surface" | "muted" | "brand" | "mint" | "sky" | "peach" | "lavender";

const toneClass: Record<PanelTone, string> = {
  surface: "bg-surface",
  muted: "bg-surface-muted",
  brand: "bg-brand-tint",
  mint: "bg-mint",
  sky: "bg-sky",
  peach: "bg-peach",
  lavender: "bg-lavender",
};

/**
 * Base card surface (reference: white, 22px radius, hairline border, very soft shadow).
 * `interactive` adds the 2px hover lift used for clickable cards; large panels stay calm
 * and only deepen their border/shadow.
 */
export function Panel({
  className,
  tone = "surface",
  interactive = false,
  as: Comp = "section",
  ...props
}: React.HTMLAttributes<HTMLElement> & { tone?: PanelTone; interactive?: boolean; as?: "section" | "div" | "article" | "aside" }) {
  return (
    <Comp
      className={cn(
        "rounded-card border border-line/60 shadow-card transition-[box-shadow,border-color,transform] duration-200 ease-dv",
        interactive ? "hover:-translate-y-0.5 hover:border-line-strong hover:shadow-hover" : "hover:shadow-hover",
        toneClass[tone],
        className
      )}
      {...props}
    />
  );
}

/** Nested muted panel inside a card (reference: "Wallets" tray, chart well). */
export function InsetPanel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-inner bg-surface-muted", className)} {...props} />;
}

/**
 * Featured coral card (reference: "Total Earnings" / rewards hero). Use for at most one
 * element per view — it carries the brand accent as a soft wash, not a saturated fill.
 */
export function FeaturedCard({ className, as: Comp = "div", ...props }: React.HTMLAttributes<HTMLElement> & { as?: "div" | "section" | "article" }) {
  return <Comp className={cn("relative overflow-hidden rounded-card border border-brand-line/80 bg-brand-wash text-ink shadow-brand-soft", className)} {...props} />;
}

/**
 * Progress bar with a hatched remainder (reference "Monthly Spending Limit").
 * `tone="light"` is for use on the coral featured card.
 */
export function ProgressMeter({
  value,
  max = 100,
  label,
  tone = "brand",
  className,
}: {
  value: number;
  max?: number;
  label: string;
  tone?: "brand" | "ink" | "light" | "success" | "warning" | "danger";
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  const fill = { brand: "bg-brand", ink: "bg-ink", light: "bg-white", success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[tone];
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      className={cn("flex h-2 w-full gap-1 overflow-hidden rounded-full", className)}
    >
      <span className={cn("h-full rounded-full transition-[width] duration-500 ease-dv", fill)} style={{ width: `${pct}%` }} />
      <span className={cn("h-full flex-1 rounded-full", tone === "light" ? "bg-hatch-light" : "bg-hatch")} />
    </div>
  );
}

export function PanelHeader({
  title,
  description,
  action,
  className,
  titleId,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  titleId?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        <h2 id={titleId} className="text-[16px] leading-6 font-semibold tracking-[-0.01em] text-ink">
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-[12.5px] leading-5 text-ink-muted">{description}</p> : null}
      </div>
      {action ? <div className="flex max-w-full min-w-0 items-center gap-2 sm:shrink-0">{action}</div> : null}
    </div>
  );
}
