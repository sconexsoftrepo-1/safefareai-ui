import type { GeofenceDto } from "@/features/drive-vision/api/types";
import type { LatLon } from "@/features/drive-vision/types";
import { checkPosition } from "../monitoring/live-fleet-model";

/** Geofences from GET /geofences → drawable geometry. Pure: unit-tested. */

/** Spec limits: GeofenceRequest.points maxItems 500. */
export const MAX_FENCE_POINTS = 500;

export interface FenceGeometry {
  /** Usable vertices in API order. */
  points: LatLon[];
  /** Vertices dropped as missing / out of range / (0, 0). */
  dropped: number;
  /** Why the fence can't be drawn, or null. */
  issue: string | null;
}

export function fenceGeometry(f: GeofenceDto): FenceGeometry {
  const raw = Array.isArray(f.points) ? f.points : [];
  const points: LatLon[] = [];
  for (const p of raw) {
    const c = checkPosition(p ?? {});
    if (c.ok) points.push({ lat: c.lat, lon: c.lon });
  }
  const dropped = raw.length - points.length;
  const min = f.shape === "LINE" ? 2 : 3;
  let issue: string | null = null;
  if (f.shape !== "AREA" && f.shape !== "LINE") issue = "Unknown shape";
  else if (points.length < min) issue = `${points.length} usable point${points.length === 1 ? "" : "s"} — a ${f.shape === "LINE" ? "line needs 2" : "zone needs 3"}`;
  return { points, dropped, issue };
}

/** Polyline to draw: AREA rings are closed back to the first vertex; LINE is drawn as given. */
export function fencePath(f: GeofenceDto, g: FenceGeometry = fenceGeometry(f)): LatLon[] {
  if (g.issue) return [];
  if (f.shape === "AREA") {
    const first = g.points[0];
    const last = g.points[g.points.length - 1];
    return first.lat === last.lat && first.lon === last.lon ? g.points : [...g.points, first];
  }
  return g.points;
}

/** "3 devices" / "Group 4" / "Not bound" — ids only; names are joined by the page when available. */
export function bindingSummary(f: GeofenceDto): string {
  const ids = Array.isArray(f.bindIds) ? f.bindIds.filter((i) => typeof i === "number") : [];
  if (f.global) return "All devices (global)";
  if (!f.bindType || ids.length === 0) return "Not bound";
  const noun = f.bindType === "GROUP" ? "group" : "device";
  return `${ids.length} ${noun}${ids.length === 1 ? "" : "s"}`;
}

/** Hex colour from the API when it looks like one; otherwise a theme colour. */
export function fenceColor(f: GeofenceDto): string {
  return typeof f.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(f.color) ? f.color : f.shape === "LINE" ? "var(--dv-series-2)" : "var(--dv-series-1)";
}
