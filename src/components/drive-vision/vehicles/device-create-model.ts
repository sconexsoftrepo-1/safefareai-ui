import type { DeviceModelDto, DeviceRequest, ProtocolDto } from "@/features/drive-vision/api/types";
import { isApiError } from "@/features/drive-vision/api/errors";
import { EDITABLE_FIELDS, MAX_LENGTH, dateInputToIso, type EditableField } from "./device-edit-model";
import { withCreateVehicle } from "./device-vehicle-model";

/**
 * Register a device (POST /api/v1/devices, V10 DeviceRequest; permission device.create). Pure: unit-tested.
 *
 * Charges: registering may involve vendor charges, and V10 doesn't document `confirmChargeableChange`. It is never
 * sent by default. Only when the server answers CHARGEABLE_CHANGE / CONFIRMATION_REQUIRED, and the user then ticks
 * an explicit acknowledgement of the server's message, is the same request resent with it set to true.
 */

export type CreateField = EditableField | "terminalNo" | "groupId" | "modelId" | "protocol" | "objectTypeId" | "cameraCount" | "vehicleId";

export type CreateForm = Record<EditableField, string> & {
  terminalNo: string;
  /** Ids as strings from the selects; "" = not chosen. */
  groupId: string;
  modelId: string;
  protocol: string;
  objectTypeId: string;
  cameraCount: string;
  /** Assign Vehicle: the vehicle registry id as a string; "" = no vehicle (the device is created unassigned). */
  vehicleId: string;
};

export const EMPTY_CREATE_FORM: CreateForm = {
  ...(Object.fromEntries(EDITABLE_FIELDS.map((f) => [f, ""])) as Record<EditableField, string>),
  terminalNo: "",
  groupId: "",
  modelId: "",
  protocol: "",
  objectTypeId: "",
  cameraCount: "0",
  vehicleId: "",
};

/** V10: ^[0-9A-Za-z]{11,20}$ */
export const TERMINAL_NO = /^[0-9A-Za-z]{11,20}$/;
const DATE_FIELDS = new Set<EditableField>(["insuranceDueAt", "maintenanceDueAt"]);

/** Protocols to offer for a model: the model's own list when the catalogue has one, else every protocol (V10 range 1–3). */
export function protocolChoices(model: DeviceModelDto | undefined, all: readonly ProtocolDto[]): ProtocolDto[] {
  const own = (model?.protocols ?? []).filter((p) => typeof p.code === "number");
  const list = own.length ? own : all.filter((p) => typeof p.code === "number");
  return list.filter((p) => p.code! >= 1 && p.code! <= 3);
}

export function validateCreate(form: CreateForm, models: readonly DeviceModelDto[] | undefined): Partial<Record<CreateField, string>> {
  const e: Partial<Record<CreateField, string>> = {};
  if (!form.name.trim()) e.name = "Enter a device name.";
  if (!TERMINAL_NO.test(form.terminalNo.trim())) e.terminalNo = "11–20 letters or digits, no spaces.";
  if (!/^\d+$/.test(form.groupId)) e.groupId = "Choose a group.";
  if (!/^\d+$/.test(form.modelId)) e.modelId = "Choose a device model.";
  else if (!models?.some((m) => String(m.id) === form.modelId && m.name?.trim())) e.modelId = "This model isn't in the catalogue.";
  if (!/^[1-3]$/.test(form.protocol)) e.protocol = "Choose a protocol.";
  if (!/^\d+$/.test(form.objectTypeId)) e.objectTypeId = "Choose an object type.";
  if (!/^\d+$/.test(form.cameraCount) || Number(form.cameraCount) > 16) e.cameraCount = "0–16 cameras.";
  if (form.vehicleId !== "" && !/^[1-9]\d*$/.test(form.vehicleId)) e.vehicleId = "Choose a vehicle from the list, or none.";
  for (const f of EDITABLE_FIELDS) {
    const max = MAX_LENGTH[f];
    if (max !== undefined && form[f].trim().length > max && !e[f]) e[f] = `Use ${max} characters or fewer.`;
  }
  for (const f of DATE_FIELDS) if (form[f] && !dateInputToIso(form[f])) e[f] = "Enter a valid date.";
  return e;
}

