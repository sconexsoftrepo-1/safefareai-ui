import { useSyncExternalStore } from "react";
import { createFleetSeed, type FleetSeed } from "../mock-data/seed";

/**
 * Lightweight in-memory store for the demo. Holds the mutable copy of the seed so
 * local CRUD survives client-side navigation. It is reset on a full page reload.
 * Replace with server state (e.g. React Query against the BFF) during integration.
 */
export interface FleetState extends FleetSeed {
  /** Vehicle currently in focus (monitoring, detail, video) — read by the AI assistant. */
  selectedVehicleId: string | null;
}

const INITIAL_STATE: FleetState = { ...createFleetSeed(), selectedVehicleId: null };

let state: FleetState = INITIAL_STATE;
const listeners = new Set<() => void>();

export const fleetStore = {
  getState: () => state,
  getInitialState: () => INITIAL_STATE,
  setState(updater: (prev: FleetState) => Partial<FleetState>) {
    state = { ...state, ...updater(state) };
    listeners.forEach((listener) => listener());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/**
 * Subscribe to a slice of the store. Selectors must return stable references
 * (a stored array/object or a primitive); derive collections with useMemo.
 */
export function useFleet<T>(selector: (s: FleetState) => T): T {
  return useSyncExternalStore(
    fleetStore.subscribe,
    () => selector(fleetStore.getState()),
    () => selector(INITIAL_STATE)
  );
}

export function setSelectedVehicle(vehicleId: string | null) {
  if (fleetStore.getState().selectedVehicleId === vehicleId) return;
  fleetStore.setState(() => ({ selectedVehicleId: vehicleId }));
}
