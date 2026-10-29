import type { PlateColor, Vehicle } from "@/features/drive-vision/types";
import { expiryStatus } from "@/features/drive-vision/services/vehicle-service";
import { daysUntil, formatDate } from "@/features/drive-vision/utils/format";
import { DEMO_NOW } from "@/features/drive-vision/mock-data/catalog";
import { cn } from "@/lib/utils";
import { StatusBadge } from "../shared/status-badge";

const PLATE_STYLE: Record<PlateColor, string> = {
  white: "bg-white border-line text-ink",
  yellow: "bg-[#f7e7a6] border-[#e6cf70] text-ink",
  blue: "bg-[#2f5fa8] border-[#244b86] text-white",
  green: "bg-[#2e7d53] border-[#226240] text-white",
  black: "bg-ink border-ink text-white",
};

/** Number-plate chip coloured like the physical plate. */
export function PlateChip({ plate, color, className }: { plate: string; color: PlateColor; className?: string }) {
  return <span className={cn("inline-block rounded-md border px-1.5 py-px font-mono text-[11px] font-semibold tracking-wide whitespace-nowrap", PLATE_STYLE[color], className)}>{plate}</span>;
}

export function ExpiryBadge({
  date,
  label = "Service",
  expiredText,
  showOkDate = true,
  now = DEMO_NOW,
}: {
  date?: string;
  label?: string;
  expiredText?: string;
  showOkDate?: boolean;
  /** Reference time; live screens pass the real clock, sample-data screens keep the snapshot time. */
  now?: Date;
}) {
  const status = expiryStatus(date, now);
  if (status === "none" || !date) return showOkDate ? <span className="text-ink-subtle">—</span> : null;
  const days = daysUntil(date, now);
  if (status === "expired")
    return (
      <StatusBadge tone="danger" size="sm">
        {expiredText ?? `${label} expired`}
      </StatusBadge>
    );
  if (status === "soon")
    return (
      <StatusBadge tone="warning" size="sm">
        {days} d left
      </StatusBadge>
    );
  return showOkDate ? <span className="text-xs text-ink-muted tabular">{formatDate(date)}</span> : null;
}

export function vehicleDisplay(v?: Vehicle) {
  return v ? `${v.vehicleName} · ${v.plate}` : "Removed vehicle";
}
