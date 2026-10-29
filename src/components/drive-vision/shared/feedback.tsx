"use client";

import { useEffect, useState } from "react";
import { FlaskConical, Inbox, type LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DEMO_NOW } from "@/features/drive-vision/mock-data/catalog";
import { formatDateTime } from "@/features/drive-vision/utils/format";

/** Shown in page toolbars: the sample data is a fixed snapshot, not live. */
export const SNAPSHOT_LABEL = `Sample snapshot · ${formatDateTime(DEMO_NOW)} IST`;

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className="mb-3 grid size-12 place-items-center rounded-full bg-surface-muted text-ink-muted">
        <Icon className="size-5" aria-hidden />
      </div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-[13px] text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** Generic skeleton block set for cards, tables and charts. */
export function LoadingSkeleton({ variant = "card", rows = 6, className }: { variant?: "card" | "table" | "chart" | "list"; rows?: number; className?: string }) {
  if (variant === "chart") {
    return (
      <div className={cn("flex h-full min-h-48 items-end gap-2 px-5 pb-5", className)} aria-busy="true" aria-label="Loading chart">
        {Array.from({ length: 12 }, (_, i) => (
          <Skeleton key={i} className="flex-1 rounded-md bg-surface-muted" style={{ height: `${30 + ((i * 37) % 60)}%` }} />
        ))}
      </div>
    );
  }
  if (variant === "table" || variant === "list") {
    return (
      <div className={cn("space-y-2.5 p-5", className)} aria-busy="true" aria-label="Loading">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-xl bg-surface-muted" />
        ))}
      </div>
    );
  }
  return (
    <div className={cn("space-y-3 p-5", className)} aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-1/3 bg-surface-muted" />
      <Skeleton className="h-8 w-1/2 bg-surface-muted" />
      <Skeleton className="h-3 w-2/3 bg-surface-muted" />
    </div>
  );
}

const seenKeys = new Set<string>();

/**
 * Simulated first-load latency for a screen section (once per session per key), so
 * skeleton states are visible without slowing down repeat navigation.
 */
export function useSimulatedLoading(key: string, ms = 480) {
  const [loading, setLoading] = useState(() => !seenKeys.has(key));
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => {
      seenKeys.add(key);
      setLoading(false);
    }, ms);
    return () => clearTimeout(timer);
  }, [key, loading, ms]);
  return loading;
}

/** Subtle indicator that content is sample data. */
export function DemoBadge({ label = "Demo data", className }: { label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border border-dashed border-brand/40 bg-brand-tint px-2 py-0.5 text-[11px] font-medium text-brand-deep", className)}>
      <FlaskConical className="size-3" aria-hidden />
      {label}
    </span>
  );
}
