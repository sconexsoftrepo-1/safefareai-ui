"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useReducedMotion } from "motion/react";
import { Locate, Map as MapIcon, MapPinOff, RotateCw } from "lucide-react";
import type { LatLon } from "@/features/drive-vision/types";
import { cn } from "@/lib/utils";
import { DEFAULT_MAP_TYPE, googleMapsConfig, MAP_TYPES, type MapTypeId } from "./google-maps-config";
import { googleMapsAuthFailed, loadGoogleMaps, onGoogleMapsAuthFailure } from "./google-maps-loader";
import type { CoreLibrary, GoogleMap, LatLngLiteral, MapsEventListener, MapsLibrary, OverlayViewBase, Polyline, PolylineOptions } from "./google-maps-types";
import type { MapMarker, MapPin, MapRoute } from "./map-types";
import { VehicleMarkerGlyph } from "./vehicle-marker";

/**
 * Geographic map for API coordinates, rendered with the Google Maps JavaScript API.
 *
 * Google Maps loads only when NEXT_PUBLIC_GOOGLE_MAPS_ENABLED is "true" and NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is set
 * (see google-maps-config.ts). Otherwise a placeholder is shown and no map request is made; children (e.g. Live
 * Monitoring's vehicle panel) still render, so the rest of the screen keeps working.
 *
 * The map is created once per mount. Roadmap / Satellite / Hybrid switch with setMapTypeId, which keeps the centre,
 * zoom, markers, polylines and selection. Markers are HTML overlays (no Map ID needed) moved in place as new
 * positions arrive; routes are Polylines updated in place.
 */

export interface GeoMapProps {
  markers?: MapMarker[];
  selectedId?: string | null;
  onMarkerClick?: (id: string) => void;
  routes?: MapRoute[];
  pins?: MapPin[];
  activePinId?: string | null;
  onPinClick?: (id: string) => void;
  focus?: (LatLon & { zoom?: number }) | null;
  fitPoints?: LatLon[];
  fitKey?: string | number;
  cluster?: boolean;
  className?: string;
  ariaLabel: string;
  children?: React.ReactNode;
  showLegend?: boolean;
  legend?: { label: string; color: string }[];
  controlsPosition?: "left" | "right";
  focusPadRight?: number;
  /** Caption describing the plotted data, e.g. "Positions from API coordinates". */
  dataNote: string;
}

const LOAD_TIMEOUT_MS = 15_000;
const FIT_MAX_ZOOM = 16;
const FOCUS_ZOOM = 14;
const CLUSTER_BELOW_ZOOM = 12;
const CLUSTER_PX = 30;
const INITIAL_VIEW = { center: { lat: 20.6, lng: 78.9 }, zoom: 4 };

const CONTAINER = "relative isolate h-full min-h-[320px] w-full overflow-hidden rounded-[18px] bg-[var(--dv-map-land)]";

export const MAP_DISABLED_TITLE = "Google Maps is currently disabled.";
export const MAP_DISABLED_TEXT = "Enable Google Maps configuration to view the interactive map.";

export function GeoMap(props: GeoMapProps) {
  // Read once per mount: the values are inlined at build time.
  const [config] = useState(googleMapsConfig);
  if (!config.enabled) return <MapPlaceholder {...props} />;
  return <GoogleCanvas {...props} apiKey={config.apiKey} />;
}

