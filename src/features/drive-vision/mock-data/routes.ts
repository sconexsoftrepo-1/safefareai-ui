import type { LatLon, TrackPoint, Trip, TripStop } from "../types";
import { bearing, haversineKm, lerpLatLon } from "../utils/geo";
import { createRng } from "../utils/random";
import { MINUTE } from "../utils/time";
import { CITY_AREAS, ROAD_LINKS } from "./catalog";

/** Shortest hop path between two areas over the simplified road network (BFS). */
export function areaPath(from: number, to: number): number[] {
  if (from === to) return [from];
  const adjacency = new Map<number, number[]>();
  for (const [a, b] of ROAD_LINKS) {
    adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
    adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
  }
  const prev = new Map<number, number>();
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length) {
    const node = queue.shift()!;
    if (node === to) break;
    for (const next of adjacency.get(node) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        prev.set(next, node);
        queue.push(next);
      }
    }
  }
  const path = [to];
  let cursor = to;
  while (cursor !== from) {
    const p = prev.get(cursor);
    if (p === undefined) return [from, to];
    path.unshift(p);
    cursor = p;
  }
  return path;
}

const geometryCache = new Map<string, LatLon[]>();

/**
 * Road-like polyline between two areas: follows the area graph, subdivided with a
 * gentle seeded wobble so routes look hand-drawn rather than ruler-straight.
 */
export function routeGeometry(from: number, to: number, seed: number): LatLon[] {
  const cacheKey = `${from}:${to}:${seed}`;
  const cached = geometryCache.get(cacheKey);
  if (cached) return cached;

  const rng = createRng(seed);
  const hops = areaPath(from, to).map((i) => CITY_AREAS[i]);
  const points: LatLon[] = [];
  for (let h = 0; h < hops.length - 1; h++) {
    const a = hops[h];
    const b = hops[h + 1];
    const segKm = haversineKm(a, b);
    const steps = Math.max(6, Math.round(segKm / 0.35));
    const amp = rng.float(0.0015, 0.004) * (rng.chance(0.5) ? 1 : -1);
    const dLat = b.lat - a.lat;
    const dLon = b.lon - a.lon;
    const len = Math.hypot(dLat, dLon) || 1;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const base = lerpLatLon(a, b, t);
      const wobble = Math.sin(t * Math.PI) * amp + Math.sin(t * Math.PI * 3) * amp * 0.25;
      points.push({ lat: base.lat + (-dLon / len) * wobble, lon: base.lon + (dLat / len) * wobble });
    }
  }
  const last = hops[hops.length - 1];
  points.push({ lat: last.lat, lon: last.lon });
  if (points.length === 1) points.push({ lat: last.lat + 0.004, lon: last.lon + 0.004 });

  geometryCache.set(cacheKey, points);
  return points;
}

export function polylineKm(points: LatLon[]) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineKm(points[i - 1], points[i]);
  return total;
}

export interface StopPlan {
  pointIndex: number;
  durationMin: number;
  idle: boolean;
}

/** Deterministic stop plan for a trip geometry. */
export function planStops(pointCount: number, stopCount: number, seed: number): StopPlan[] {
  const rng = createRng(seed ^ 0x5f3759df);
  const plans: StopPlan[] = [];
  for (let i = 0; i < stopCount; i++) {
    const slot = (i + 1) / (stopCount + 1);
    plans.push({
      pointIndex: Math.min(pointCount - 2, Math.max(1, Math.round(slot * (pointCount - 1) + rng.int(-2, 2)))),
      durationMin: rng.int(4, 22),
      idle: rng.chance(0.4),
    });
  }
  return plans.sort((a, b) => a.pointIndex - b.pointIndex);
}

export function nearestAreaAddress(p: LatLon) {
  let best = CITY_AREAS[0];
  let bestD = Infinity;
  for (const area of CITY_AREAS) {
    const d = haversineKm(p, area);
    if (d < bestD) {
      bestD = d;
      best = area;
    }
  }
  return `${best.street}, ${best.name}`;
}

const trackCache = new Map<string, { points: TrackPoint[]; stops: TripStop[] }>();

/** Rebuild a trip's timestamped track (mirrors vendor 3.2 trackList) from its seed. */
export function buildTrack(trip: Trip): { points: TrackPoint[]; stops: TripStop[] } {
  const cached = trackCache.get(trip.tripId);
  if (cached) return cached;

  const geometry = routeGeometry(trip.fromAreaIndex, trip.toAreaIndex, trip.routeSeed);
  const stopsPlan = planStops(geometry.length, trip.stopCount, trip.routeSeed);
  const stopMinutes = stopsPlan.reduce((sum, s) => sum + s.durationMin, 0);
  const movingMs = Math.max(5, trip.durationMin - stopMinutes) * MINUTE;
  const totalKm = polylineKm(geometry);
  const rng = createRng(trip.routeSeed ^ 0x9e3779b9);

  const start = new Date(trip.startTime).getTime();
  const points: TrackPoint[] = [];
  const stops: TripStop[] = [];
  let cumKm = 0;
  let dwellMs = 0;
  let stopCursor = 0;

  for (let i = 0; i < geometry.length; i++) {
    if (i > 0) cumKm += haversineKm(geometry[i - 1], geometry[i]);
    const t = start + movingMs * (totalKm ? cumKm / totalKm : 0) + dwellMs;
    const next = geometry[Math.min(i + 1, geometry.length - 1)];
    const dir = i < geometry.length - 1 ? bearing(geometry[i], next) : points[i - 1]?.direction ?? 0;
    const speed = i === 0 || i === geometry.length - 1 ? 0 : Math.round(Math.min(trip.maxSpeed, Math.max(8, trip.avgSpeed + rng.float(-14, 18))));
    points.push({ ...geometry[i], t: new Date(t).toISOString(), speed, direction: Math.round(dir) });

    const plan = stopsPlan[stopCursor];
    if (plan && plan.pointIndex === i) {
      const arrive = new Date(t);
      dwellMs += plan.durationMin * MINUTE;
      const depart = new Date(t + plan.durationMin * MINUTE);
      stops.push({
        id: `${trip.tripId}-s${stopCursor + 1}`,
        lat: geometry[i].lat,
        lon: geometry[i].lon,
        arrive: arrive.toISOString(),
        depart: depart.toISOString(),
        durationMin: plan.durationMin,
        idle: plan.idle,
        address: nearestAreaAddress(geometry[i]),
      });
      points.push({ ...geometry[i], t: depart.toISOString(), speed: 0, direction: Math.round(dir) });
      stopCursor++;
    }
  }

  const result = { points, stops };
  trackCache.set(trip.tripId, result);
  return result;
}

/** Interpolated position along a track at a given time. */
export function positionAt(points: TrackPoint[], time: number): TrackPoint {
  if (time <= new Date(points[0].t).getTime()) return points[0];
  for (let i = 1; i < points.length; i++) {
    const t1 = new Date(points[i].t).getTime();
    if (time <= t1) {
      const t0 = new Date(points[i - 1].t).getTime();
      const f = t1 === t0 ? 1 : (time - t0) / (t1 - t0);
      const p = lerpLatLon(points[i - 1], points[i], f);
      return { ...p, t: new Date(time).toISOString(), speed: points[i].speed, direction: points[i - 1].direction };
    }
  }
  return points[points.length - 1];
}
