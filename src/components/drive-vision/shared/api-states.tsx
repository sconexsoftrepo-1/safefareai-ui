"use client";

import { CircleSlash, CloudOff, Database, Lock, RefreshCw, ServerCrash, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiErrorMeta, describeApiError, isApiError } from "@/features/drive-vision/api/errors";
import type { DataSourceExtend } from "@/features/drive-vision/api/types";
import { formatDateTime } from "@/features/drive-vision/utils/format";

export { apiErrorMeta };

function ErrorIcon({ error }: { error: unknown }) {
  const props = { className: "size-5", "aria-hidden": true } as const;
  if (!isApiError(error)) return <ServerCrash {...props} />;
  if (error.kind === "network" || error.kind === "timeout") return <WifiOff {...props} />;
  if (error.status === 403) return <Lock {...props} />;
  if (error.status === 503) return <CloudOff {...props} />;
  return <ServerCrash {...props} />;
}

/** Error state for a failed API read: server message, correlation details, optional retry. */
export function ApiErrorState({ error, onRetry, title, className, compact = false }: { error: unknown; onRetry?: () => void; title?: string; className?: string; compact?: boolean }) {
  const forbidden = isApiError(error) && error.status === 403;
  const meta = apiErrorMeta(error);
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 text-center", compact ? "py-6" : "py-10", className)} role="alert">
      <div className="mb-3 grid size-11 place-items-center rounded-full bg-danger-soft text-danger">
        <ErrorIcon error={error} />
      </div>
      <p className="text-sm font-semibold text-ink">{title ?? (forbidden ? "You don't have access to this" : "Couldn't load this data")}</p>
      <p className="mt-1 max-w-sm text-[13px] text-ink-muted">{describeApiError(error)}</p>
      {meta ? <p className="mt-1 font-mono text-[11px] break-all text-ink-subtle">{meta}</p> : null}
      {onRetry && !forbidden ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      ) : null}
    </div>
  );
}

/** A section whose data the backend doesn't provide. Says so instead of showing a made-up number. */
export function UnavailableState({ title = "Not available yet", reason, className }: { title?: string; reason: string; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
      <div className="mb-3 grid size-11 place-items-center rounded-full bg-surface-muted text-ink-muted">
        <CircleSlash className="size-5" aria-hidden />
      </div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 max-w-sm text-[13px] text-ink-muted">{reason}</p>
    </div>
  );
}

const FALLBACK_LABELS: Record<string, string> = {
  VENDOR_NOT_CONFIGURED: "the vendor feed isn't configured on the server",
};

/**
 * Data-source chip from a vendor-backed read's `extend`: live vendor data vs. locally
 * stored (possibly stale) data. Hidden when the response carried no source.
 */
export function DataSourceBadge({ source, className }: { source: DataSourceExtend | null | undefined; className?: string }) {
  if (!source?.source) return null;
  const local = source.source !== "VENDOR";
  const label = local ? (source.stale ? "Stored data · may be stale" : "Stored data") : source.stale ? "Vendor data · stale" : "Live vendor data";
  const reason = source.fallbackReason ? (FALLBACK_LABELS[source.fallbackReason] ?? source.fallbackReason) : null;
  const title = [
    `Source: ${source.source}`,
    reason ? `Reason: ${reason}` : null,
    source.syncedAt ? `Last synced ${formatDateTime(source.syncedAt)}` : local ? "Never synced from vendor" : null,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        local || source.stale ? "border-warning/30 bg-warning-soft text-warning" : "border-success/30 bg-success-soft text-success",
        className
      )}
      title={title}
    >
      <Database className="size-3" aria-hidden />
      {label}
    </span>
  );
}

/** Banner explaining a non-live data source, with the server's reason. */
export function DataSourceNotice({ source, className }: { source: DataSourceExtend | null | undefined; className?: string }) {
  if (!source?.source || (source.source === "VENDOR" && !source.stale)) return null;
  const reason = source.fallbackReason ? (FALLBACK_LABELS[source.fallbackReason] ?? source.fallbackReason) : null;
  return (
    <div className={cn("flex items-start gap-2 rounded-xl border border-warning/25 bg-warning-soft px-3.5 py-2.5 text-[13px] text-warning", className)} role="status">
      <Database className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        {source.source === "VENDOR" ? "Vendor data is stale" : "Showing data stored on the SafeFare server, not a live vendor feed"}
        {reason ? ` — ${reason}` : ""}.{" "}
        {source.syncedAt ? `Last vendor sync ${formatDateTime(source.syncedAt)}.` : source.source !== "VENDOR" ? "No vendor sync has happened yet." : ""}
        {source.fallbackReason ? <span className="ml-1 font-mono text-[11px] opacity-75">({source.fallbackReason})</span> : null}
      </p>
    </div>
  );
}
