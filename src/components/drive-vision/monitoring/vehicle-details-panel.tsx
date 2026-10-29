"use client";

import Link from "next/link";
import { motion } from "motion/react";
import {
  Battery,
  Cctv,
  Crosshair,
  Fuel,
  Gauge,
  KeyRound,
  MapPin,
  Package,
  Route,
  Satellite,
  SignalHigh,
  Thermometer,
  Truck,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { Driver, Vehicle, VehicleGroup } from "@/features/drive-vision/types";
import type { LivePosition } from "@/features/drive-vision/hooks/use-live-simulation";
import { DEMO_NOW } from "@/features/drive-vision/mock-data/catalog";
import { formatDateTime, formatNumber, formatRelative } from "@/features/drive-vision/utils/format";
import { formatLatLon } from "@/features/drive-vision/utils/geo";
import { cn } from "@/lib/utils";
import { VehicleStateBadge, StatusBadge } from "../shared/status-badge";
import { transitions } from "../shared/motion";

function Reading({ icon: Icon, label, value, warn }: { icon: React.ElementType; label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className={cn("rounded-xl px-3 py-2.5", warn ? "bg-danger-soft" : "bg-surface-muted/80")}>
      <p className="flex items-center gap-1.5 text-[11px] text-ink-muted">
        <Icon className="size-3.5" aria-hidden /> {label}
      </p>
      <p className={cn("mt-0.5 text-[15px] font-semibold tabular", warn ? "text-danger" : "text-ink")}>{value}</p>
    </div>
  );
}

/** Selected-vehicle summary sheet (vendor 3.1 fields) shown over the live map. */
export function VehicleDetailsPanel({
  vehicle,
  live,
  driver,
  group,
  follow,
  onFollowChange,
  onClose,
}: {
  vehicle: Vehicle;
  live?: LivePosition;
  driver?: Driver;
  group?: VehicleGroup;
  follow: boolean;
  onFollowChange: (v: boolean) => void;
  onClose: () => void;
}) {
  const t = vehicle.telemetry;
  const speed = live?.speed ?? t.speed;
  const position = live ?? t;
  const tempWarn = t.temperature !== undefined && t.temperature > 8;

  return (
    <motion.aside
      key={vehicle.vehicleId}
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={transitions.panel}
      aria-label={`${vehicle.vehicleName} details`}
      className="absolute inset-x-2 bottom-2 z-20 flex max-h-[62%] flex-col overflow-hidden rounded-[20px] border border-line bg-surface shadow-pop md:inset-x-auto md:top-3 md:right-3 md:bottom-3 md:max-h-none md:w-[340px]"
    >
      <div className="flex items-start gap-3 border-b border-line px-4 py-3.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-tint text-brand-deep">
          <Truck className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{vehicle.vehicleName}</p>
          <p className="truncate text-xs text-ink-muted">
            {vehicle.plate} · {vehicle.vehicleType}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <VehicleStateBadge state={t.vehicleState} size="sm" />
            {t.alarm ? (
              <StatusBadge tone="danger" size="sm">
                Active alarm
              </StatusBadge>
            ) : null}
          </div>
        </div>
        <Button variant="outline" size="icon-sm" className="rounded-full" onClick={onClose} aria-label="Clear selection">
          <X />
        </Button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-2 gap-2">
          <Reading icon={Gauge} label="Speed" value={`${speed} km/h`} warn={speed >= 80} />
          <Reading icon={KeyRound} label="Ignition (ACC)" value={t.accState ? "On" : "Off"} />
          <Reading icon={Route} label="Odometer" value={`${formatNumber(t.mileage)} km`} />
          <Reading icon={Satellite} label="GPS" value={t.posState ? "Fixed" : "No fix"} warn={!t.posState && t.vehicleState !== "offline"} />
          <Reading icon={SignalHigh} label={`Signal · ${t.netModel}`} value={`${t.gsmSin}/5`} />
          <Reading icon={Battery} label="Power" value={`${t.power}%`} warn={t.power < 20} />
          {t.fuel !== undefined ? <Reading icon={Fuel} label="Fuel" value={`${t.fuel}%`} warn={t.fuel < 15} /> : null}
          {t.temperature !== undefined ? <Reading icon={Thermometer} label="Cargo temp." value={`${t.temperature} °C`} warn={tempWarn} /> : null}
          {t.load !== undefined ? <Reading icon={Package} label="Load" value={`${formatNumber(t.load)} kg`} /> : null}
        </div>

        <dl className="space-y-2 text-[13px]">
          <div className="flex gap-2">
            <MapPin className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
            <div className="min-w-0">
              <dt className="sr-only">Location</dt>
              <dd className="font-medium">{t.address}</dd>
              <dd className="text-xs text-ink-muted tabular">{formatLatLon(position)}</dd>
            </div>
          </div>
          <div className="flex gap-2">
            <UserRound className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
            <div>
              <dt className="sr-only">Driver</dt>
              <dd className="font-medium">{driver?.name ?? "No driver assigned"}</dd>
              <dd className="text-xs text-ink-muted">{group?.groupName ?? "—"}</dd>
            </div>
          </div>
          <div className="rounded-xl border border-line px-3 py-2 text-xs text-ink-muted">
            Last report <span className="font-medium text-ink">{formatDateTime(t.lastReportTime)}</span> ({formatRelative(t.lastReportTime, DEMO_NOW)})
            <br />
            Device <span className="font-medium text-ink tabular">{vehicle.terminalNo}</span> · {vehicle.terminalType}
          </div>
        </dl>

        <label className="flex items-center justify-between gap-3 rounded-xl bg-sky/60 px-3 py-2.5">
          <span className="flex items-center gap-2 text-[13px] font-medium">
            <Crosshair className="size-4" aria-hidden /> Follow this vehicle
          </span>
          <Switch checked={follow} onCheckedChange={onFollowChange} aria-label="Follow selected vehicle" disabled={t.vehicleState === "offline"} />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-2 border-t border-line p-3">
        <Button asChild variant="outline" size="sm">
          <Link href={`/drive-vision/video?vehicle=${vehicle.vehicleId}`}>
            <Cctv /> Video
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={`/drive-vision/trips?vehicle=${vehicle.vehicleId}`}>
            <Route /> Trips
          </Link>
        </Button>
        <Button asChild size="sm">
          <Link href={`/drive-vision/vehicles/${vehicle.vehicleId}`}>Details</Link>
        </Button>
      </div>
    </motion.aside>
  );
}
