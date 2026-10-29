"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Battery, Compass, Gauge, MapPin, Mountain, Route, Thermometer, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DeviceStateDto } from "@/features/drive-vision/api/types";
import { formatDateTime, formatNumber, formatRelative } from "@/features/drive-vision/utils/format";
import { StatusBadge } from "../shared/status-badge";
import { transitions } from "../shared/motion";
import { REPORT_AGE_META, checkPosition, reportAge, sensorEntries } from "./live-fleet-model";

function Reading({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-muted/80 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[11px] text-ink-muted">
        <Icon className="size-3.5" aria-hidden /> {label}
      </p>
      <p className="mt-0.5 text-[15px] font-semibold tabular">{value}</p>
    </div>
  );
}

const num = (v: number | undefined | null, unit: string, format: (n: number) => string = String) => (typeof v === "number" ? `${format(v)}${unit}` : "—");

/** Selected-device sheet over the live map: fields from DeviceStateDto only. */
export function LiveDevicePanel({ state, groupName, now, onClose }: { state: DeviceStateDto; groupName?: string; now: Date; onClose: () => void }) {
  const age = reportAge(state, now);
  const pos = checkPosition(state);
  const sensors = sensorEntries(state.sensors);
  const name = state.name ?? `Device ${state.deviceId}`;

  return (
    <motion.aside
      key={state.deviceId}
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={transitions.panel}
      aria-label={`${name} details`}
      className="absolute inset-x-2 bottom-2 z-20 flex max-h-[62%] flex-col overflow-hidden rounded-[20px] border border-line bg-surface shadow-pop md:inset-x-auto md:top-3 md:right-3 md:bottom-3 md:max-h-none md:w-[340px]"
    >
      <div className="flex items-start gap-3 border-b border-line px-4 py-3.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-tint text-brand-deep">
          <Truck className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{name}</p>
          <p className="truncate font-mono text-xs text-ink-muted">{state.terminalNo ?? "—"}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <StatusBadge tone={age === "current" ? "success" : age === "recent" ? "warning" : "neutral"} size="sm">
              {REPORT_AGE_META[age].label}
            </StatusBadge>
            {state.activeAlarm ? (
              <StatusBadge tone="danger" size="sm">
                Alarm: {state.activeAlarm}
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
          <Reading icon={Gauge} label="Speed" value={num(state.speedKmh, " km/h")} />
          <Reading icon={Compass} label="Heading" value={num(state.directionDeg, "°")} />
          <Reading icon={Route} label="Odometer" value={num(state.mileageKm, " km", formatNumber)} />
          <Reading icon={Battery} label="Battery" value={num(state.batteryPct, "%")} />
          <Reading icon={Mountain} label="Altitude" value={num(state.altitudeM, " m")} />
          {sensors.map(([k, v]) => (
            <Reading key={k} icon={Thermometer} label={`Sensor · ${k}`} value={v} />
          ))}
        </div>

        <dl className="space-y-2 text-[13px]">
          <div className="flex gap-2">
            <MapPin className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
            <div className="min-w-0">
              <dt className="sr-only">Position</dt>
              <dd className="font-mono text-xs tabular">{pos.ok ? `${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)}` : <span className="font-sans text-warning">{pos.reason} — not shown on the map</span>}</dd>
              {groupName ? <dd className="text-xs text-ink-muted">{groupName}</dd> : null}
            </div>
          </div>
          <div className="rounded-xl border border-line px-3 py-2 text-xs text-ink-muted">
            Device time <span className="font-medium text-ink">{state.deviceTime ? formatDateTime(state.deviceTime) : "—"}</span>
            {state.deviceTime ? ` (${formatRelative(state.deviceTime, now)})` : ""}
            <br />
            Received <span className="font-medium text-ink">{state.receivedAt ? formatDateTime(state.receivedAt) : "—"}</span>
            {typeof state.videoCapable === "boolean" ? (
              <>
                <br />
                Video capable: <span className="font-medium text-ink">{state.videoCapable ? "Yes" : "No"}</span>
              </>
            ) : null}
          </div>
          <p className="text-[11px] text-ink-subtle" title="Returned by the API; meanings aren't documented, so they aren't interpreted.">
            Raw codes (undocumented): status {state.statusCode ?? "—"} · position mode {state.positionMode ?? "—"} · network {state.networkType ?? "—"} · GSM {state.gsmSignal ?? "—"}
          </p>
        </dl>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
        <Button asChild variant="outline" size="sm">
          <Link href={`/drive-vision/trips?device=${state.deviceId}`}>
            <Route /> Track history
          </Link>
        </Button>
        <Button asChild size="sm">
          <Link href={`/drive-vision/vehicles/${state.deviceId}`}>Details</Link>
        </Button>
      </div>
    </motion.aside>
  );
}