/** Shown instead of the map when Google Maps is disabled or has no key. Makes no network request. */
function MapPlaceholder({ className, ariaLabel, children, dataNote }: GeoMapProps) {
  return (
    <div className={cn(CONTAINER, "bg-[#F4F7FB]", className)} role="region" aria-label={ariaLabel} data-map-state="disabled">
      <div className="absolute inset-0 grid place-items-center p-6 text-center">
        <div className="max-w-[300px]">
          <span className="mx-auto mb-2.5 grid size-11 place-items-center rounded-full bg-white text-[#243451] shadow-card">
            <MapPinOff className="size-5" aria-hidden />
          </span>
          <p className="text-[13.5px] font-semibold text-[#243451]">{MAP_DISABLED_TITLE}</p>
          <p className="mt-1 text-[12px] text-ink-muted">{MAP_DISABLED_TEXT}</p>
          <p className="mt-2 text-[11px] text-ink-subtle">{dataNote}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

type Runtime = { map: GoogleMap; maps: MapsLibrary; core: CoreLibrary; probe: OverlayViewBase };
type Status = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string; retry: boolean };

function cssColor(el: HTMLElement | null, value: string) {
  const m = /^var\((--[\w-]+)\)$/.exec(value.trim());
  if (!m || !el) return value;
  return getComputedStyle(el).getPropertyValue(m[1]).trim() || "#334155";
}

const toLatLng = (p: LatLon): LatLngLiteral => ({ lat: p.lat, lng: p.lon });

function GoogleCanvas({
  markers = [],
  selectedId,
  onMarkerClick,
  routes = [],
  pins = [],
  activePinId,
  onPinClick,
  focus,
  fitPoints,
  fitKey,
  cluster = false,
  className,
  ariaLabel,
  children,
  showLegend = true,
  legend,
  controlsPosition = "right",
  focusPadRight = 0,
  dataNote,
  apiKey,
}: GeoMapProps & { apiKey: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const [rt, setRt] = useState<Runtime | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [mapType, setMapType] = useState<MapTypeId>(DEFAULT_MAP_TYPE);
  const [viewTick, setViewTick] = useState(0);
  // Google-positioned control hosts; React renders into them through portals.
  const [hosts] = useState(() => ({ top: document.createElement("div"), side: document.createElement("div"), caption: document.createElement("div") }));
  const mapTypeRef = useRef(mapType);
  const sideRef = useRef(controlsPosition);
  useEffect(() => {
    mapTypeRef.current = mapType;
    sideRef.current = controlsPosition;
  });

  // Create the map once per mount (and again only on an explicit retry).
  useEffect(() => {
    let cancelled = false;
    let created: Runtime | null = null;
    const canvas = canvasRef.current;
    const listeners: MapsEventListener[] = [];
    const fail = (message: string, retry = true) => {
      if (cancelled) return;
      cancelled = true;
      setRt(null);
      setStatus({ kind: "error", message, retry });
    };
    const timer = setTimeout(() => fail("Google Maps took too long to load."), LOAD_TIMEOUT_MS);
    const authMessage = "Google Maps rejected the API key. Check the key, its allowed referrers and billing.";
    const unsubscribe = onGoogleMapsAuthFailure(() => fail(authMessage, false));

    loadGoogleMaps(apiKey)
      .then(({ maps, core }) => {
        if (cancelled || !canvas) return;
        clearTimeout(timer);
        if (googleMapsAuthFailed()) return fail(authMessage, false);
        const P = core.ControlPosition;
        const left = sideRef.current === "left";
        let map: GoogleMap;
        try {
          map = new maps.Map(canvas, {
            ...INITIAL_VIEW,
            mapTypeId: mapTypeRef.current,
            maxZoom: 20,
            disableDefaultUI: true,
            zoomControl: true,
            zoomControlOptions: { position: left ? P.LEFT_TOP : P.RIGHT_TOP },
            fullscreenControl: true,
            fullscreenControlOptions: { position: left ? P.TOP_LEFT : P.TOP_RIGHT },
            mapTypeControl: false, // replaced by the Roadmap / Satellite / Hybrid selector below
            streetViewControl: false,
            rotateControl: false,
            cameraControl: false,
            clickableIcons: false,
            gestureHandling: "greedy",
            tilt: 0,
            headingInteractionEnabled: false,
            tiltInteractionEnabled: false,
            backgroundColor: "#F4F7FB",
          });
        } catch {
          return fail("Google Maps could not start in this browser.");
        }
        map.controls[left ? P.TOP_LEFT : P.TOP_RIGHT].push(hosts.top);
        map.controls[left ? P.LEFT_TOP : P.RIGHT_TOP].push(hosts.side);
        // Next to the Google logo, never on top of it.
        map.controls[P.BOTTOM_LEFT].push(hosts.caption);
        // A bare overlay that gives access to the map projection (clustering).
        const Probe = class extends maps.OverlayView {
          draw() {}
        };
        const probe = new Probe();
        probe.setMap(map);
        listeners.push(core.event.addListener(map, "idle", () => setViewTick((t) => t + 1)));
        created = { map, maps, core, probe };
        setRt(created);
        setStatus({ kind: "ready" });
      })
      .catch(() => fail("Google Maps could not be loaded. Check the connection and try again."));

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
      listeners.forEach((l) => l.remove());
      if (created) {
        created.probe.setMap(null);
        for (const arr of created.map.controls) {
          if (!arr) continue;
          for (let i = arr.getArray().length - 1; i >= 0; i--) if (Object.values(hosts).includes(arr.getArray()[i] as HTMLDivElement)) arr.removeAt(i);
        }
      }
      canvas?.replaceChildren();
    };
  }, [apiKey, attempt, hosts]);

  // Switching view never recreates the map: overlays, centre and zoom are kept by Google.
  useEffect(() => {
    if (rt && rt.map.getMapTypeId() !== mapType) rt.map.setMapTypeId(mapType);
  }, [rt, mapType]);

  const padding = useCallback((extraRight: number) => {
    const w = containerRef.current?.clientWidth ?? 800;
    const base = Math.min(70, w / 6);
    return { top: base, bottom: base, left: base, right: base + (w > 640 ? extraRight : 0) };
  }, []);

  const fit = useCallback(() => {
    if (!rt) return;
    const pts = fitPoints ?? [];
    if (pts.length === 0) return;
    const bounds = new rt.core.LatLngBounds();
    for (const p of pts) bounds.extend(toLatLng(p));
    rt.map.fitBounds(bounds, padding(focus ? focusPadRight : 0));
    rt.core.event.addListenerOnce(rt.map, "idle", () => {
      if ((rt.map.getZoom() ?? 0) > FIT_MAX_ZOOM) rt.map.setZoom(FIT_MAX_ZOOM);
    });
  }, [rt, fitPoints, padding, focus, focusPadRight]);

  // Re-fit when the caller's fit key changes (and once when the map is ready). An active focus wins.
  const fitSignature = rt ? `${fitKey ?? ""}` : null;
  const lastFit = useRef<string | null>(null);
  const focusSignature = focus ? `${focus.lat.toFixed(5)},${focus.lon.toFixed(5)},${focus.zoom ?? ""}` : null;
  const lastFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!rt) {
      lastFit.current = null;
      lastFocus.current = null;
      return;
    }
    if (fitSignature !== lastFit.current) {
      lastFit.current = fitSignature;
      if (!focus) fit();
    }
    if (focusSignature !== lastFocus.current) {
      lastFocus.current = focusSignature;
      if (focus) {
        const center = toLatLng(focus);
        const zoom = focus.zoom ?? Math.max(rt.map.getZoom() ?? 0, FOCUS_ZOOM);
        if (reduceMotion || zoom !== rt.map.getZoom()) rt.map.moveCamera({ center, zoom });
        else rt.map.panTo(center);
        // Keep the vehicle clear of a side panel: centre it in the unobstructed part of the map.
        const pad = padding(focusPadRight);
        const dx = (pad.right - pad.left) / 2;
        if (dx) rt.core.event.addListenerOnce(rt.map, "idle", () => rt.map.panBy(dx, 0));
      }
    }
  }, [rt, fitSignature, focusSignature, focus, fit, padding, focusPadRight, reduceMotion]);

  // Routes as Polylines: a white casing, the full path, and the played part on top. Updated in place.
  const lines = useRef(new Map<string, Polyline>());
  useEffect(() => {
    if (!rt) return;
    const el = containerRef.current;
    const want = new Map<string, PolylineOptions>();
    for (const r of routes) {
      const color = cssColor(el, r.color ?? "var(--dv-ink)");
      const path = r.points.map(toLatLng);
      const dim = r.dim ? 0.35 : 1;
      const played = r.progress !== undefined;
      want.set(`${r.id}:casing`, { path, strokeColor: "#ffffff", strokeWeight: 7, strokeOpacity: dim, zIndex: 1 });
      want.set(`${r.id}:line`, { path, strokeColor: color, strokeWeight: 3.5, strokeOpacity: (played ? 0.3 : 0.9) * dim, zIndex: 2 });
      if (played) {
        const cut = Math.max(1, Math.round(r.progress! * (r.points.length - 1)));
        want.set(`${r.id}:played`, { path: path.slice(0, cut + 1), strokeColor: color, strokeWeight: 3.5, strokeOpacity: dim, zIndex: 3 });
      }
    }
    for (const [key, line] of lines.current) {
      if (!want.has(key)) {
        line.setMap(null);
        lines.current.delete(key);
      }
    }
    for (const [key, opts] of want) {
      const existing = lines.current.get(key);
      if (existing) existing.setOptions(opts);
      else lines.current.set(key, new rt.maps.Polyline({ ...opts, clickable: false, map: rt.map }));
    }
  }, [rt, routes]);
  useEffect(() => {
    const current = lines.current;
    return () => {
      current.forEach((l) => l.setMap(null));
      current.clear();
    };
  }, [rt]);

  // Screen-space clustering, recomputed after each move (workbook: "Map clustering — client side").
  const groups = useMemo(() => {
    void viewTick;
    const projection = rt?.probe.getProjection();
    if (!cluster || !rt || !projection || (rt.map.getZoom() ?? 0) >= CLUSTER_BELOW_ZOOM) return markers.map((m) => ({ id: m.id, members: [m] }));
    const out: { id: string; members: MapMarker[]; x: number; y: number }[] = [];
    for (const m of markers) {
      const p = projection.fromLatLngToDivPixel(toLatLng(m)) ?? { x: 0, y: 0 };
      if (m.id === selectedId) {
        out.push({ id: m.id, members: [m], x: p.x, y: p.y });
        continue;
      }
      const hit = out.find((g) => g.members[0].id !== selectedId && Math.hypot(g.x - p.x, g.y - p.y) < CLUSTER_PX);
      if (hit) hit.members.push(m);
      else out.push({ id: m.id, members: [m], x: p.x, y: p.y });
    }
    return out;
  }, [cluster, rt, markers, selectedId, viewTick]);

  const heading = rt?.map.getHeading() ?? 0;

  return (
    <div ref={containerRef} className={cn(CONTAINER, className)} role="region" aria-label={ariaLabel} data-map-state={status.kind} data-map-type={mapType}>
      <div ref={canvasRef} style={{ position: "absolute", inset: 0 }} />

      {rt
        ? pins.map((p) => (
            <HtmlMarker key={p.id} rt={rt} lat={p.lat} lon={p.lon} z={p.id === activePinId ? 2 : 1}>
              <PinGlyph pin={p} active={p.id === activePinId} onClick={onPinClick} />
            </HtmlMarker>
          ))
        : null}
      {rt
        ? groups.map((g) =>
            g.members.length > 1 ? (
              <HtmlMarker key={`cluster-${g.id}`} rt={rt} lat={avg(g.members, "lat")} lon={avg(g.members, "lon")} z={3}>
                <button
                  type="button"
                  aria-label={`${g.members.length} vehicles — zoom in`}
                  className="grid place-items-center rounded-full border-[2.5px] bg-[var(--dv-ink)] text-[12px] font-bold text-white shadow-[0_0_0_4px_rgb(15_23_42/0.12)]"
                  style={{ width: 28 + Math.min(10, g.members.length) * 2, height: 28 + Math.min(10, g.members.length) * 2, borderColor: g.members.some((m) => m.alarm) ? "var(--dv-danger)" : "white" }}
                  onClick={() => {
                    rt.map.setZoom(Math.max((rt.map.getZoom() ?? 0) + 2, CLUSTER_BELOW_ZOOM));
                    rt.map.panTo({ lat: avg(g.members, "lat"), lng: avg(g.members, "lon") });
                  }}
                >
                  {g.members.length}
                </button>
              </HtmlMarker>
            ) : (
              <HtmlMarker key={g.id} rt={rt} lat={g.members[0].lat} lon={g.members[0].lon} z={g.members[0].id === selectedId ? 5 : 4}>
                <VehicleMarkerGlyph marker={g.members[0]} selected={g.members[0].id === selectedId} onClick={onMarkerClick} mapBearing={heading} />
              </HtmlMarker>
            )
          )
        : null}

      {/* Controls placed by Google alongside its native zoom and fullscreen controls. */}
      {createPortal(<MapTypeSelector value={mapType} onChange={setMapType} />, hosts.top)}
      {createPortal(
        <button type="button" onClick={fit} aria-label="Fit to results" title="Fit to results" className="m-2.5 mt-0 grid size-10 place-items-center rounded-lg bg-white text-[#243451] shadow-[0_1px_4px_rgb(0_0_0/0.3)] hover:bg-[#F4F7FB] focus-visible:ring-2 focus-visible:ring-[#243451] focus-visible:outline-none">
          <Locate className="size-[18px]" />
        </button>,
        hosts.side
      )}
      {createPortal(
        <div className="pointer-events-none mb-1.5 flex max-w-[calc(100vw-120px)] flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface/95 px-2 py-1 text-[10.5px] font-medium text-ink-muted shadow-card">
            <MapIcon className="size-3" aria-hidden /> {dataNote}
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
          ) : null}
        </div>,
        hosts.caption
      )}

      {status.kind === "loading" ? (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-[#F4F7FB]/70">
          <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-ink-muted shadow-card" role="status">
            Loading Google Maps…
          </span>
        </div>
      ) : null}
      {status.kind === "error" ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-[#F4F7FB] p-6 text-center" role="alert">
          <div className="max-w-[320px]">
            <p className="text-[13.5px] font-semibold text-[#243451]">Map unavailable</p>
            <p className="mt-1 text-[12px] text-ink-muted">{status.message}</p>
            {status.retry ? (
              <button type="button" onClick={() => {
                  setStatus({ kind: "loading" });
                  setAttempt((a) => a + 1);
                }} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#F56645] px-3.5 py-1.5 text-[12px] font-semibold text-white hover:brightness-95 focus-visible:ring-2 focus-visible:ring-[#243451] focus-visible:outline-none">
                <RotateCw className="size-3.5" aria-hidden /> Retry
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {children}
    </div>
  );
}

/** Roadmap / Satellite / Hybrid. A radio group so the active view is announced. */
export function MapTypeSelector({ value, onChange }: { value: MapTypeId; onChange: (id: MapTypeId) => void }) {
  return (
    <div role="radiogroup" aria-label="Map view" className="m-2.5 flex rounded-lg bg-white p-0.5 shadow-[0_1px_4px_rgb(0_0_0/0.3)]">
      {MAP_TYPES.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={active}
            data-map-type={t.id}
            onClick={() => onChange(t.id)}
            className={cn(
              "h-9 rounded-md px-2.5 text-[12px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-[#F56645] focus-visible:outline-none sm:px-3",
              active ? "bg-[#243451] text-white" : "text-[#243451] hover:bg-[#F4F7FB]"
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

const avg = (ms: MapMarker[], k: "lat" | "lon") => ms.reduce((s, m) => s + m[k], 0) / ms.length;

interface HtmlOverlay extends OverlayViewBase {
  setPosition(p: LatLngLiteral): void;
  setZIndex(z: number): void;
}

const overlayClasses = new WeakMap<MapsLibrary, new (el: HTMLElement, p: LatLngLiteral) => HtmlOverlay>();

/** An OverlayView that keeps a DOM element centred on a coordinate (no Map ID needed, unlike AdvancedMarkerElement). */
function htmlOverlayClass(maps: MapsLibrary) {
  let Cls = overlayClasses.get(maps);
  if (!Cls) {
    Cls = class extends maps.OverlayView implements HtmlOverlay {
      constructor(
        private readonly el: HTMLElement,
        private position: LatLngLiteral
      ) {
        super();
        el.style.position = "absolute";
        el.style.transform = "translate(-50%, -50%)";
      }
      onAdd() {
        this.getPanes()?.overlayMouseTarget.appendChild(this.el);
      }
      draw() {
        const p = this.getProjection()?.fromLatLngToDivPixel(this.position);
        if (!p) return;
        this.el.style.left = `${p.x}px`;
        this.el.style.top = `${p.y}px`;
      }
      onRemove() {
        this.el.remove();
      }
      setPosition(p: LatLngLiteral) {
        this.position = p;
        this.draw();
      }
      setZIndex(z: number) {
        this.el.style.zIndex = String(z);
      }
    };
    overlayClasses.set(maps, Cls);
  }
  return Cls;
}

/** Renders React content into a Google Maps HTML overlay anchored at its centre; moves it in place. */
function HtmlMarker({ rt, lat, lon, z, children }: { rt: Runtime; lat: number; lon: number; z: number; children: React.ReactNode }) {
  const [el] = useState(() => document.createElement("div"));
  const overlay = useRef<HtmlOverlay | null>(null);
  useEffect(() => {
    const Overlay = htmlOverlayClass(rt.maps);
    const o = new Overlay(el, { lat, lng: lon });
    o.setMap(rt.map);
    overlay.current = o;
    return () => {
      o.setMap(null);
      overlay.current = null;
    };
    // Position updates are handled below; the overlay is created once per map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt, el]);
  useEffect(() => {
    overlay.current?.setPosition({ lat, lng: lon });
  }, [lat, lon]);
  useEffect(() => {
    overlay.current?.setZIndex(z);
  }, [z, rt]);
  return createPortal(children, el);
}

function PinGlyph({ pin: p, active, onClick }: { pin: MapPin; active: boolean; onClick?: (id: string) => void }) {
  const fill = p.kind === "start" ? "var(--dv-success)" : p.kind === "end" ? "var(--dv-ink)" : p.kind === "stop" ? "var(--dv-info)" : "var(--dv-danger)";
  const r = active ? 11 : 9;
  const size = 36;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick: () => onClick(p.id) } : {})}
      aria-label={p.title}
      title={p.title}
      data-pin-id={p.id}
      className="block outline-none focus-visible:rounded-full focus-visible:ring-2 focus-visible:ring-[var(--dv-ink)]"
      style={{ width: size, height: size, cursor: onClick ? "pointer" : undefined }}
    >
      <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} aria-hidden>
        {active ? <circle r={r + 5} fill={fill} fillOpacity={0.18} /> : null}
        {p.kind === "alarm" ? <path d={`M0 ${-r * 1.15} L${r} ${r * 0.75} L${-r} ${r * 0.75} Z`} fill={fill} stroke="white" strokeWidth={2} strokeLinejoin="round" /> : <circle r={r} fill={fill} stroke="white" strokeWidth={2} />}
        <text y={p.kind === "alarm" ? r * 0.45 : r * 0.36} textAnchor="middle" fontSize={r * (p.kind === "alarm" ? 1 : 1.05)} fontWeight={700} fill="white">
          {p.glyph ?? (p.kind === "start" ? "A" : p.kind === "end" ? "B" : p.kind === "stop" ? "P" : "!")}
        </text>
      </svg>
    </Tag>
  );
}
