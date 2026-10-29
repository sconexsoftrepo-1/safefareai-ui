"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Locate, Map as MapIcon, Minus, Plus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { LatLon, VehicleState } from "@/features/drive-vision/types";
import { cn } from "@/lib/utils";
import { VEHICLE_STATE_META } from "../shared/status-badge";
import { MapBase, MapLabels } from "./map-base";
import { createProjection, DEMO_PROJECTION, type GeoBounds, type Projection } from "./projection";
import { EASE_OUT } from "../shared/motion";

export interface MapMarker extends LatLon {
  id: string;
  /** Sample-data state; colours the marker unless `color` is given. */
  state?: VehicleState;
  /** Overrides the state colour (live data colours by report age instead). */
  color?: string;
  /** Spoken status for the marker's accessible name when `state` is absent. */
  statusLabel?: string;
  /** Draw the heading arrow without a "moving" state. */
  showHeading?: boolean;
  heading?: number;
  label: string;
  alarm?: boolean;
}

export interface MapRoute {
  id: string;
  points: LatLon[];
  color?: string;
  /** 0–1: portion already played; drawn darker. */
  progress?: number;
  dim?: boolean;
}

export interface MapPin extends LatLon {
  id: string;
  kind: "start" | "end" | "stop" | "alarm";
  title: string;
  glyph?: string;
}

export interface MapFence {
  id: string;
  kind: "circle" | "polygon" | "line";
  points: LatLon[];
  radius?: number;
  color: string;
  label?: string;
  draft?: boolean;
}

interface View {
  cx: number;
  cy: number;
  zoom: number;
}

const MIN_ZOOM = 0.9;
const MAX_ZOOM = 12;
const clampZoom = (z: number, max = MAX_ZOOM) => Math.min(max, Math.max(MIN_ZOOM, z));
const defaultView = (proj: Projection): View => ({ cx: proj.width / 2, cy: proj.height / 2, zoom: 1 });

function fitView(points: LatLon[], size: { w: number; h: number }, proj: Projection, maxZoom = MAX_ZOOM, padPx = 70): View {
  if (points.length === 0) return defaultView(proj);
  const xy = points.map(proj.project);
  const minX = Math.min(...xy.map((p) => p.x));
  const maxX = Math.max(...xy.map((p) => p.x));
  const minY = Math.min(...xy.map((p) => p.y));
  const maxY = Math.max(...xy.map((p) => p.y));
  const aspect = size.h / size.w;
  const usableW = Math.max(40, size.w - padPx * 2) / size.w;
  const usableH = Math.max(40, size.h - padPx * 2) / size.h;
  const needW = Math.max((maxX - minX) / usableW, (maxY - minY) / usableH / aspect, 60);
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, zoom: clampZoom(proj.width / needW, maxZoom) };
}

