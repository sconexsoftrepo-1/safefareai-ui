"use client";

import { useEffect, useState } from "react";
import type { LatLon, Vehicle } from "../types";

export interface LivePosition extends LatLon {
  heading: number;
  speed: number;
}

interface LiveSnapshot {
  positions: Map<string, LivePosition>;
  trails: Map<string, LatLon[]>;
  tick: number;
}

const EMPTY: LiveSnapshot = { positions: new Map(), trails: new Map(), tick: 0 };

/**
 * Client-only simulation of polling (vendor 3.1 is polled; no push exists).
 * Moving vehicles advance along their heading every `intervalMs`, and a short
 * trail of "polled" points is kept per vehicle for follow mode. It starts after
 * mount, so the server render always uses the deterministic snapshot.
 */
export function useLiveSimulation(vehicles: Vehicle[], enabled: boolean, intervalMs = 3000) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot>(EMPTY);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      setSnapshot((prev) => {
        const positions = new Map(prev.positions);
        const trails = new Map(prev.trails);
        for (const v of vehicles) {
          if (v.telemetry.vehicleState !== "moving") continue;
          const cur = prev.positions.get(v.vehicleId) ?? { lat: v.telemetry.lat, lon: v.telemetry.lon, heading: v.telemetry.direction, speed: v.telemetry.speed };
          // Tether: steer back toward the snapshot position once ~2 km away, so vehicles stay in their area.
          const homeLat = v.telemetry.lat - cur.lat;
          const homeLon = v.telemetry.lon - cur.lon;
          const away = Math.hypot(homeLat, homeLon) > 0.018;
          const homeHeading = (Math.atan2(homeLon, homeLat) * 180) / Math.PI;
          const heading = away ? (homeHeading + 360) % 360 : (cur.heading + (Math.random() - 0.5) * 24 + 360) % 360;
          const speed = Math.max(12, Math.min(v.telemetry.speed >= 90 ? 98 : 78, cur.speed + (Math.random() - 0.5) * 8));
          const km = ((speed * intervalMs) / 3_600_000) * 3; // time-compressed ×3 so movement is visible
          const rad = (heading * Math.PI) / 180;
          const next: LivePosition = {
            lat: cur.lat + (Math.cos(rad) * km) / 111.32,
            lon: cur.lon + (Math.sin(rad) * km) / (111.32 * Math.cos((cur.lat * Math.PI) / 180)),
            heading,
            speed: Math.round(speed),
          };
          positions.set(v.vehicleId, next);
          const trail = prev.trails.get(v.vehicleId) ?? [{ lat: v.telemetry.lat, lon: v.telemetry.lon }];
          trails.set(v.vehicleId, [...trail, { lat: next.lat, lon: next.lon }].slice(-40));
        }
        return { positions, trails, tick: prev.tick + 1 };
      });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs, vehicles]);

  return snapshot;
}
