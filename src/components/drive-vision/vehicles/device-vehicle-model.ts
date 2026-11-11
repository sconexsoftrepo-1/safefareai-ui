import type { DeviceDto, DeviceRequest, VehicleRow } from "@/features/drive-vision/api/types";
import { isApiError } from "@/features/drive-vision/api/errors";
import { describeSaveError, type EditableField } from "./device-edit-model";

/**
 * Device ↔ vehicle mapping for the Add / Edit device forms. Pure: unit-tested.
 *
 * Contract (Swagger DeviceRequest; docs/contracts/vehicle-api.txt):
 * - POST / PUT /api/v1/devices{/id} take the FULL DeviceRequest plus `vehicleId` / `unlinkVehicle`.
 * - Assign:  { vehicleId: <vehicle id>, unlinkVehicle: false }.
 * - Unlink:  { vehicleId: 0, unlinkVehicle: true }.
 * - Keep:    neither field is sent ("vehicleId omitted → current vehicle kept"), so an ordinary edit is unchanged.
 * - Reassigning a vehicle that another device holds is ONE PUT to the edited device. Whether the backend moves the
 *   vehicle or refuses (409 RESOURCE_IN_USE) is the backend's call: the UI reports what it answers and never
 *   unlinks the other device itself. POST /devices/transfer (vendor/group transfer) is never used for this.
 */

/** A vehicle in the Assign Vehicle picker (GET /vehicles row, normalised). */
export interface VehicleOption {
  /** Safe-Fare vehicle id: what `vehicleId` carries. Never the device id or the vehicle number. */
  vehicleId: number;
  vehicleNumber: string;
  vehicleType: string | null;
  /** "Make Model" (either part may be missing); null when neither is set. */
  makeModel: string | null;
  status: string | null;
  assigned: boolean;
  /** The device currently fitted, when the server says which. */
  deviceId: number | null;
  deviceName: string | null;
  terminalNo: string | null;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : null);

/** GET /vehicles rows → picker options (rows without an id or number are dropped), sorted by vehicle number. */
export function toVehicleOptions(rows: readonly VehicleRow[] | undefined): VehicleOption[] {
  const out: VehicleOption[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const vehicleId = int(r.id);
    const vehicleNumber = text(r.vehicleNumber);
    if (vehicleId === null || vehicleId <= 0 || !vehicleNumber) continue;
    const deviceId = int(r.device?.id);
    const makeModel = [text(r.make), text(r.model)].filter(Boolean).join(" ") || null;
    out.push({
      vehicleId,
      vehicleNumber,
      vehicleType: text(r.vehicleType),
      makeModel,
      status: text(r.status),
      assigned: r.deviceAssigned === true || deviceId !== null,
      deviceId,
      deviceName: text(r.device?.name),
      terminalNo: text(r.device?.terminalNo),
    });
  }
  return out.sort((a, b) => a.vehicleNumber.localeCompare(b.vehicleNumber));
}

export type AssignmentState = "available" | "current" | "assigned-elsewhere";

/** How a vehicle relates to the device being edited (no device id = Add device: every assigned vehicle is elsewhere). */
export function assignmentState(o: VehicleOption, editingDeviceId?: number | null): AssignmentState {
  if (!o.assigned) return "available";
  if (typeof editingDeviceId === "number" && o.deviceId === editingDeviceId) return "current";
  return "assigned-elsewhere";
}

/** Picking this vehicle needs the "Vehicle Already Assigned" confirmation first. */
export const needsReassignConfirm = (o: VehicleOption, editingDeviceId?: number | null) => assignmentState(o, editingDeviceId) === "assigned-elsewhere";

/** "Truck · Tata Prima" (empty when neither is known). */
export const vehicleDetailLine = (o: VehicleOption) => [o.vehicleType, o.makeModel].filter(Boolean).join(" · ");

/** The device that holds the vehicle, for the picker and the confirmation ("Camera-01", else the terminal no.). */
export const holderLabel = (o: VehicleOption) => o.deviceName ?? o.terminalNo ?? (o.deviceId !== null ? `Device #${o.deviceId}` : "another device");

/**
 * The vehicle the edited device is fitted in: DeviceDto.vehicleId when the server sends it (null = none), else the
 * vehicle whose `device.id` is this device (from the picker list), else null.
 */
export function currentVehicleId(d: Pick<DeviceDto, "id" | "vehicleId">, options: readonly VehicleOption[] | undefined): number | null {
  if (typeof d.vehicleId === "number" && d.vehicleId > 0) return d.vehicleId;
  if (d.vehicleId === null) return null;
  return options?.find((o) => typeof d.id === "number" && o.deviceId === d.id)?.vehicleId ?? null;
}