export function FleetMap({
  markers = [],
  selectedId,
  onMarkerClick,
  routes = [],
  pins = [],
  activePinId,
  onPinClick,
  fences = [],
  selectedFenceId,
  onFenceClick,
  onMapClick,
  focus,
  fitPoints,
  fitKey,
  cluster = false,
  crosshair = false,
  className,
  ariaLabel,
  children,
  showLegend = true,
  legend,
  bounds,
  basemap = true,
  maxZoom = MAX_ZOOM,
  mapNote,
  controlsPosition = "right",
  focusPadRight = 0,
}: {
  markers?: MapMarker[];
  selectedId?: string | null;
  onMarkerClick?: (id: string) => void;
  routes?: MapRoute[];
  pins?: MapPin[];
  activePinId?: string | null;
  onPinClick?: (id: string) => void;
  fences?: MapFence[];
  selectedFenceId?: string | null;
  onFenceClick?: (id: string) => void;
  onMapClick?: (p: LatLon) => void;
  /** When set (and its value changes) the map centres on it — used by follow mode. */
  focus?: (LatLon & { zoom?: number }) | null;
  /** Points to frame; re-fits whenever `fitKey` changes. */
  fitPoints?: LatLon[];
  fitKey?: string | number;
  cluster?: boolean;
  crosshair?: boolean;
  className?: string;
  ariaLabel: string;
  children?: React.ReactNode;
  showLegend?: boolean;
  /** Custom legend entries (replaces the vehicle-state legend). */
  legend?: { label: string; color: string }[];
  /** Geographic extent to project. Omit for the illustrative demo region. Pass a memoised object. */
  bounds?: GeoBounds | null;
  /** Draw the illustrative demo base map (only applies without `bounds`). */
  basemap?: boolean;
  maxZoom?: number;
  /** Bottom-left caption describing what the map shows. */
  mapNote?: string;
  controlsPosition?: "left" | "right";
  /** Pixels covered by a right-hand overlay; focus centring compensates for it. */
  focusPadRight?: number;
}) {
  const proj = useMemo(() => (bounds ? createProjection(bounds) : DEMO_PROJECTION), [bounds]);
  const projKey = bounds ? `${bounds.minLat},${bounds.maxLat},${bounds.minLon},${bounds.maxLon}` : "demo";
  const clamp = useCallback((z: number) => clampZoom(z, maxZoom), [maxZoom]);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const reduceMotion = useReducedMotion();
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [view, setView] = useState<View>(() => defaultView(proj));
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean; pointerId: number } | null>(null);
  const pinch = useRef(new Map<number, { x: number; y: number }>());
  const [hoverId, setHoverId] = useState<string | null>(null);

  // Track container size; the first real measurement triggers one re-fit.
  const [measured, setMeasured] = useState(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setSize({ w: width, h: height });
        setMeasured(true);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const focusOn = (base: View, f: NonNullable<typeof focus>): View => {
    const { x, y } = proj.project(f);
    const zoom = f.zoom ? clamp(f.zoom) : Math.max(base.zoom, 3.4);
    // Keep the focused point clear of an overlay panel on the right (wide maps only).
    const shift = size.w > 640 ? (focusPadRight / 2) * (proj.width / zoom / size.w) : 0;
    return { cx: x + shift, cy: y, zoom };
  };

  // Re-fit when the caller's fit key changes or on first measurement (adjust-state-during-render pattern).
  // An active `focus` always wins over the fit.
  const fitSignature = `${fitKey ?? ""}|${measured}|${projKey}`;
  const [prevFit, setPrevFit] = useState<string | null>(null);
  if (fitPoints && fitSignature !== prevFit) {
    setPrevFit(fitSignature);
    const fitted = fitView(fitPoints, size, proj, maxZoom);
    setView(focus ? focusOn(fitted, focus) : fitted);
  }

  // Centre on `focus` whenever it changes.
  const focusSignature = focus ? `${focus.lat.toFixed(5)},${focus.lon.toFixed(5)},${focus.zoom ?? ""}` : null;
  const [prevFocus, setPrevFocus] = useState<string | null>(null);
  if (focusSignature !== prevFocus) {
    setPrevFocus(focusSignature);
    if (focus) setView((v) => focusOn(v, focus));
  }

  const vbW = proj.width / view.zoom;
  const vbH = vbW * (size.h / size.w);
  const viewBox = `${(view.cx - vbW / 2).toFixed(2)} ${(view.cy - vbH / 2).toFixed(2)} ${vbW.toFixed(2)} ${vbH.toFixed(2)}`;
  const upx = vbW / size.w; // map units per screen pixel

  const zoomBy = useCallback((factor: number, anchor?: { x: number; y: number }) => {
    setView((v) => {
      const zoom = clamp(v.zoom * factor);
      if (!anchor) return { ...v, zoom };
      const k = v.zoom / zoom;
      return { zoom, cx: anchor.x + (v.cx - anchor.x) * k, cy: anchor.y + (v.cy - anchor.y) * k };
    });
  }, [setView, clamp]);

  const toMapPoint = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }, []);

  // Wheel zoom needs a non-passive listener to prevent page scroll.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const anchor = toMapPoint(e.clientX, e.clientY) ?? undefined;
      zoomBy(e.deltaY < 0 ? 1.18 : 1 / 1.18, anchor);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [toMapPoint, zoomBy]);

  function onPointerDown(e: React.PointerEvent) {
    pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current.size > 1) return;
    drag.current = { x: e.clientX, y: e.clientY, view, moved: false, pointerId: e.pointerId };
  }

  function onPointerMove(e: React.PointerEvent) {
    const prev = pinch.current.get(e.pointerId);
    if (pinch.current.size === 2 && prev) {
      const other = [...pinch.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
      if (other) {
        const before = Math.hypot(prev.x - other.x, prev.y - other.y);
        const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        if (before > 0) zoomBy(after / before);
      }
      pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      return;
    }
    pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
      (e.currentTarget as Element).setPointerCapture?.(d.pointerId);
    }
    const k = proj.width / d.view.zoom / size.w;
    setView({ ...d.view, cx: d.view.cx - dx * k, cy: d.view.cy - dy * k });
  }

  function onPointerUp(e: React.PointerEvent) {
    pinch.current.delete(e.pointerId);
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (d && !d.moved && onMapClick && e.target === e.currentTarget.querySelector("[data-map-hit]")) {
      const pt = toMapPoint(e.clientX, e.clientY);
      if (pt) onMapClick(proj.unproject(pt.x, pt.y));
    }
  }

  function wasDrag() {
    return drag.current?.moved ?? false;
  }

  // Client-side clustering in screen space (workbook: "Map clustering — client side").
  const groups = useMemo(() => {
    if (!cluster || view.zoom >= 3.2) return markers.map((m) => ({ id: m.id, members: [m] }));
    const threshold = 30 * upx;
    const out: { id: string; members: MapMarker[]; x: number; y: number }[] = [];
    for (const m of markers) {
      const p = proj.project(m);
      if (m.id === selectedId) {
        out.push({ id: m.id, members: [m], x: p.x, y: p.y });
        continue;
      }
      const hit = out.find((g) => g.members.length > 0 && g.members[0].id !== selectedId && Math.hypot(g.x - p.x, g.y - p.y) < threshold);
      if (hit) hit.members.push(m);
      else out.push({ id: m.id, members: [m], x: p.x, y: p.y });
    }
    return out;
  }, [cluster, markers, selectedId, upx, view.zoom, proj]);

  const transition = dragging || reduceMotion ? { duration: 0 } : { duration: 0.45, ease: EASE_OUT };

  return (
    <div
      ref={containerRef}
      className={cn("relative isolate h-full min-h-[320px] w-full overflow-hidden rounded-[18px] bg-[var(--dv-map-land)] select-none", className)}
    >
      <motion.svg
        ref={svgRef}
        role="img"
        aria-label={ariaLabel}
        className={cn("absolute inset-0 h-full w-full touch-none", crosshair ? "cursor-crosshair" : dragging ? "cursor-grabbing" : "cursor-grab")}
        initial={false}
        animate={{ viewBox }}
        transition={transition}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(e) => {
          pinch.current.delete(e.pointerId);
          drag.current = null;
          setDragging(false);
        }}
      >
        <rect data-map-hit x={-proj.width} y={-proj.height} width={proj.width * 3} height={proj.height * 3} fill="transparent" />
        {basemap && !bounds ? (
          <>
            <g style={{ pointerEvents: "none" }}>
              <MapBase />
            </g>
            <MapLabels unitsPerPx={upx} />
          </>
        ) : (
          <MapGrid proj={proj} upx={upx} viewBox={{ x: view.cx - vbW / 2, y: view.cy - vbH / 2, w: vbW, h: vbH }} />
        )}

        {/* Geofences */}
        {fences.map((f) => {
          const selected = f.id === selectedFenceId;
          const strokeW = (selected ? 3 : 2) * upx;
          const common = {
            stroke: f.color,
            strokeWidth: strokeW,
            strokeDasharray: f.draft ? `${6 * upx} ${4 * upx}` : undefined,
            onClick: onFenceClick ? (e: React.MouseEvent) => (e.stopPropagation(), !wasDrag() && onFenceClick(f.id)) : undefined,
            style: { cursor: onFenceClick ? "pointer" : undefined, pointerEvents: onFenceClick ? ("auto" as const) : ("none" as const) },
          };
          if (f.kind === "circle" && f.points[0]) {
            const c = proj.project(f.points[0]);
            return (
              <g key={f.id}>
                <circle cx={c.x} cy={c.y} r={(f.radius ?? 300) * proj.unitsPerMetre} fill={f.color} fillOpacity={selected ? 0.2 : 0.11} {...common} />
                {f.label ? <FenceLabel x={c.x} y={c.y} upx={upx} label={f.label} /> : null}
              </g>
            );
          }
          if (f.kind === "polygon" && f.points.length > 1) {
            const c = proj.project(f.points[0]);
            return (
              <g key={f.id}>
                <path d={proj.pathFrom(f.points, f.points.length > 2)} fill={f.color} fillOpacity={selected ? 0.2 : 0.11} strokeLinejoin="round" {...common} />
                {f.label ? <FenceLabel x={c.x} y={c.y} upx={upx} label={f.label} /> : null}
              </g>
            );
          }
          if (f.points.length > 0) {
            const c = proj.project(f.points[0]);
            return (
              <g key={f.id}>
                <path d={proj.pathFrom(f.points)} fill="none" strokeLinecap="round" strokeLinejoin="round" {...common} strokeWidth={(selected ? 7 : 5) * upx} strokeOpacity={0.55} />
                {f.label ? <FenceLabel x={c.x} y={c.y} upx={upx} label={f.label} /> : null}
              </g>
            );
          }
          return null;
        })}
        {fences
          .filter((f) => f.draft)
          .flatMap((f) => f.points.map((p, i) => ({ p, i, f })))
          .map(({ p, i, f }) => {
            const c = proj.project(p);
            return <circle key={`${f.id}-v${i}`} cx={c.x} cy={c.y} r={4 * upx} fill="white" stroke={f.color} strokeWidth={2 * upx} style={{ pointerEvents: "none" }} />;
          })}

        {/* Routes */}
        {routes.map((r) => {
          const color = r.color ?? "var(--dv-ink)";
          const cut = r.progress !== undefined ? Math.max(1, Math.round(r.progress * (r.points.length - 1))) : r.points.length - 1;
          const played = r.points.slice(0, cut + 1);
          return (
            <g key={r.id} style={{ pointerEvents: "none" }} opacity={r.dim ? 0.35 : 1}>
              <path d={proj.pathFrom(r.points)} fill="none" stroke="white" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              <path d={proj.pathFrom(r.points)} fill="none" stroke={color} strokeOpacity={r.progress !== undefined ? 0.3 : 0.9} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {r.progress !== undefined ? (
                <path d={proj.pathFrom(played)} fill="none" stroke={color} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              ) : null}
            </g>
          );
        })}

        {/* Pins: start / end / stops / alarms */}
        {pins.map((p) => {
          const c = proj.project(p);
          const active = p.id === activePinId;
          const r = (active ? 11 : 9) * upx;
          const fill = p.kind === "start" ? "var(--dv-success)" : p.kind === "end" ? "var(--dv-ink)" : p.kind === "stop" ? "var(--dv-info)" : "var(--dv-danger)";
          return (
            <g
              key={p.id}
              transform={`translate(${c.x} ${c.y})`}
              onClick={onPinClick ? (e) => (e.stopPropagation(), !wasDrag() && onPinClick(p.id)) : undefined}
              onKeyDown={onPinClick ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPinClick(p.id)) : undefined}
              tabIndex={onPinClick ? 0 : undefined}
              role={onPinClick ? "button" : undefined}
              aria-label={p.title}
              style={{ cursor: onPinClick ? "pointer" : undefined, outline: "none" }}
              className="group/pin"
            >
              <title>{p.title}</title>
              {active ? <circle r={r + 5 * upx} fill={fill} fillOpacity={0.18} /> : null}
              {p.kind === "alarm" ? (
                <path d={`M0 ${-r * 1.15} L${r} ${r * 0.75} L${-r} ${r * 0.75} Z`} fill={fill} stroke="white" strokeWidth={2 * upx} strokeLinejoin="round" />
              ) : (
                <circle r={r} fill={fill} stroke="white" strokeWidth={2 * upx} />
              )}
              <text y={p.kind === "alarm" ? r * 0.45 : r * 0.36} textAnchor="middle" fontSize={r * (p.kind === "alarm" ? 1 : 1.05)} fontWeight={700} fill="white">
                {p.glyph ?? (p.kind === "start" ? "A" : p.kind === "end" ? "B" : p.kind === "stop" ? "P" : "!")}
              </text>
            </g>
          );
        })}

        {/* Vehicle markers & clusters */}
        {groups.map((g) => {
          if (g.members.length > 1) {
            const avg = { lat: g.members.reduce((s, m) => s + m.lat, 0) / g.members.length, lon: g.members.reduce((s, m) => s + m.lon, 0) / g.members.length };
            const c = proj.project(avg);
            const r = (14 + Math.min(10, g.members.length)) * upx;
            const alarming = g.members.some((m) => m.alarm);
            return (
              <g
                key={`cluster-${g.id}`}
                transform={`translate(${c.x} ${c.y})`}
                role="button"
                tabIndex={0}
                aria-label={`${g.members.length} vehicles — zoom in`}
                style={{ cursor: "pointer", outline: "none" }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (wasDrag()) return;
                  setView((v) => ({ cx: c.x, cy: c.y, zoom: clamp(Math.max(v.zoom * 2.2, 3.4)) }));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setView((v) => ({ cx: c.x, cy: c.y, zoom: clamp(Math.max(v.zoom * 2.2, 3.4)) }));
                  }
                }}
              >
                <circle r={r + 4 * upx} fill="var(--dv-ink)" fillOpacity={0.12} />
                <circle r={r} fill="var(--dv-ink)" stroke={alarming ? "var(--dv-danger)" : "white"} strokeWidth={2.5 * upx} />
                <text y={4 * upx} textAnchor="middle" fontSize={12 * upx} fontWeight={700} fill="white">
                  {g.members.length}
                </text>
              </g>
            );
          }
          const m = g.members[0];
          const c = proj.project(m);
          const selected = m.id === selectedId;
          const hovered = m.id === hoverId;
          const color = m.color ?? (m.state ? VEHICLE_STATE_META[m.state].color : "var(--dv-ink-subtle)");
          const status = m.statusLabel ?? (m.state ? VEHICLE_STATE_META[m.state].label : "");
          const r = (selected ? 10 : 7.5) * upx;
          return (
            <g
              key={m.id}
              transform={`translate(${c.x} ${c.y})`}
              role={onMarkerClick ? "button" : undefined}
              tabIndex={onMarkerClick ? 0 : undefined}
              aria-label={`${m.label}${status ? `, ${status}` : ""}${m.alarm ? ", active alarm" : ""}`}
              aria-pressed={onMarkerClick ? selected : undefined}
              style={{ cursor: onMarkerClick ? "pointer" : undefined, outline: "none" }}
              onClick={onMarkerClick ? (e) => (e.stopPropagation(), !wasDrag() && onMarkerClick(m.id)) : undefined}
              onKeyDown={onMarkerClick ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onMarkerClick(m.id)) : undefined}
              onPointerEnter={() => setHoverId(m.id)}
              onPointerLeave={() => setHoverId((h) => (h === m.id ? null : h))}
              onFocus={() => setHoverId(m.id)}
              onBlur={() => setHoverId((h) => (h === m.id ? null : h))}
            >
              {m.alarm ? <circle r={r + 7 * upx} fill="var(--dv-danger)" fillOpacity={0.16} stroke="var(--dv-danger)" strokeOpacity={0.5} strokeWidth={1.2 * upx} /> : null}
              {selected ? <circle r={r + 6 * upx} fill="var(--dv-ink)" fillOpacity={0.12} /> : null}
              {(m.state === "moving" || m.showHeading) && m.heading !== undefined ? (
                <path
                  d={`M0 ${-r - 7 * upx} L${4.5 * upx} ${-r - 1 * upx} L${-4.5 * upx} ${-r - 1 * upx} Z`}
                  fill={selected ? "var(--dv-ink)" : color}
                  transform={`rotate(${m.heading})`}
                />
              ) : null}
              <circle r={r} fill={color} stroke={selected ? "var(--dv-ink)" : "white"} strokeWidth={(selected ? 3 : 2.2) * upx} />
              {selected || hovered ? (
                <g transform={`translate(0 ${-(r + 14 * upx)})`} style={{ pointerEvents: "none" }}>
                  <rect x={-(m.label.length * 3.6 + 10) * upx} y={-11 * upx} width={(m.label.length * 7.2 + 20) * upx} height={20 * upx} rx={10 * upx} fill="var(--dv-ink)" />
                  <text y={3.5 * upx} textAnchor="middle" fontSize={11 * upx} fontWeight={600} fill="white">
                    {m.label}
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}
      </motion.svg>

      {/* Controls */}
      <div className={cn("absolute top-3 z-10 flex flex-col gap-1.5", controlsPosition === "left" ? "left-3" : "right-3")}>
        <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <MapButton label="Zoom in" onClick={() => zoomBy(1.4)}>
            <Plus className="size-4" />
          </MapButton>
          <span className="h-px bg-line" />
          <MapButton label="Zoom out" onClick={() => zoomBy(1 / 1.4)}>
            <Minus className="size-4" />
          </MapButton>
        </div>
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <MapButton
            label={fitPoints?.length ? "Fit to results" : "Reset view"}
            onClick={() => setView(fitPoints?.length ? fitView(fitPoints, size, proj, maxZoom) : defaultView(proj))}
          >
            <Locate className="size-4" />
          </MapButton>
        </div>
      </div>

      {children}

      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface/95 px-2 py-1 text-[10.5px] font-medium text-ink-muted shadow-card">
          <MapIcon className="size-3" aria-hidden /> {mapNote ?? (bounds ? "No base map · positions from API coordinates" : "Illustrative map · demo positions")}
        </span>
        {showLegend && legend && markers.length > 0 ? (
          <span className="hidden items-center gap-2.5 rounded-full border border-line bg-surface/95 px-2.5 py-1 text-[10.5px] text-ink-muted shadow-card sm:inline-flex">
            {legend.map((l) => (
              <span key={l.label} className="inline-flex items-center gap-1">
                <span className="size-2 rounded-full" style={{ background: l.color }} aria-hidden />
                {l.label}
              </span>
            ))}
          </span>
        ) : showLegend && markers.length > 0 ? (
          <span className="hidden items-center gap-2.5 rounded-full border border-line bg-surface/95 px-2.5 py-1 text-[10.5px] text-ink-muted shadow-card sm:inline-flex">
            {(["moving", "idle", "parked", "offline"] as const).map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <span className="size-2 rounded-full" style={{ background: VEHICLE_STATE_META[s].color }} aria-hidden />
                {VEHICLE_STATE_META[s].label}
              </span>
            ))}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const GRID_STEPS = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1];

/**
 * Labelled latitude/longitude grid for maps without a base map. The step adapts to zoom
 * (lines ≥ 90 px apart) and labels sit on the visible left / bottom edges.
 */
function MapGrid({ proj, upx, viewBox }: { proj: Projection; upx: number; viewBox: { x: number; y: number; w: number; h: number } }) {
  const tl = proj.unproject(viewBox.x, viewBox.y);
  const br = proj.unproject(viewBox.x + viewBox.w, viewBox.y + viewBox.h);
  const unitsPerDegree = 111_320 * proj.unitsPerMetre;
  const step = GRID_STEPS.find((s) => s * unitsPerDegree >= 90 * upx) ?? 1;
  const decimals = Math.max(2, Math.ceil(-Math.log10(step)));
  const lines: React.ReactNode[] = [];
  for (let i = Math.ceil(br.lat / step); i * step <= tl.lat; i++) {
    const lat = i * step;
    const { y } = proj.project({ lat, lon: tl.lon });
    lines.push(<line key={`la${i}`} x1={viewBox.x} x2={viewBox.x + viewBox.w} y1={y} y2={y} stroke="var(--dv-border)" strokeWidth={upx} />);
    lines.push(
      <text key={`lt${i}`} x={viewBox.x + 4 * upx} y={y - 3 * upx} fontSize={10 * upx} fill="var(--dv-ink-subtle)">
        {lat.toFixed(decimals)}°
      </text>
    );
  }
  for (let i = Math.ceil(tl.lon / step); i * step <= br.lon; i++) {
    const lon = i * step;
    const { x } = proj.project({ lat: tl.lat, lon });
    lines.push(<line key={`lo${i}`} y1={viewBox.y} y2={viewBox.y + viewBox.h} x1={x} x2={x} stroke="var(--dv-border)" strokeWidth={upx} />);
    lines.push(
      <text key={`lot${i}`} x={x + 3 * upx} y={viewBox.y + viewBox.h - 34 * upx} fontSize={10 * upx} fill="var(--dv-ink-subtle)">
        {lon.toFixed(decimals)}°
      </text>
    );
  }
  return (
    <g style={{ pointerEvents: "none" }} aria-hidden>
      <rect x={0} y={0} width={proj.width} height={proj.height} fill="var(--dv-surface)" opacity={0.5} />
      {lines}
    </g>
  );
}

function FenceLabel({ x, y, upx, label }: { x: number; y: number; upx: number; label: string }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fontSize={11 * upx}
      fontWeight={600}
      fill="var(--dv-ink)"
      stroke="white"
      strokeWidth={3 * upx}
      paintOrder="stroke"
      style={{ pointerEvents: "none" }}
    >
      {label}
    </text>
  );
}

export function MapButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={onClick} className="grid size-9 place-items-center text-ink transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none" aria-label={label}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