/**
 * The POST body: the seven required fields plus the optional ones that were filled in. modelName comes from the
 * catalogue entry the user chose. `confirmChargeableChange` only when `confirmCharge` (see the module note).
 * A chosen vehicle adds `vehicleId` (its registry id) and `unlinkVehicle: false`; with none, neither is sent.
 */
export function buildCreate(form: CreateForm, models: readonly DeviceModelDto[], confirmCharge = false): DeviceRequest {
  const model = models.find((m) => String(m.id) === form.modelId);
  const body: DeviceRequest = {
    groupId: Number(form.groupId),
    name: form.name.trim(),
    terminalNo: form.terminalNo.trim(),
    modelName: model!.name!.trim(),
    protocol: Number(form.protocol),
    objectTypeId: Number(form.objectTypeId),
    cameraCount: Number(form.cameraCount),
  };
  for (const f of EDITABLE_FIELDS) {
    if (f === "name") continue;
    const v = form[f].trim();
    if (!v) continue;
    (body as unknown as Record<string, unknown>)[f] = DATE_FIELDS.has(f) ? dateInputToIso(v) : v;
  }
  if (confirmCharge) body.confirmChargeableChange = true;
  return withCreateVehicle(body, form.vehicleId);
}

export type CreateOutcome =
  | { kind: "confirm"; message: string }
  | { kind: "error"; message: string; uncertain: boolean; fieldErrors: Partial<Record<CreateField, string>> };

/** A failed POST: a charge confirmation the user must accept, or an error (uncertain when the vendor may have acted). */
export function describeCreateError(err: unknown): CreateOutcome {
  const fieldErrors: Partial<Record<CreateField, string>> = {};
  if (!isApiError(err)) return { kind: "error", uncertain: false, fieldErrors, message: err instanceof Error && err.message ? err.message : "The device wasn't registered." };
  const map = err.fieldErrorMap();
  for (const f of [...EDITABLE_FIELDS, "terminalNo", "groupId", "protocol", "objectTypeId", "cameraCount"] as CreateField[]) if (map[f]) fieldErrors[f] = map[f];
  if (map.modelName) fieldErrors.modelId = map.modelName;
  if (map.vehicleId) fieldErrors.vehicleId = map.vehicleId;
  const msg = err.message || "";
  if (err.errorCode === "CHARGEABLE_CHANGE" || err.errorCode === "CONFIRMATION_REQUIRED") {
    return { kind: "confirm", message: msg || "The server says registering this device is a chargeable change." };
  }
  if (err.errorCode === "TENANT_REQUIRED") return { kind: "error", uncertain: false, fieldErrors, message: "Select a tenant first." };
  if (err.errorCode === "RESOURCE_IN_USE" || err.errorCode === "OPERATION_NOT_ALLOWED" || err.errorCode === "INVALID_REFERENCE") {
    if (!fieldErrors.vehicleId) fieldErrors.vehicleId = msg || "The server refused this vehicle.";
    return { kind: "error", uncertain: false, fieldErrors, message: `The device wasn't registered: ${msg || `the server refused the vehicle (${err.errorCode}).`}` };
  }
  if (err.errorCode === "DUPLICATE" && !fieldErrors.terminalNo) fieldErrors.terminalNo = msg || "This terminal number is already registered.";
  if (err.errorCode === "VENDOR_OUTCOME_UNKNOWN" || err.kind === "timeout" || err.kind === "network" || (err.kind === "http" && (err.status === 502 || err.status === 504))) {
    return { kind: "error", uncertain: true, fieldErrors, message: "No clear answer from the server or vendor: the device may or may not have been registered. The list is reloaded — check it before trying again." };
  }
  return { kind: "error", uncertain: false, fieldErrors, message: msg || `The server refused the device (HTTP ${err.status}).` };
}