/** What a PUT does to the mapping. */
export type MappingChange = { kind: "keep" } | { kind: "assign"; vehicleId: number; vehicleNumber: string; reassign: boolean } | { kind: "unlink" };
export const KEEP: MappingChange = { kind: "keep" };

/**
 * The body with the mapping applied. Every other field — the seven required ones included — comes from `body`
 * untouched, so the PUT stays a full DeviceRequest. `keep` sends neither mapping field.
 */
export function applyMapping(body: DeviceRequest, change: MappingChange): DeviceRequest {
  const out: DeviceRequest = { ...body };
  delete out.vehicleId;
  delete out.unlinkVehicle;
  if (change.kind === "assign") {
    out.vehicleId = change.vehicleId;
    out.unlinkVehicle = false;
  } else if (change.kind === "unlink") {
    out.vehicleId = 0;
    out.unlinkVehicle = true;
  }
  return out;
}

/** Add device: the POST body with the chosen vehicle, or unchanged (no mapping fields) when none was chosen. */
export function withCreateVehicle(body: DeviceRequest, vehicleId: string): DeviceRequest {
  const id = /^\d+$/.test(vehicleId) ? Number(vehicleId) : 0;
  return id > 0 ? applyMapping(body, { kind: "assign", vehicleId: id, vehicleNumber: "", reassign: false }) : applyMapping(body, KEEP);
}

/** A notice for the picker list as a whole (null when nothing needs saying). */
export function vehicleListNotice(options: readonly VehicleOption[], opts: { truncated?: boolean; total?: number; editingDeviceId?: number | null } = {}): string | null {
  const notes: string[] = [];
  if (options.length === 0) notes.push("No vehicles are registered in this organisation yet. Add one under Vehicle Registry, or save the device without a vehicle.");
  else {
    const free = options.filter((o) => assignmentState(o, opts.editingDeviceId) === "available").length;
    const elsewhere = options.filter((o) => assignmentState(o, opts.editingDeviceId) === "assigned-elsewhere").length;
    if (free === 0 && elsewhere === options.length) notes.push("Every vehicle already has a device. Choosing one asks you to confirm a reassignment.");
    else if (free === 0) notes.push("No other vehicle is available. Choosing an assigned vehicle asks you to confirm a reassignment.");
  }
  if (opts.truncated) notes.push(`Showing the first ${options.length} of ${opts.total ?? "more"} vehicles.`);
  return notes.length ? notes.join(" ") : null;
}

export interface MappingFailure {
  message: string;
  /** The device should be re-read (the outcome may be unclear, or it changed). */
  refetch: boolean;
  /** A mapping refusal (409 etc.): the picker goes back to the real current mapping. */
  conflict: boolean;
  fieldErrors: Partial<Record<EditableField, string>>;
}

/**
 * A failed PUT / POST that carried a mapping change. The backend's own message always comes first; nothing here
 * ever turns a refusal into success.
 */
export function describeMappingError(err: unknown, change: MappingChange): MappingFailure {
  const base = describeSaveError(err);
  const out: MappingFailure = { message: base.message, refetch: base.refetch, conflict: false, fieldErrors: base.fieldErrors };
  if (!isApiError(err) || change.kind === "keep") return out;
  const msg = err.message || "";
  const what = change.kind === "unlink" ? "The vehicle wasn't unlinked" : `Vehicle ${change.vehicleNumber || `#${change.vehicleId}`} wasn't assigned`;
  if (err.status === 409) {
    out.conflict = true;
    out.refetch = true;
    if (err.errorCode === "RESOURCE_IN_USE") out.message = `${what}: ${msg || "it already has another device."}${change.kind === "assign" && change.reassign ? " The server didn't move it from its current device, and nothing was unlinked by the app." : ""}`;
    else if (err.errorCode === "OPERATION_NOT_ALLOWED") out.message = `${what}: ${msg || "the vehicle is inactive."}`;
    else if (err.errorCode !== "CHARGEABLE_CHANGE" && err.errorCode !== "CONFIRMATION_REQUIRED") out.message = `${what}: ${msg || `the server refused it (HTTP 409${err.errorCode ? ` ${err.errorCode}` : ""}).`}`;
    return out;
  }
  if (err.status === 400 && (err.errorCode === "INVALID_REFERENCE" || err.errorCode === "INVALID_VALUE")) {
    out.conflict = true;
    out.message = `${what}: ${msg || `the server refused the vehicle (${err.errorCode}).`}`;
    return out;
  }
  if (err.status === 403) {
    out.message = `${what}: ${msg || "you don't have permission to update this device (device.update)."}`;
    return out;
  }
  if (err.status === 504 || err.kind === "timeout" || err.kind === "network") {
    out.refetch = true;
    out.message = `${what}? No clear answer from the server${msg ? ` (${msg})` : ""}. The device is reloaded — check its vehicle before trying again.`;
  }
  return out;
}
