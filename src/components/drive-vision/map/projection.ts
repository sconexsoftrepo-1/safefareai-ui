import type { LatLon } from "@/features/drive-vision/types";
import { MAP_BOUNDS } from "@/features/drive-vision/mock-data/catalog";

export interface GeoBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface Projection {
  /** SVG map units; width is fixed, height follows the bounds' aspect. */
  width: number;
  height: number;
  unitsPerMetre: number;
  project: (p: LatLon) => { x: number; y: number };
  unproject: (x: number, y: number) => LatLon;
  pathFrom: (points: LatLon[], close?: boolean) => string;
}

/** Equirectangular projection of `bounds` into SVG map units. */
export function createProjection(bounds: GeoBounds): Projection {
  const width = 1000;
  const latSpan = bounds.maxLat - bounds.minLat;
  const lonSpan = bounds.maxLon - bounds.minLon;
  const cosLat = Math.cos((((bounds.maxLat + bounds.minLat) / 2) * Math.PI) / 180);
  const height = Math.round((width * latSpan) / (lonSpan * cosLat));
  const project = (p: LatLon) => ({ x: ((p.lon - bounds.minLon) / lonSpan) * width, y: ((bounds.maxLat - p.lat) / latSpan) * height });
  return {
    width,
    height,
    unitsPerMetre: height / (latSpan * 111_320),
    project,
    unproject: (x, y) => ({ lat: bounds.maxLat - (y / height) * latSpan, lon: bounds.minLon + (x / width) * lonSpan }),
    pathFrom(points, close = false) {
      if (points.length === 0) return "";
      const d = points
        .map((p, i) => {
          const { x, y } = project(p);
          return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join(" ");
      return close ? `${d} Z` : d;
    },
  };
}

/** Bounds snapped outward to a `cell`-degree grid with one cell of margin, so small movements between polls keep the same bounds (and view). */
export function snappedBounds(points: LatLon[], cell = 0.25): GeoBounds | null {
  if (points.length === 0) return null;
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  return {
    minLat: Math.floor(Math.min(...lats) / cell) * cell - cell,
    maxLat: Math.ceil(Math.max(...lats) / cell) * cell + cell,
    minLon: Math.floor(Math.min(...lons) / cell) * cell - cell,
    maxLon: Math.ceil(Math.max(...lons) / cell) * cell + cell,
  };
}

/** Projection of the illustrative demo region (sample-data screens and the drawn base map). */
export const DEMO_PROJECTION = createProjection(MAP_BOUNDS);
export const MAP_W = DEMO_PROJECTION.width;
export const MAP_H = DEMO_PROJECTION.height;
export const project = DEMO_PROJECTION.project;
export const unproject = DEMO_PROJECTION.unproject;
export const pathFrom = DEMO_PROJECTION.pathFrom;

/** Map units per metre (north–south). */
export const UNITS_PER_METRE = DEMO_PROJECTION.unitsPerMetre;

/** Smooth closed blob through lat/lon points (Catmull-Rom → cubic Bézier). */
export function blobFrom(points: LatLon[]) {
  const pts = points.map(project);
  const n = pts.length;
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return `${d} Z`;
}

/** Smooth open curve through points. */
export function curveFrom(points: LatLon[]) {
  const pts = points.map(project);
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}
