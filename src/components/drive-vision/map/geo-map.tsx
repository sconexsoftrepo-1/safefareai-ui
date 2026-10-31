"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useReducedMotion } from "motion/react";
import { Locate, Map as MapIcon, Minus, Plus } from "lucide-react";
import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import type { LatLon } from "@/features/drive-vision/types";
import { cn } from "@/lib/utils";
import { attributionBottom, baseMapSource, loadMapLibre } from "./base-map-config";
import { FleetMap, MapButton, type MapMarker, type MapPin, type MapRoute } from "./fleet-map";
import type { GeoBounds } from "./projection";

/**
 * Real geographic map for API coordinates: MapLibre GL with a MapTiler (or custom) style.
 * Same marker/route/pin props as FleetMap's coordinate mode, which it falls back to when no
 * key is configured, WebGL2 is missing, or the provider rejects the style or tiles.
 */

type Runtime = Awaited<ReturnType<typeof loadMapLibre>>;

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
  /** Extent for the coordinate-grid fallback. */
  bounds: GeoBounds | null;
  /** Caption describing the plotted data, e.g. "Positions from API coordinates". */
  dataNote: string;
}

const LOAD_TIMEOUT_MS = 15_000;
const FIT_MAX_ZOOM = 16;
const FOCUS_ZOOM = 14;
const CLUSTER_BELOW_ZOOM = 12;
const CLUSTER_PX = 30;

const source = baseMapSource();

export function GeoMap(props: GeoMapProps) {
  const [failure, setFailure] = useState<string | null>(source.kind === "none" ? "Base map off — no map key configured" : null);

  if (source.kind === "none" || failure) {
    const { dataNote, bounds, ...rest } = props;
    return <FleetMap {...rest} bounds={bounds} maxZoom={60} mapNote={`${failure ?? "Base map unavailable"} · coordinate grid · ${dataNote}`} />;
  }
  return <GeoCanvas {...props} styleUrl={source.styleUrl} provider={source.kind} onFail={setFailure} />;
}

function failureMessage(status: number | undefined, loaded: boolean) {
  if (status === 401 || status === 403) return "Base map unavailable — the provider rejected the map key (check the key and its allowed origins)";
  if (status === 429) return "Base map unavailable — map quota exceeded";
  return loaded ? "Base map unavailable — map tiles failed to load" : "Base map unavailable — the map style could not be loaded";
}

function cssColor(el: HTMLElement | null, value: string) {
  const m = /^var\((--[\w-]+)\)$/.exec(value.trim());
  if (!m || !el) return value;
  return getComputedStyle(el).getPropertyValue(m[1]).trim() || "#334155";
}

