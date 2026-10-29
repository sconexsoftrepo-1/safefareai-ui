import { cn } from "@/lib/utils";

/**
 * Page toolbar. The shell header already shows the page title (h1) and subtitle, as in
 * the reference design, so by default this renders only the page-specific summary,
 * status badges and actions. Detail pages pass `showTitle` to name the entity (h2).
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  showTitle = false,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
  showTitle?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between", showTitle && "lg:items-end", className)}>
      <div className="min-w-0">
        {showTitle ? <h2 className="mb-1 text-[24px] leading-tight font-semibold tracking-[-0.02em] text-ink">{title}</h2> : null}
        {description || eyebrow ? (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            {description ? <p className="text-[13px] text-ink-muted">{description}</p> : null}
            {eyebrow ? <div className="flex flex-wrap items-center gap-1.5">{eyebrow}</div> : null}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 lg:shrink-0">{actions}</div> : null}
    </div>
  );
}
