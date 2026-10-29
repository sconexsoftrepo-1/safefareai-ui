import type { Vehicle, VehicleGroup, VehicleInput, VehicleState } from "../types";
import { CITY_AREAS, DEMO_NOW } from "../mock-data/catalog";
import { fleetStore } from "../store/fleet-store";
import { DAY } from "../utils/time";
import { demoClock, localId, ServiceError, simulateLatency } from "./core";

export interface VehicleListFilters {
  search?: string;
  groupId?: string | "all";
  state?: VehicleState | "online" | "all";
}

export function matchesVehicleSearch(v: Vehicle, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [v.vehicleName, v.plate, v.terminalNo, v.vehicleType, v.terminalType].some((field) => field.toLowerCase().includes(q));
}

export function filterVehicles(vehicles: Vehicle[], filters: VehicleListFilters = {}) {
  return vehicles.filter((v) => {
    if (filters.search && !matchesVehicleSearch(v, filters.search)) return false;
    if (filters.groupId && filters.groupId !== "all" && v.groupId !== filters.groupId) return false;
    if (filters.state && filters.state !== "all") {
      if (filters.state === "online") return v.telemetry.vehicleState !== "offline";
      return v.telemetry.vehicleState === filters.state;
    }
    return true;
  });
}

function assertUnique(input: VehicleInput, ignoreId?: string) {
  const { vehicles } = fleetStore.getState();
  const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase();
  if (vehicles.some((v) => v.vehicleId !== ignoreId && norm(v.plate) === norm(input.plate))) {
    throw new ServiceError("A vehicle with this plate already exists.", "plate");
  }
  if (vehicles.some((v) => v.vehicleId !== ignoreId && v.terminalNo === input.terminalNo.trim())) {
    throw new ServiceError("This device ID is already registered.", "terminalNo");
  }
}

/** Keeps driver ↔ vehicle assignment consistent on both sides. */
function reassignDriver(vehicleId: string, driverId: string | undefined) {
  fleetStore.setState((s) => ({
    drivers: s.drivers.map((d) => {
      if (d.driverId === driverId) return { ...d, assignedVehicleId: vehicleId, status: "active" as const };
      if (d.assignedVehicleId === vehicleId && d.driverId !== driverId) return { ...d, assignedVehicleId: undefined };
      return d;
    }),
    vehicles: s.vehicles.map((v) => (v.vehicleId !== vehicleId && driverId && v.driverId === driverId ? { ...v, driverId: undefined } : v)),
  }));
}

/**
 * Vehicles & devices. Future integration (via BFF):
 * list → 1.8 /vehicle/getChildVehicle · get → 1.4 /vehicle/getVehicle · create → 1.1 /vehicle/addVehicle
 * update → 1.2 /vehicle/updateVehicle · delete → 1.3 /vehicle/delVehicle · transfer → 1.9 /vehicle/transferVehicle
 * live telemetry → 3.1 /monitor/getRealTimeInfo (polled, cached — vendor returns 503 when called too often).
 */