function GeoCanvas({
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
  styleUrl,
  provider,
  onFail,
}: GeoMapProps & { styleUrl: string; provider: "maptiler" | "custom"; onFail: (reason: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const [map, setMap] = useState<{ map: MapLibreMap; ml: Runtime } | null>(null);
  const [viewTick, setViewTick] = useState(0);
  const onFailRef = useRef(onFail);
  useEffect(() => {
    onFailRef.current = onFail;
  });

  // Create the map once; MapLibre owns the canvas from here on.
  useEffect(() => {
    let cancelled = false;
    let instance: MapLibreMap | null = null;
    let loaded = false;
    const fail = (reason: string) => {
      if (cancelled) return;
      cancelled = true;
      instance?.remove();
      onFailRef.current(reason);
    };
    const timer = setTimeout(() => !loaded && fail("Base map unavailable — the map took too long to load"), LOAD_TIMEOUT_MS);

    loadMapLibre()
      .then((ml) => {
        if (cancelled || !canvasRef.current) return;
        try {
          instance = new ml.Map({
            container: canvasRef.current,
            style: styleUrl,
            center: [78.9, 20.6],
            zoom: 3,
            maxZoom: 19,
            // Full attribution, always: compact mode collapses it to an "i" button on the first drag.
            attributionControl: { compact: false },
            dragRotate: false,
            pitchWithRotate: false,
            touchPitch: false,
          });
        } catch (err) {
          fail(err instanceof Error && err.name === "GPUInitializationError" ? "Base map unavailable — this browser has no WebGL2" : "Base map unavailable — the map could not start");
          return;
        }
        const m = instance;
        // Keep the provider attribution clear of the caption/legend row at the bottom (one-line default until
        // the row is measured; see the caption effect below).
        const attribution = m.getContainer().querySelector<HTMLElement>(".maplibregl-ctrl-bottom-right");
        if (attribution) attribution.style.bottom = `${attributionBottom(22)}px`;
        m.touchZoomRotate.disableRotation();
        m.keyboard.disableRotation();
        // Errors carry request URLs (with the key) — never log them.
        m.on("error", (e) => {
          const status = (e.error as { status?: number } | undefined)?.status;
          if (!loaded || status === 401 || status === 403 || status === 429) fail(failureMessage(status, loaded));
        });
        m.on("load", () => {
          loaded = true;
          clearTimeout(timer);
          if (process.env.NODE_ENV !== "production") (canvasRef.current as unknown as { __dvMap?: MapLibreMap } | null)!.__dvMap = m;
          setMap({ map: m, ml });
        });
        m.on("moveend", () => setViewTick((t) => t + 1));
      })
      .catch(() => fail("Base map unavailable — the map library failed to load"));

    return () => {
      cancelled = true;
      clearTimeout(timer);
      instance?.remove();
    };
  }, [styleUrl]);

  const padding = useCallback(
    (extraRight: number) => {
      const w = containerRef.current?.clientWidth ?? 800;
      const base = Math.min(70, w / 6);
      return { top: base, bottom: base, left: base, right: base + (w > 640 ? extraRight : 0) };
    },
    []
  );

  const fit = useCallback(() => {
    if (!map) return;
    const pts = fitPoints ?? [];
    if (pts.length === 0) return;
    const lons = pts.map((p) => p.lon);
    const lats = pts.map((p) => p.lat);
    map.map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: padding(focus ? focusPadRight : 0), maxZoom: FIT_MAX_ZOOM, duration: reduceMotion ? 0 : 450 }
    );
  }, [map, fitPoints, padding, focus, focusPadRight, reduceMotion]);

  // Re-fit when the caller's fit key changes (and once when the map is ready). An active focus wins.
  const fitSignature = map ? `${fitKey ?? ""}` : null;
  const lastFit = useRef<string | null>(null);
  const focusSignature = focus ? `${focus.lat.toFixed(5)},${focus.lon.toFixed(5)},${focus.zoom ?? ""}` : null;
  const lastFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!map) return;
    if (fitSignature !== lastFit.current) {
      lastFit.current = fitSignature;
      if (!focus) fit();
    }
    if (focusSignature !== lastFocus.current) {
      lastFocus.current = focusSignature;
      if (focus) {
        map.map.easeTo({
          center: [focus.lon, focus.lat],
          zoom: focus.zoom ?? Math.max(map.map.getZoom(), FOCUS_ZOOM),
          padding: padding(focusPadRight),
          duration: reduceMotion ? 0 : 450,
        });
      }
    }
  }, [map, fitSignature, focusSignature, focus, fit, padding, focusPadRight, reduceMotion]);

  // Keep the attribution above the caption row at its real height: on narrow maps the row wraps to two
  // lines, and a fixed offset let the MapTiler logo cover the OpenStreetMap credit.
  useEffect(() => {
    const caption = captionRef.current;
    const attribution = map?.map.getContainer().querySelector<HTMLElement>(".maplibregl-ctrl-bottom-right");
    if (!caption || !attribution) return;
    const place = () => {
      attribution.style.bottom = `${attributionBottom(caption.offsetHeight)}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(caption);
    return () => observer.disconnect();
  }, [map]);

  // Routes as GeoJSON line layers: a white casing, the full path, and the played part on top.
  useEffect(() => {
    if (!map) return;
    const el = containerRef.current;
    const features = routes.flatMap((r) => {
      const color = cssColor(el, r.color ?? "var(--dv-ink)");
      const coords = r.points.map((p) => [p.lon, p.lat]);
      const cut = r.progress !== undefined ? Math.max(1, Math.round(r.progress * (r.points.length - 1))) : r.points.length - 1;
      const base = { type: "Feature" as const, properties: { color, dim: r.dim ? 1 : 0 } };
      const out = [{ ...base, properties: { ...base.properties, part: r.progress !== undefined ? "rest" : "full" }, geometry: { type: "LineString" as const, coordinates: coords } }];
      if (r.progress !== undefined) out.push({ ...base, properties: { ...base.properties, part: "played" }, geometry: { type: "LineString" as const, coordinates: coords.slice(0, cut + 1) } });
      return out;
    });
    const data = { type: "FeatureCollection" as const, features };
    const m = map.map;
    const existing = m.getSource("dv-routes") as GeoJSONSource | undefined;
    if (existing) {
      existing.setData(data);
      return;
    }
    m.addSource("dv-routes", { type: "geojson", data });
    m.addLayer({
      id: "dv-routes-casing",
      type: "line",
      source: "dv-routes",
      filter: ["!=", ["get", "part"], "played"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": ["case", ["==", ["get", "dim"], 1], 0.35, 1] },
    });
    m.addLayer({
      id: "dv-routes-line",
      type: "line",
      source: "dv-routes",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["get", "color"], "line-width": 3.5, "line-opacity": ["*", ["match", ["get", "part"], "rest", 0.3, "full", 0.9, 1], ["case", ["==", ["get", "dim"], 1], 0.35, 1]] },
    });
  }, [map, routes]);

  // Screen-space clustering, recomputed after each move (workbook: "Map clustering — client side").
  const groups = useMemo(() => {
    void viewTick;
    if (!cluster || !map || map.map.getZoom() >= CLUSTER_BELOW_ZOOM) return markers.map((m) => ({ id: m.id, members: [m] }));
    const out: { id: string; members: MapMarker[]; x: number; y: number }[] = [];
    for (const m of markers) {
      const p = map.map.project([m.lon, m.lat]);
      if (m.id === selectedId) {
        out.push({ id: m.id, members: [m], x: p.x, y: p.y });
        continue;
      }
      const hit = out.find((g) => g.members[0].id !== selectedId && Math.hypot(g.x - p.x, g.y - p.y) < CLUSTER_PX);
      if (hit) hit.members.push(m);
      else out.push({ id: m.id, members: [m], x: p.x, y: p.y });
    }
    return out;
  }, [cluster, map, markers, selectedId, viewTick]);

  return (
    <div ref={containerRef} className={cn("relative isolate h-full min-h-[320px] w-full overflow-hidden rounded-[18px] bg-[var(--dv-map-land)]", className)} role="region" aria-label={ariaLabel}>
      {/* Inline style: maplibre-gl.css sets `.maplibregl-map { position: relative }`, which (unlayered) beats Tailwind's layered `absolute inset-0` and collapses the map to 0 px height. */}
      <div ref={canvasRef} style={{ position: "absolute", inset: 0 }} />

      {map
        ? pins.map((p) => (
            <HtmlMarker key={p.id} rt={map} lat={p.lat} lon={p.lon} z={p.id === activePinId ? 2 : 1}>
              <PinGlyph pin={p} active={p.id === activePinId} onClick={onPinClick} />
            </HtmlMarker>
          ))
        : null}
      {map
        ? groups.map((g) =>
            g.members.length > 1 ? (
              <HtmlMarker key={`cluster-${g.id}`} rt={map} lat={avg(g.members, "lat")} lon={avg(g.members, "lon")} z={3}>
                <button
                  type="button"
                  aria-label={`${g.members.length} vehicles — zoom in`}
                  className="grid place-items-center rounded-full border-[2.5px] bg-[var(--dv-ink)] text-[12px] font-bold text-white shadow-[0_0_0_4px_rgb(15_23_42/0.12)]"
                  style={{ width: 28 + Math.min(10, g.members.length) * 2, height: 28 + Math.min(10, g.members.length) * 2, borderColor: g.members.some((m) => m.alarm) ? "var(--dv-danger)" : "white" }}
                  onClick={() => map.map.easeTo({ center: [avg(g.members, "lon"), avg(g.members, "lat")], zoom: Math.max(map.map.getZoom() + 2, CLUSTER_BELOW_ZOOM), duration: reduceMotion ? 0 : 450 })}
                >
                  {g.members.length}
                </button>
              </HtmlMarker>
            ) : (
              <HtmlMarker key={g.id} rt={map} lat={g.members[0].lat} lon={g.members[0].lon} z={g.members[0].id === selectedId ? 5 : 4}>
                <MarkerGlyph marker={g.members[0]} selected={g.members[0].id === selectedId} onClick={onMarkerClick} />
              </HtmlMarker>
            )
          )
        : null}

      {/* Controls */}
      <div className={cn("absolute top-3 z-10 flex flex-col gap-1.5", controlsPosition === "left" ? "left-3" : "right-3")}>
        <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <MapButton label="Zoom in" onClick={() => map?.map.zoomIn({ duration: reduceMotion ? 0 : 250 })}>
            <Plus className="size-4" />
          </MapButton>
          <span className="h-px bg-line" />
          <MapButton label="Zoom out" onClick={() => map?.map.zoomOut({ duration: reduceMotion ? 0 : 250 })}>
            <Minus className="size-4" />
          </MapButton>
        </div>
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <MapButton label="Fit to results" onClick={fit}>
            <Locate className="size-4" />
          </MapButton>
        </div>
      </div>

      {children}

      <div ref={captionRef} className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1.5">
        {provider === "maptiler" ? (
          <a href="https://www.maptiler.com/" target="_blank" rel="noopener noreferrer" className="pointer-events-auto rounded-full border border-line bg-surface/95 px-2 py-1 text-[10.5px] font-semibold text-ink shadow-card">
            MapTiler
          </a>
        ) : null}
        <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface/95 px-2 py-1 text-[10.5px] font-medium text-ink-muted shadow-card">
          <MapIcon className="size-3" aria-hidden /> {map ? dataNote : "Loading base map…"}
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
      </div>
    </div>
  );
}

const avg = (ms: MapMarker[], k: "lat" | "lon") => ms.reduce((s, m) => s + m[k], 0) / ms.length;

/** Renders React content into a MapLibre HTML marker anchored at its centre. */
function HtmlMarker({ rt, lat, lon, z, children }: { rt: { map: MapLibreMap; ml: Runtime }; lat: number; lon: number; z: number; children: React.ReactNode }) {
  const [el] = useState(() => document.createElement("div"));
  const marker = useRef<MapLibreMarker | null>(null);
  useEffect(() => {
    const m = new rt.ml.Marker({ element: el, anchor: "center" }).setLngLat([lon, lat]).addTo(rt.map);
    marker.current = m;
    return () => {
      m.remove();
      marker.current = null;
    };
    // Position updates are handled below; the marker is created once per map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt, el]);
  useEffect(() => {
    marker.current?.setLngLat([lon, lat]);
  }, [lat, lon]);
  useEffect(() => {
    const node = marker.current?.getElement();
    if (node) node.style.zIndex = String(z);
  }, [z, rt]);
  return createPortal(children, el);
}

function MarkerGlyph({ marker: m, selected, onClick }: { marker: MapMarker; selected: boolean; onClick?: (id: string) => void }) {
  const [hovered, setHovered] = useState(false);
  const color = m.color ?? "var(--dv-ink-subtle)";
  const r = selected ? 10 : 7.5;
  const size = 44;
  const c = size / 2;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick: () => onClick(m.id), "aria-pressed": selected } : {})}
      aria-label={`${m.label}${m.statusLabel ? `, ${m.statusLabel}` : ""}${m.alarm ? ", active alarm" : ""}`}
      data-marker-id={m.id}
      className="relative block outline-none focus-visible:rounded-full focus-visible:ring-2 focus-visible:ring-[var(--dv-ink)]"
      style={{ width: size, height: size, cursor: onClick ? "pointer" : undefined }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="overflow-visible">
        <g transform={`translate(${c} ${c})`}>
          {m.alarm ? <circle r={r + 7} fill="var(--dv-danger)" fillOpacity={0.16} stroke="var(--dv-danger)" strokeOpacity={0.5} strokeWidth={1.2} /> : null}
          {selected ? <circle r={r + 6} fill="var(--dv-ink)" fillOpacity={0.14} /> : null}
          {m.showHeading && m.heading !== undefined ? <path d={`M0 ${-r - 7} L4.5 ${-r - 1} L-4.5 ${-r - 1} Z`} fill={selected ? "var(--dv-ink)" : color} transform={`rotate(${m.heading})`} /> : null}
          <circle r={r} fill={color} stroke={selected ? "var(--dv-ink)" : "white"} strokeWidth={selected ? 3 : 2.2} />
        </g>
      </svg>
      {selected || hovered ? (
        <span className="pointer-events-none absolute bottom-[calc(100%-6px)] left-1/2 -translate-x-1/2 rounded-full bg-[var(--dv-ink)] px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white">{m.label}</span>
      ) : null}
    </Tag>
  );
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
