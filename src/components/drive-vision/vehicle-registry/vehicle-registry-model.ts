import type { VehicleDto, VehicleRequest } from "@/features/drive-vision/api/types";
import type { Errors } from "../settings/settings-model";

/** Client checks mirroring the vehicle request body (docs/contracts/vehicle-api.txt). Pure: unit-tested. */

export const VEHICLE_TEXT_FIELDS = ["vehicleNumber", "vehicleType", "make", "model", "chassisNumber", "engineNumber", "color", "remarks"] as const;
export type VehicleTextField = (typeof VEHICLE_TEXT_FIELDS)[number];
export type VehicleField = VehicleTextField | "yearOfManufacture" | "status";

export type VehicleForm = Record<VehicleTextField, string> & {
  /** As typed; "" = not set. */
  yearOfManufacture: string;
  status: "ACTIVE" | "INACTIVE";
};

export const EMPTY_VEHICLE_FORM: VehicleForm = {
  ...(Object.fromEntries(VEHICLE_TEXT_FIELDS.map((f) => [f, ""])) as Record<VehicleTextField, string>),
  yearOfManufacture: "",
  status: "ACTIVE",
};

export const VEHICLE_MAX: Record<VehicleTextField, number> = {
  vehicleNumber: 20,
  vehicleType: 50,
  make: 100,
  model: 100,
  chassisNumber: 60,
  engineNumber: 60,
  color: 30,
  remarks: 500,
};

/** Stored upper-case by the server; the form shows them that way as they're typed. */
export const UPPERCASE_FIELDS: ReadonlySet<VehicleTextField> = new Set(["vehicleNumber", "chassisNumber", "engineNumber"]);

/** Suggestions only: vehicleType is free text on the server. */
export const VEHICLE_TYPE_SUGGESTIONS = ["BUS", "MINI_BUS", "VAN", "CAR", "TRUCK", "AMBULANCE"] as const;

export const YEAR_MIN = 1900;
const YEAR_MAX = 2100;

/** The latest accepted year: next year (and never past 2100). */
export const maxYear = (now: Date = new Date()) => Math.min(YEAR_MAX, now.getFullYear() + 1);

export function vehicleFormFrom(v: VehicleDto): VehicleForm {
  const s = (x: string | null | undefined) => x ?? "";
  return {
    vehicleNumber: s(v.vehicleNumber),
    vehicleType: s(v.vehicleType),
    make: s(v.make),
    model: s(v.model),
    chassisNumber: s(v.chassisNumber),
    engineNumber: s(v.engineNumber),
    color: s(v.color),
    remarks: s(v.remarks),
    yearOfManufacture: typeof v.yearOfManufacture === "number" ? String(v.yearOfManufacture) : "",
    status: v.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
  };
}

export function validateVehicleForm(form: VehicleForm, now: Date = new Date()): Errors<VehicleField> {
  const e: Errors<VehicleField> = {};
  if (!form.vehicleNumber.trim()) e.vehicleNumber = "Vehicle number is required.";
  for (const f of VEHICLE_TEXT_FIELDS) {
    if (!e[f] && form[f].trim().length > VEHICLE_MAX[f]) e[f] = `Use ${VEHICLE_MAX[f]} characters or fewer.`;
  }
  const year = form.yearOfManufacture.trim();
  if (year) {
    const latest = maxYear(now);
    if (!/^\d{4}$/.test(year)) e.yearOfManufacture = "Enter a 4-digit year.";
    else if (Number(year) < YEAR_MIN || Number(year) > latest) e.yearOfManufacture = `Use a year from ${YEAR_MIN} to ${latest}.`;
  }
  return e;
}

/**
 * Body for POST /vehicles and PUT /vehicles/{id}. PUT replaces every field, so the form always sends
 * the whole record: a blank optional field is omitted, which the server stores as cleared (null).
 * Status is always sent (an omitted status would become ACTIVE).
 */
export function vehicleRequestBody(form: VehicleForm): VehicleRequest {
  const body: VehicleRequest = { vehicleNumber: form.vehicleNumber.trim().toUpperCase(), status: form.status };
  for (const f of VEHICLE_TEXT_FIELDS) {
    if (f === "vehicleNumber") continue;
    const v = form[f].trim();
    if (v) body[f] = UPPERCASE_FIELDS.has(f) ? v.toUpperCase() : v;
  }
  if (form.yearOfManufacture.trim()) body.yearOfManufacture = Number(form.yearOfManufacture.trim());
  return body;
}

/** Display name of a vehicle's fitted device. */
export function deviceLabel(v: Pick<VehicleDto, "device">): string | null {
  const d = v.device;
  if (!d) return null;
  return d.name || d.terminalNo || (d.id !== undefined ? `Device ${d.id}` : "Device");
}

/** "Ashok Leyland Viking · 2022" style summary; null when nothing is known. */
export function vehicleSummary(v: VehicleDto): string | null {
  const name = [v.make, v.model].filter(Boolean).join(" ");
  const parts = [name, typeof v.yearOfManufacture === "number" ? String(v.yearOfManufacture) : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
