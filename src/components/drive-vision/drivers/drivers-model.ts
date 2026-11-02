import type { AssignDriverRequest, AssignmentDto, DriverDto, DriverRequest, EndAssignmentRequest, LicenceStatus } from "@/features/drive-vision/api/types";
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

/**
 * Assignment form (V10 AssignRequest {deviceId*, from?, to?, replaceCurrent?}). `from` / `to` are IST
 * datetime-local values turned into ISO instants; blank = not sent (the server uses its default).
 */
export interface AssignForm {
  deviceId: string;
  from: string;
  to: string;
  replaceCurrent: boolean;
}

export const EMPTY_ASSIGN_FORM: AssignForm = { deviceId: "", from: "", to: "", replaceCurrent: false };

export function validateAssignForm(form: AssignForm): Errors<"deviceId" | "from" | "to"> {
  const e: Errors<"deviceId" | "from" | "to"> = {};
  if (!/^\d+$/.test(form.deviceId)) e.deviceId = "Choose a vehicle.";
  const from = form.from ? istInputToDate(form.from) : null;
  const to = form.to ? istInputToDate(form.to) : null;
  if (form.from && !from) e.from = "Enter a valid start time.";
  if (form.to && !to) e.to = "Enter a valid end time.";
  // Without a start, the server starts the assignment now; the end must then be in the future.
  if (to && !e.to && to.getTime() <= (from ?? new Date()).getTime()) e.to = from ? "The end must be after the start." : "The end must be in the future.";
  return e;
}

export function assignRequestBody(form: AssignForm): AssignDriverRequest {
  const body: AssignDriverRequest = { deviceId: Number(form.deviceId), replaceCurrent: form.replaceCurrent };
  const from = form.from ? istInputToDate(form.from) : null;
  const to = form.to ? istInputToDate(form.to) : null;
  if (from) body.from = from.toISOString();
  if (to) body.to = to.toISOString();
  return body;
}

/** Active assignments in a list (the server's `active` flag; never inferred from dates). */
export const activeAssignments = (list: readonly AssignmentDto[] | undefined): AssignmentDto[] => (list ?? []).filter((a) => a.active === true);

export interface AssignmentReview {
  /** Active assignments the request would affect: the driver's own and the chosen vehicle's (other drivers). */
  conflicts: AssignmentDto[];
  /** True when replaceCurrent is set and something active would be ended — needs explicit acknowledgement. */
  replaces: boolean;
  /** True when there are conflicts but replaceCurrent is off — the server is expected to refuse (409). */
  likelyRefused: boolean;
}

/**
 * What an assignment would do, from the server's own data (driver's assignments and the chosen vehicle's
 * GET /devices/{id}/driver-assignments). V10 doesn't document whether a driver may hold several vehicles or a
 * vehicle several drivers, so nothing is prevented here: conflicts are shown, replacement must be acknowledged,
 * and the server decides.
 */
export function reviewAssignment(driverActive: readonly AssignmentDto[], deviceActive: readonly AssignmentDto[], form: AssignForm, driverId: number): AssignmentReview {
  const seen = new Set<number | string>();
  const conflicts: AssignmentDto[] = [];
  for (const a of [...driverActive, ...deviceActive]) {
    const key = a.id ?? `${a.driverId}:${a.deviceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // The same driver already on the same vehicle is a conflict too (a duplicate assignment).
    if (a.driverId === driverId || String(a.deviceId) === form.deviceId) conflicts.push(a);
  }
  return { conflicts, replaces: form.replaceCurrent && conflicts.length > 0, likelyRefused: !form.replaceCurrent && conflicts.length > 0 };
}

/** End form (V10 EndAssignmentRequest {at?}): blank = the server ends it now. */
export function validateEndAt(at: string, assignment: AssignmentDto): string | null {
  if (!at) return null;
  const when = istInputToDate(at);
  if (!when) return "Enter a valid end time.";
  const from = assignment.assignedFrom ? new Date(assignment.assignedFrom) : null;
  if (from && !Number.isNaN(from.getTime()) && when.getTime() <= from.getTime()) return "The end must be after the assignment started.";
  return null;
}

export function endRequestBody(at: string): EndAssignmentRequest {
  const when = at ? istInputToDate(at) : null;
  return when ? { at: when.toISOString() } : {};
}

/**
 * The historical attribution RULE, as a reference: which assignment of `deviceId` was valid at `time`
 * (assignedFrom ≤ time < assignedTo; an open end counts as ongoing). Returns null when none — or more than
 * one — matches, or data is missing: an ambiguous answer is never turned into a driver.
 *
 * NOT used to label alarms in the UI: V10 doesn't document how AlertRow.driverId / driverName are resolved,
 * and the frontend never infers a driver for an alarm itself (Phase 8 report §9, backend dependency).
 */
export function assignmentAt(assignments: readonly AssignmentDto[], deviceId: number, time: string | Date): AssignmentDto | null {
  const t = new Date(time).getTime();
  if (Number.isNaN(t)) return null;
  const matches = assignments.filter((a) => {
    if (a.deviceId !== deviceId || !a.assignedFrom) return false;
    const from = new Date(a.assignedFrom).getTime();
    const to = a.assignedTo ? new Date(a.assignedTo).getTime() : Infinity;
    return !Number.isNaN(from) && !Number.isNaN(to) && from <= t && t < to;
  });
  return matches.length === 1 ? matches[0] : null;
}
