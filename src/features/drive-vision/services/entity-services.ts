import type { Driver, DriverInput, FleetUser, Geofence, GeofenceInput, UserRole } from "../types";
import { fleetStore } from "../store/fleet-store";
import { demoClock, localId, ServiceError, simulateLatency } from "./core";

/* ───────────── Drivers — BFF-owned (vendor API has no driver endpoints) ───────────── */

function syncAssignment(driverId: string, vehicleId: string | undefined) {
  fleetStore.setState((s) => ({
    vehicles: s.vehicles.map((v) => {
      if (v.vehicleId === vehicleId) return { ...v, driverId };
      if (v.driverId === driverId && v.vehicleId !== vehicleId) return { ...v, driverId: undefined };
      return v;
    }),
    drivers: s.drivers.map((d) => (d.driverId !== driverId && vehicleId && d.assignedVehicleId === vehicleId ? { ...d, assignedVehicleId: undefined } : d)),
  }));
}

export const driverService = {
  async listDrivers() {
    await simulateLatency(250);
    return fleetStore.getState().drivers;
  },
  async createDriver(input: DriverInput) {
    await simulateLatency(400);
    if (fleetStore.getState().drivers.some((d) => d.licenceNo.toUpperCase() === input.licenceNo.trim().toUpperCase())) {
      throw new ServiceError("A driver with this licence number already exists.", "licenceNo");
    }
    const driver: Driver = { ...input, licenceNo: input.licenceNo.trim().toUpperCase(), driverId: localId("d") };
    fleetStore.setState((s) => ({ drivers: [driver, ...s.drivers] }));
    syncAssignment(driver.driverId, driver.assignedVehicleId);
    return driver;
  },
  async updateDriver(id: string, input: DriverInput) {
    await simulateLatency(350);
    if (fleetStore.getState().drivers.some((d) => d.driverId !== id && d.licenceNo.toUpperCase() === input.licenceNo.trim().toUpperCase())) {
      throw new ServiceError("A driver with this licence number already exists.", "licenceNo");
    }
    const updated: Driver = { ...input, licenceNo: input.licenceNo.trim().toUpperCase(), driverId: id };
    fleetStore.setState((s) => ({ drivers: s.drivers.map((d) => (d.driverId === id ? updated : d)) }));
    syncAssignment(id, updated.assignedVehicleId);
    return updated;
  },
  async deleteDriver(id: string) {
    await simulateLatency(300);
    fleetStore.setState((s) => ({
      drivers: s.drivers.filter((d) => d.driverId !== id),
      vehicles: s.vehicles.map((v) => (v.driverId === id ? { ...v, driverId: undefined } : v)),
    }));
  },
};

/* ───────────── Geofences — vendor 10.1–10.5 ───────────── */

export const geofenceService = {
  async listGeofences() {
    await simulateLatency(250);
    return fleetStore.getState().geofences;
  },
  async createGeofence(input: GeofenceInput) {
    await simulateLatency(400);
    const fence: Geofence = { ...input, pathId: localId("f"), createdAt: demoClock().toISOString() };
    fleetStore.setState((s) => ({ geofences: [fence, ...s.geofences] }));
    return fence;
  },
  async updateGeofence(id: string, input: GeofenceInput) {
    await simulateLatency(350);
    const existing = fleetStore.getState().geofences.find((g) => g.pathId === id);
    if (!existing) throw new ServiceError("Geofence not found.");
    const updated: Geofence = { ...existing, ...input };
    fleetStore.setState((s) => ({ geofences: s.geofences.map((g) => (g.pathId === id ? updated : g)) }));
    return updated;
  },
  async deleteGeofence(id: string) {
    await simulateLatency(300);
    fleetStore.setState((s) => ({ geofences: s.geofences.filter((g) => g.pathId !== id) }));
  },
};

/* ───────────── Users & sub-accounts — vendor 6.1–6.5; roles are BFF-owned ───────────── */

export interface UserInput {
  userName: string;
  parentId: string;
  email?: string;
  phone?: string;
  role: UserRole;
}

export function descendantsOf(users: FleetUser[], userId: string): FleetUser[] {
  const children = users.filter((u) => u.parentId === userId);
  return children.flatMap((c) => [c, ...descendantsOf(users, c.userId)]);
}

export const userService = {
  async getUserTree() {
    await simulateLatency(250);
    return fleetStore.getState().users;
  },
  async createUser(input: UserInput) {
    await simulateLatency(400);
    if (fleetStore.getState().users.some((u) => u.userName.toLowerCase() === input.userName.trim().toLowerCase())) {
      throw new ServiceError("A user with this name already exists.", "userName");
    }
    const user: FleetUser = { ...input, userName: input.userName.trim(), userId: localId("u"), createdAt: demoClock().toISOString() };
    fleetStore.setState((s) => ({ users: [...s.users, user] }));
    return user;
  },
  async updateUser(id: string, input: UserInput) {
    await simulateLatency(350);
    const users = fleetStore.getState().users;
    if (input.parentId === id || descendantsOf(users, id).some((d) => d.userId === input.parentId)) {
      throw new ServiceError("A user cannot be moved under itself or its own sub-users.", "parentId");
    }
    fleetStore.setState((s) => ({ users: s.users.map((u) => (u.userId === id ? { ...u, ...input, userName: input.userName.trim() } : u)) }));
  },
  /**
   * Vendor 6.3 also deletes the user's groups and devices. The demo mirrors that:
   * sub-users, their groups and their vehicles are removed together.
   */
  async deleteUser(id: string) {
    await simulateLatency(450);
    const s0 = fleetStore.getState();
    if (s0.users.find((u) => u.userId === id)?.parentId === null) throw new ServiceError("The root account cannot be deleted.");
    const removeUsers = new Set([id, ...descendantsOf(s0.users, id).map((u) => u.userId)]);
    const removeGroups = new Set(s0.groups.filter((g) => removeUsers.has(g.userId)).map((g) => g.groupId));
    const removeVehicles = new Set(s0.vehicles.filter((v) => removeGroups.has(v.groupId)).map((v) => v.vehicleId));
    fleetStore.setState((s) => ({
      users: s.users.filter((u) => !removeUsers.has(u.userId)),
      groups: s.groups.filter((g) => !removeGroups.has(g.groupId)),
      vehicles: s.vehicles.filter((v) => !removeVehicles.has(v.vehicleId)),
      trips: s.trips.filter((t) => !removeVehicles.has(t.vehicleId)),
      alarms: s.alarms.filter((a) => !removeVehicles.has(a.vehicleId)).map((a) => (a.assigneeId && removeUsers.has(a.assigneeId) ? { ...a, assigneeId: undefined } : a)),
      drivers: s.drivers.map((d) => (d.assignedVehicleId && removeVehicles.has(d.assignedVehicleId) ? { ...d, assignedVehicleId: undefined } : d)),
      geofences: s.geofences.map((g) => ({ ...g, selectIds: g.selectIds.filter((v) => !removeVehicles.has(v)) })),
    }));
    return { users: removeUsers.size, groups: removeGroups.size, vehicles: removeVehicles.size };
  },
};

/* ───────────── Notifications — BFF push (vendor has no push API) ───────────── */

export const notificationService = {
  markRead(id: string) {
    fleetStore.setState((s) => ({ notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) }));
  },
  markAllRead() {
    fleetStore.setState((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) }));
  },
};
