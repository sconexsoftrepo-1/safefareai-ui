import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  CirclePause,
  CircleSlash,
  Clock3,
  Info,
  Navigation,
  ParkingCircle,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import type { AlarmStatus, Severity, VehicleState } from "@/features/drive-vision/types";
import { cn } from "@/lib/utils";

export type Tone = "success" | "warning" | "serious" | "danger" | "info" | "neutral" | "brand" | "lavender";

const toneClass: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  serious: "bg-serious-soft text-serious",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  neutral: "bg-surface-muted text-ink-muted",
  brand: "bg-brand-soft text-brand-deep",
  lavender: "bg-lavender text-ai-ink",
};

/** Status pill: colour is always paired with an icon and a text label (never colour alone). */
export function StatusBadge({
  tone,
  icon: Icon,
  children,
  className,
  size = "md",
}: {
  tone: Tone;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        toneClass[tone],
        className
      )}
    >
      {Icon ? <Icon className={size === "sm" ? "size-3" : "size-3.5"} aria-hidden /> : null}
      {children}
    </span>
  );
}

export const VEHICLE_STATE_META: Record<VehicleState, { label: string; tone: Tone; icon: LucideIcon; color: string }> = {
  moving: { label: "Moving", tone: "success", icon: Navigation, color: "var(--dv-success)" },
  idle: { label: "Idle", tone: "warning", icon: CirclePause, color: "var(--dv-warning)" },
  parked: { label: "Parked", tone: "info", icon: ParkingCircle, color: "var(--dv-info)" },
  offline: { label: "Offline", tone: "neutral", icon: WifiOff, color: "var(--dv-ink-subtle)" },
};

export function VehicleStateBadge({ state, size }: { state: VehicleState; size?: "sm" | "md" }) {
  const meta = VEHICLE_STATE_META[state];
  return (
    <StatusBadge tone={meta.tone} icon={meta.icon} size={size}>
      {meta.label}
    </StatusBadge>
  );
}

export const SEVERITY_META: Record<Severity, { label: string; tone: Tone; icon: LucideIcon }> = {
  critical: { label: "Critical", tone: "danger", icon: AlertOctagon },
  high: { label: "High", tone: "serious", icon: AlertTriangle },
  medium: { label: "Medium", tone: "warning", icon: CircleDot },
  low: { label: "Low", tone: "info", icon: Info },
};

export function SeverityBadge({ severity, size }: { severity: Severity; size?: "sm" | "md" }) {
  const meta = SEVERITY_META[severity];
  return (
    <StatusBadge tone={meta.tone} icon={meta.icon} size={size}>
      {meta.label}
    </StatusBadge>
  );
}

export const ALARM_STATUS_META: Record<AlarmStatus, { label: string; tone: Tone; icon: LucideIcon }> = {
  new: { label: "New", tone: "brand", icon: CircleDashed },
  acknowledged: { label: "Acknowledged", tone: "warning", icon: Clock3 },
  in_progress: { label: "In progress", tone: "info", icon: CircleDot },
  resolved: { label: "Resolved", tone: "success", icon: CheckCircle2 },
  false_positive: { label: "False positive", tone: "neutral", icon: CircleSlash },
};

export function AlarmStatusBadge({ status, size }: { status: AlarmStatus; size?: "sm" | "md" }) {
  const meta = ALARM_STATUS_META[status];
  return (
    <StatusBadge tone={meta.tone} icon={meta.icon} size={size}>
      {meta.label}
    </StatusBadge>
  );
}
