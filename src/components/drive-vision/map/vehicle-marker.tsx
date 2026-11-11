"use client";

import { useState } from "react";
import type { MapMarker } from "./fleet-map";

/**
 * The vehicle marker of the MapLibre map (GeoMap renders it inside a MapLibre HTML marker anchored at its centre, so
 * the car's centre sits exactly on the reported coordinate). A top-down car on a round backing in the marker's colour
 * (Live Monitoring: the report-age colour — green ≤ 5 min, amber ≤ 1 h, grey stale), with a white border and a soft
 * shadow so it reads on light and dark tiles. The whole 44 px box is the click target, larger than the drawn car.
 *
 * Direction: the car turns to `heading` (compass degrees, 0 = north) only when the caller marks it reliable
 * (`showHeading`, which Live Monitoring sets for a fresh report of a moving vehicle). Otherwise it points up; no
 * direction is derived from earlier positions. GeoMap locks the map bearing at 0 (rotation is disabled), so a compass
 * heading is also the on-screen angle; `mapBearing` is subtracted for safety should rotation ever be enabled.
 */

/** Degrees to rotate the car on screen, or 0 (pointing up) when there is no reliable heading. */
export function carRotation(m: Pick<MapMarker, "heading" | "showHeading">, mapBearing = 0): number {
  if (!m.showHeading || typeof m.heading !== "number" || !Number.isFinite(m.heading)) return 0;
  const deg = (m.heading - (Number.isFinite(mapBearing) ? mapBearing : 0)) % 360;
  return deg < 0 ? deg + 360 : deg;
}

const BOX = 44;
const C = BOX / 2;

/** Top-down car centred on 0,0, front pointing up (−y). ~13 × 21 px at scale 1. */
function Car({ color }: { color: string }) {
  return (
    <g data-car="">
      {/* side mirrors */}
      <rect x={-8.2} y={-4.6} width={2.4} height={2.2} rx={0.8} fill="white" />
      <rect x={5.8} y={-4.6} width={2.4} height={2.2} rx={0.8} fill="white" />
      {/* body */}
      <rect x={-6.4} y={-10.5} width={12.8} height={21} rx={4.6} fill="white" />
      {/* windscreen and rear window in the marker colour, so the car keeps the status colour at a glance */}
      <path d="M-4.6 -3.6 L4.6 -3.6 L3.7 -7.3 Q0 -8.5 -3.7 -7.3 Z" fill={color} />
      <path d="M-4.2 5.2 L4.2 5.2 L3.5 7.6 Q0 8.4 -3.5 7.6 Z" fill={color} opacity={0.85} />
      {/* roof line */}
      <rect x={-4.6} y={-2.6} width={9.2} height={6.8} rx={1.8} fill={color} opacity={0.18} />
    </g>
  );
}

export function VehicleMarkerGlyph({ marker: m, selected, onClick, mapBearing = 0 }: { marker: MapMarker; selected: boolean; onClick?: (id: string) => void; mapBearing?: number }) {
  const [hovered, setHovered] = useState(false);
  const color = m.color ?? "var(--dv-ink-subtle)";
  // Backing radius: 15 → 30 px car badge; 17 → 34 px when selected.
  const r = selected ? 17 : 15;
  const rotation = carRotation(m, mapBearing);
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick: () => onClick(m.id), "aria-pressed": selected } : {})}
      aria-label={`${m.label}${m.statusLabel ? `, ${m.statusLabel}` : ""}${m.alarm ? ", active alarm" : ""}`}
      data-marker-id={m.id}
      data-selected={selected ? "true" : undefined}
      data-rotation={rotation}
      className="relative block outline-none focus-visible:rounded-full focus-visible:ring-2 focus-visible:ring-[var(--dv-ink)]"
      style={{ width: BOX, height: BOX, cursor: onClick ? "pointer" : undefined }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <svg width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden className="overflow-visible" style={{ filter: "drop-shadow(0 1px 2px rgb(0 0 0 / 0.35))" }}>
        <g transform={`translate(${C} ${C})`}>
          {m.alarm ? <circle r={r + 6} fill="var(--dv-danger)" fillOpacity={0.16} stroke="var(--dv-danger)" strokeOpacity={0.55} strokeWidth={1.2} data-alarm-ring="" /> : null}
          {/* Selected: a halo and ring in the vehicle's own colour, visible on light and dark tiles alike. */}
          {selected ? <circle r={r + 4} fill={color} fillOpacity={0.28} stroke={color} strokeWidth={1.6} data-selected-halo="" /> : null}
          <circle r={r} fill={color} stroke="white" strokeWidth={selected ? 2.6 : 2} data-backing="" />
          <g transform={`rotate(${rotation}) scale(${selected ? 1.08 : 1})`}>
            <Car color={color} />
          </g>
        </g>
      </svg>
      {selected || hovered ? (
        <span className="pointer-events-none absolute bottom-[calc(100%+2px)] left-1/2 -translate-x-1/2 rounded-full bg-[var(--dv-ink)] px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white">{m.label}</span>
      ) : null}
    </Tag>
  );
}
