import type { RouteDto } from "@/features/drive-vision/api/types";
import { formatDateTime } from "@/features/drive-vision/utils/format";
import { checkPosition } from "../monitoring/live-fleet-model";

export interface LatLonPoint {
  lat: number;
  lon: number;
}

export interface RouteGeometry {
  /** Route points with usable coordinates, in server order (time order when every point has a valid time). */
  line: LatLonPoint[];
  total: number;
  skipped: number;
  start: LatLonPoint | null;
  end: LatLonPoint | null;
  stops: (LatLonPoint & { title: string })[];
  events: (LatLonPoint & { title: string })[];
}

/**
 * Map geometry for GET /trips/{id}/route. Points, stops and events without usable coordinates
 * (missing, out of range, 0,0) are skipped and counted — never placed at a guessed location.
 * Start/end come from the trip's own coordinates when valid, else from the first/last route point.
 * Pure: unit-tested.
 */
export function routeGeometry(route: RouteDto | undefined): RouteGeometry {
  const raw = route?.points ?? [];
  const valid = raw
    .map((p, i) => ({ p, i, t: p.deviceTime ? new Date(p.deviceTime).getTime() : NaN, c: checkPosition(p) }))
    .filter((x) => x.c.ok);
  if (valid.every((x) => !Number.isNaN(x.t))) valid.sort((a, b) => a.t - b.t || a.i - b.i);
  const line = valid.map((x) => (x.c.ok ? { lat: x.c.lat, lon: x.c.lon } : null)).filter((x): x is LatLonPoint => x !== null);

  const at = (lat?: number, lon?: number): LatLonPoint | null => {
    const c = checkPosition({ lat, lon });
    return c.ok ? { lat: c.lat, lon: c.lon } : null;
  };
  const trip = route?.trip;
  const stops = (route?.stops ?? []).flatMap((s) => {
    const p = at(s.lat, s.lon);
    return p ? [{ ...p, title: `Stop${s.stopType ? ` (${s.stopType})` : ""}${s.startTime ? ` · ${formatDateTime(s.startTime)}` : ""}` }] : [];
  });
  const events = (route?.events ?? []).flatMap((e) => {
    const p = at(e.lat, e.lon);
    return p ? [{ ...p, title: `${e.alarmName ?? "Alarm"}${e.alarmTime ? ` · ${formatDateTime(e.alarmTime)}` : ""}` }] : [];
  });
  return {
    line,
    total: raw.length,
    skipped: raw.length - line.length,
    start: at(trip?.startLat, trip?.startLon) ?? line[0] ?? null,
    end: trip?.inProgress ? null : (at(trip?.endLat, trip?.endLon) ?? (line.length > 1 ? line[line.length - 1] : null)),
    stops,
    events,
  };
}
