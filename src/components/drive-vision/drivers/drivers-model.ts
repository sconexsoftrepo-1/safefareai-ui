import type { AssignDriverRequest, DriverDto, DriverRequest, LicenceStatus } from "@/features/drive-vision/api/types";
import { PHONE_PATTERN, type Errors } from "../settings/settings-model";
import type { Tone } from "../shared/status-badge";
import { istInputToDate } from "../trips/track-model";

/** Client checks mirroring DriverRequest / AssignRequest in the spec. Pure: unit-tested. */

export const DRIVER_TEXT_FIELDS = [
  "name",
  "licenceNo",
  "licenceClass",
  "licenceIssuedOn",
  "licenceExpiresOn",
  "icCardNo",
  "phone",
  "email",
  "address",
  "dateOfBirth",
  "emergencyContactName",
  "emergencyContactPhone",
  "hiredOn",
  "remark",
] as const;
export type DriverTextField = (typeof DRIVER_TEXT_FIELDS)[number];
export type DriverField = DriverTextField | "gender" | "status" | "userId";

export type DriverForm = Record<DriverTextField, string> & {
  /** "" = not sent. */
  gender: "" | "M" | "F" | "U";
  status: "ACTIVE" | "INACTIVE";
  /** Linked login user id as typed; "" = not sent. */
  userId: string;
};

export const EMPTY_DRIVER_FORM: DriverForm = {
  ...(Object.fromEntries(DRIVER_TEXT_FIELDS.map((f) => [f, ""])) as Record<DriverTextField, string>),
  gender: "",
  status: "ACTIVE",
  userId: "",
};

/** Max lengths from the spec (DriverRequest). Date fields are `YYYY-MM-DD`. */
export const DRIVER_MAX: Partial<Record<DriverTextField, number>> = {
  name: 150,
  licenceNo: 60,
  licenceClass: 30,
  icCardNo: 60,
  phone: 30,
  email: 320,
  address: 500,
  emergencyContactName: 150,
  emergencyContactPhone: 30,
  remark: 500,
};
const DATE_FIELDS = ["licenceIssuedOn", "licenceExpiresOn", "dateOfBirth", "hiredOn"] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;

export function isIsoDate(v: string) {
  if (!ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function driverFormFrom(d: DriverDto): DriverForm {
  const s = (v: string | undefined) => v ?? "";
  const gender = d.gender === "M" || d.gender === "F" || d.gender === "U" ? d.gender : "";
  return {
    name: s(d.name),
    licenceNo: s(d.licence?.number),
    licenceClass: s(d.licence?.licenceClass),
    licenceIssuedOn: s(d.licence?.issuedOn),
    licenceExpiresOn: s(d.licence?.expiresOn),
    icCardNo: s(d.icCardNo),
    phone: s(d.phone),
    email: s(d.email),
    address: s(d.address),
    dateOfBirth: s(d.dateOfBirth),
    emergencyContactName: s(d.emergencyContactName),
    emergencyContactPhone: s(d.emergencyContactPhone),
    hiredOn: s(d.hiredOn),
    remark: s(d.remark),
    gender,
    status: d.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
    userId: d.userId !== undefined && d.userId !== null ? String(d.userId) : "",
  };
}

export function validateDriverForm(form: DriverForm): Errors<DriverField> {
  const e: Errors<DriverField> = {};
  if (!form.name.trim()) e.name = "Name is required.";
  for (const f of DRIVER_TEXT_FIELDS) {
    const max = DRIVER_MAX[f];
    if (max !== undefined && form[f].trim().length > max && !e[f]) e[f] = `Use ${max} characters or fewer.`;
  }
  for (const f of DATE_FIELDS) if (form[f].trim() && !isIsoDate(form[f].trim())) e[f] = "Use a valid date (YYYY-MM-DD).";
  const email = form.email.trim();
  if (email && !e.email && !EMAIL_SHAPE.test(email)) e.email = "Enter a valid email address.";
  for (const f of ["phone", "emergencyContactPhone"] as const) if (form[f].trim() && !e[f] && !PHONE_PATTERN.test(form[f].trim())) e[f] = "5–30 characters: digits, spaces, +, (, ) and - only.";
  if (!e.licenceExpiresOn && !e.licenceIssuedOn && form.licenceIssuedOn && form.licenceExpiresOn && form.licenceExpiresOn < form.licenceIssuedOn) e.licenceExpiresOn = "Expiry must be on or after the issue date.";
  if (form.userId.trim() && !/^\d+$/.test(form.userId.trim())) e.userId = "Enter a numeric user id, or leave blank.";
  return e;
}

/**
 * Body for POST /drivers and PUT /drivers/{id}. Blank optional fields are omitted, so an unset
 * field is never sent as "". The spec doesn't say whether PUT clears omitted fields; edits start
 * from the stored record, so unchanged values are resent.
 */
export function driverRequestBody(form: DriverForm): DriverRequest {
  const body: DriverRequest = { name: form.name.trim(), status: form.status };
  for (const f of DRIVER_TEXT_FIELDS) {
    if (f === "name") continue;
    const v = form[f].trim();
    if (v) body[f] = v;
  }
  if (form.gender) body.gender = form.gender;
  if (form.userId.trim()) body.userId = Number(form.userId.trim());
  return body;
}

export const LICENCE_META: Record<LicenceStatus, { label: string; tone: Tone }> = {
  VALID: { label: "Valid", tone: "success" },
  EXPIRING: { label: "Expiring", tone: "warning" },
  EXPIRED: { label: "Expired", tone: "danger" },
  MISSING: { label: "Missing", tone: "neutral" },
};

/** Assignment form: a device must be chosen; `from` (optional) is an IST datetime-local value turned into ISO. */
export interface AssignForm {
  deviceId: string;
  from: string;
  replaceCurrent: boolean;
}

export function validateAssignForm(form: AssignForm): Errors<"deviceId" | "from"> {
  const e: Errors<"deviceId" | "from"> = {};
  if (!/^\d+$/.test(form.deviceId)) e.deviceId = "Choose a vehicle.";
  if (form.from && !istInputToDate(form.from)) e.from = "Enter a valid start time.";
  return e;
}

export function assignRequestBody(form: AssignForm): AssignDriverRequest {
  const body: AssignDriverRequest = { deviceId: Number(form.deviceId), replaceCurrent: form.replaceCurrent };
  const from = form.from ? istInputToDate(form.from) : null;
  if (from) body.from = from.toISOString();
  return body;
}