export const vehicleService = {
  async listVehicles(filters?: VehicleListFilters) {
    await simulateLatency();
    return filterVehicles(fleetStore.getState().vehicles, filters);
  },

  async getVehicle(id: string) {
    await simulateLatency(200);
    return fleetStore.getState().vehicles.find((v) => v.vehicleId === id) ?? null;
  },

  async createVehicle(input: VehicleInput): Promise<Vehicle> {
    await simulateLatency(450);
    assertUnique(input);
    const now = demoClock();
    const group = fleetStore.getState().groups.find((g) => g.groupId === input.groupId);
    const area = CITY_AREAS[0];
    const vehicle: Vehicle = {
      ...input,
      plate: input.plate.trim().toUpperCase(),
      terminalNo: input.terminalNo.trim(),
      vehicleId: localId("v"),
      activationTime: now.toISOString(),
      expireDate: new Date(now.getTime() + 365 * DAY).toISOString(),
      createTime: now.toISOString(),
      telemetry: {
        lat: area.lat + 0.004,
        lon: area.lon - 0.006,
        speed: 0,
        direction: 0,
        mileage: 0,
        vehicleState: "offline",
        accState: false,
        posState: false,
        power: 0,
        gsmSin: 0,
        netModel: "4G",
        alarm: false,
        lastReportTime: now.toISOString(),
        address: `Awaiting first report${group ? ` · ${group.groupName}` : ""}`,
      },
    };
    fleetStore.setState((s) => ({ vehicles: [vehicle, ...s.vehicles] }));
    if (input.driverId) reassignDriver(vehicle.vehicleId, input.driverId);
    return vehicle;
  },

  async updateVehicle(id: string, input: VehicleInput): Promise<Vehicle> {
    await simulateLatency(400);
    const existing = fleetStore.getState().vehicles.find((v) => v.vehicleId === id);
    if (!existing) throw new ServiceError("Vehicle not found.");
    assertUnique(input, id);
    const updated: Vehicle = { ...existing, ...input, plate: input.plate.trim().toUpperCase(), terminalNo: input.terminalNo.trim() };
    fleetStore.setState((s) => ({ vehicles: s.vehicles.map((v) => (v.vehicleId === id ? updated : v)) }));
    if (input.driverId !== existing.driverId) reassignDriver(id, input.driverId);
    return updated;
  },

  /** Mirrors vendor 1.3 — removing a device also removes its trips and events in this demo. */
  async deleteVehicles(ids: string[]) {
    await simulateLatency(400);
    const remove = new Set(ids);
    fleetStore.setState((s) => ({
      vehicles: s.vehicles.filter((v) => !remove.has(v.vehicleId)),
      drivers: s.drivers.map((d) => (d.assignedVehicleId && remove.has(d.assignedVehicleId) ? { ...d, assignedVehicleId: undefined } : d)),
      trips: s.trips.filter((t) => !remove.has(t.vehicleId)),
      alarms: s.alarms.filter((a) => !remove.has(a.vehicleId)),
      geofences: s.geofences.map((g) => ({ ...g, selectIds: g.selectIds.filter((id) => !remove.has(id)) })),
      selectedVehicleId: s.selectedVehicleId && remove.has(s.selectedVehicleId) ? null : s.selectedVehicleId,
    }));
    return ids.length;
  },

  async deleteVehicle(id: string) {
    return this.deleteVehicles([id]);
  },

  /** Sell / move devices (vendor 1.9): the target group determines the new owner user. */
  async transferVehicles(ids: string[], groupId: string) {
    await simulateLatency(450);
    const group = fleetStore.getState().groups.find((g) => g.groupId === groupId);
    if (!group) throw new ServiceError("Target group not found.", "groupId");
    const move = new Set(ids);
    fleetStore.setState((s) => ({
      vehicles: s.vehicles.map((v) => (move.has(v.vehicleId) ? { ...v, groupId } : v)),
      alarms: s.alarms.map((a) => (move.has(a.vehicleId) ? { ...a, groupId } : a)),
    }));
    return group;
  },
};

/** Groups. Future: 2.5 list · 2.1 add · 2.2 modify · 2.3 remove (vendor also deletes the group's devices). */
export const groupService = {
  async listGroups() {
    await simulateLatency(200);
    return fleetStore.getState().groups;
  },
  async createGroup(input: Omit<VehicleGroup, "groupId">) {
    await simulateLatency(350);
    const name = input.groupName.trim();
    if (!name) throw new ServiceError("Group name is required.", "groupName");
    if (fleetStore.getState().groups.some((g) => g.groupName.toLowerCase() === name.toLowerCase())) {
      throw new ServiceError("A group with this name already exists.", "groupName");
    }
    const group: VehicleGroup = { ...input, groupName: name, groupId: localId("g") };
    fleetStore.setState((s) => ({ groups: [...s.groups, group] }));
    return group;
  },
};

export function expiryStatus(isoDate: string | undefined, now = DEMO_NOW): "expired" | "soon" | "ok" | "none" {
  if (!isoDate) return "none";
  const days = (new Date(isoDate).getTime() - now.getTime()) / DAY;
  if (days < 0) return "expired";
  if (days <= 30) return "soon";
  return "ok";
}
