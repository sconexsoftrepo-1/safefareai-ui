import type { Trip, TripFilters, TripTrack } from "../types";
import { buildTrack } from "../mock-data/routes";
import { fleetStore } from "../store/fleet-store";
import { simulateLatency } from "./core";

export function filterTrips(trips: Trip[], filters: TripFilters) {
  return trips.filter((t) => {
    if (filters.vehicleId && filters.vehicleId !== "all" && t.vehicleId !== filters.vehicleId) return false;
    if (filters.from && t.endTime < filters.from) return false;
    if (filters.to && t.startTime > filters.to) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!`${t.startAddress} ${t.endAddress} ${t.tripId}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

/** Synchronous track builder for components (deterministic & cached). */
export function getTripTrackSync(trip: Trip): TripTrack {
  const { points, stops } = buildTrack(trip);
  const alarms = fleetStore
    .getState()
    .alarms.filter((a) => a.vehicleId === trip.vehicleId && a.alarmTime >= trip.startTime && a.alarmTime <= trip.endTime);
  return { tripId: trip.tripId, points, stops, alarms };
}

/**
 * Trips & tracks. Trip detection is a BFF feature (built from stored 3.1 positions);
 * the raw track maps to vendor 3.2 GET /track/getTrackList, with alarms joined by time.
 */
export const tripService = {
  async listTrips(filters: TripFilters = {}) {
    await simulateLatency();
    return filterTrips(fleetStore.getState().trips, filters).sort((a, b) => b.startTime.localeCompare(a.startTime));
  },
  async getTripTrack(tripId: string) {
    await simulateLatency(250);
    const trip = fleetStore.getState().trips.find((t) => t.tripId === tripId);
    return trip ? getTripTrackSync(trip) : null;
  },
};
