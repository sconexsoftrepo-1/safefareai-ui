import type { DeviceDto, DeviceModelDto, DeviceRequest } from "@/features/drive-vision/api/types";
import { isApiError } from "@/features/drive-vision/api/errors";

/**
 * Edit a device (PUT /api/v1/devices/{id}, V10 DeviceRequest — a FULL replace). Pure: unit-tested.
 *
 * Charge protection (until the backend documents its rules):
 * - The vendor mapping says a terminal-type (= V10 modelName) change "may deduct coins". The model is therefore
 *   locked and resent exactly as stored; if its name can't be resolved from the catalogue, editing is blocked.
 * - Protocol, camera count, terminal number, group (a move = transfer) and object type are also locked: they are
 *   hardware / identity / vendor-type settings whose charge and side-effect rules are undocumented.
 * - `confirmChargeableChange` is never sent.
 * Only descriptive fields are editable. Every locked field is checked again right before sending.
 */

/** Fields the user may change. */
export const EDITABLE_FIELDS = ["name", "plateColor", "simNumber", "frameNo", "remark", "insuranceDueAt", "maintenanceDueAt", "driverName", "driverCard", "driverPhone", "drivingLicense", "driverRemark"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

/** Fields resent unchanged, with the reason shown in the form. */
export const LOCKED_FIELDS: Readonly<Record<"modelName" | "protocol" | "cameraCount" | "terminalNo" | "groupId" | "objectTypeId" | "driverGender", string>> = {
  modelName: "Changing the device model may deduct vendor coins; locked until the backend confirms the charge rules.",
  protocol: "Tied to the device model and hardware; charge rules undocumented.",
  cameraCount: "Hardware configuration; charge rules undocumented.",
  terminalNo: "The device's identity at the vendor; not editable here.",
  groupId: "Moving a device to another group is a transfer, which isn't enabled.",
  objectTypeId: "Vendor vehicle type; charge rules undocumented.",
  driverGender: "Value coding undocumented; kept as stored.",
};
export type LockedField = keyof typeof LOCKED_FIELDS;

/** V10 DeviceRequest max lengths for the editable text fields. */
export const MAX_LENGTH: Readonly<Partial<Record<EditableField, number>>> = {
  name: 100,
  plateColor: 30,
  simNumber: 30,
  frameNo: 60,
  remark: 500,
  driverName: 150,
  driverCard: 60,
  driverPhone: 30,
  drivingLicense: 60,
  driverRemark: 500,
};
const DATE_FIELDS = ["insuranceDueAt", "maintenanceDueAt"] as const;
const IST_OFFSET_MS = 5.5 * 3_600_000;

export type EditForm = Record<EditableField, string>;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : null);

/** ISO instant → `YYYY-MM-DD` in IST (the app's display zone); "" when missing / invalid. */
export function isoToDateInput(iso: string | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? "" : new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` → ISO instant at 00:00 IST; null when invalid. */
export function dateInputToIso(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== v) return null;
  return new Date(t - IST_OFFSET_MS).toISOString();
}

export interface Baseline {
  /** The request that would resend the device exactly as stored (null when it can't be built safely). */
  body: DeviceRequest | null;
  /** Why editing is blocked (empty when `body` is set). */
  problems: string[];
}

/**
 * Rebuilds the full DeviceRequest from the stored device (GET /devices/{id}) so a PUT changes only what the user
 * edits. modelName comes from the model catalogue by `modelId`; any missing required value blocks editing rather
 * than sending a guess.
 */
export function baselineRequest(d: DeviceDto, models: readonly DeviceModelDto[] | undefined): Baseline {
  const problems: string[] = [];
  const groupId = int(d.groupId);
  const protocol = int(d.protocolCode);
  const objectTypeId = int(d.objectTypeId);
  const cameraCount = int(d.cameraCount);
  if (groupId === null) problems.push("The device has no group.");
  if (!str(d.terminalNo)) problems.push("The device has no terminal number.");
  if (protocol === null) problems.push("The device has no protocol.");
  if (objectTypeId === null) problems.push("The device has no object type.");
  if (cameraCount === null) problems.push("The device has no camera count.");
  let modelName: string | null = null;
  if (int(d.modelId) === null) problems.push("The device has no model id.");
  else if (!models) problems.push("The device-model catalogue couldn't be loaded, so the model can't be resent unchanged.");
  else {
    const matches = models.filter((m) => m.id === d.modelId && typeof m.name === "string" && m.name.trim() !== "");
    if (matches.length !== 1) problems.push(`Model #${d.modelId} isn't (uniquely) in the device-model catalogue, so it can't be resent unchanged.`);
    else modelName = matches[0].name!;
  }
  if (problems.length) return { body: null, problems };
  const driver = d.driver ?? {};
  const body: DeviceRequest = {
    groupId: groupId!,
    name: str(d.name),
    terminalNo: d.terminalNo!,
    modelName: modelName!,
    protocol: protocol!,
    objectTypeId: objectTypeId!,
    cameraCount: cameraCount!,
  };
  const optional: [keyof DeviceRequest, unknown][] = [
    ["plateColor", d.plateColor],
    ["simNumber", d.simNumber],
    ["remark", d.remark],
    ["frameNo", d.frameNo],
    ["insuranceDueAt", d.insuranceDueAt],
    ["maintenanceDueAt", d.maintenanceDueAt],
    ["driverName", driver.name],
    ["driverCard", driver.card],
    ["driverPhone", driver.phone],
    ["drivingLicense", driver.drivingLicense],
    ["driverRemark", driver.remark],
  ];
  for (const [k, v] of optional) if (typeof v === "string" && v !== "") (body as unknown as Record<string, unknown>)[k] = v;
  if (int(driver.gender) !== null) body.driverGender = driver.gender;
  return { body, problems: [] };
}

/** Form values from the stored device (dates as IST calendar dates). */
export function formFromDevice(d: DeviceDto): EditForm {
  const driver = d.driver ?? {};
  return {
    name: str(d.name),
    plateColor: str(d.plateColor),
    simNumber: str(d.simNumber),
    frameNo: str(d.frameNo),
    remark: str(d.remark),
    insuranceDueAt: isoToDateInput(d.insuranceDueAt),
    maintenanceDueAt: isoToDateInput(d.maintenanceDueAt),
    driverName: str(driver.name),
    driverCard: str(driver.card),
    driverPhone: str(driver.phone),
    drivingLicense: str(driver.drivingLicense),
    driverRemark: str(driver.remark),
  };
}

/** Client checks mirroring DeviceRequest (lengths, dates). A device name is required by this form. */
export function validateEdit(form: EditForm): Partial<Record<EditableField, string>> {
  const e: Partial<Record<EditableField, string>> = {};
  if (!form.name.trim()) e.name = "Enter a device name.";
  for (const f of EDITABLE_FIELDS) {
    const max = MAX_LENGTH[f];
    if (max !== undefined && form[f].trim().length > max && !e[f]) e[f] = `Use ${max} characters or fewer.`;
  }
  for (const f of DATE_FIELDS) if (form[f] && !dateInputToIso(form[f])) e[f] = "Enter a valid date.";
  return e;
}

/**
 * The PUT body: the baseline with the edited fields applied. Unchanged dates resend the stored instant exactly
 * (no time-zone drift); a cleared optional field is omitted (whether omission clears it server-side is
 * undocumented). Locked fields always come from the baseline; confirmChargeableChange is never included.
 */
export function buildUpdate(baseline: DeviceRequest, original: EditForm, form: EditForm): DeviceRequest {
  const body: DeviceRequest = { ...baseline };
  delete body.confirmChargeableChange;
  body.name = form.name.trim();
  for (const f of EDITABLE_FIELDS) {
    if (f === "name") continue;
    const k = f as keyof DeviceRequest;
    if ((DATE_FIELDS as readonly string[]).includes(f)) {
      if (form[f] === original[f]) continue; // keep the stored instant as-is
      const iso = form[f] ? dateInputToIso(form[f]) : null;
      if (iso) (body as unknown as Record<string, unknown>)[k] = iso;
      else delete (body as unknown as Record<string, unknown>)[k];
      continue;
    }
    const v = form[f].trim();
    if (v) (body as unknown as Record<string, unknown>)[k] = v;
    else delete (body as unknown as Record<string, unknown>)[k];
  }
  return body;
}

/** Locked fields that differ between the baseline and a body (must be empty before sending). */
export function lockedViolations(baseline: DeviceRequest, body: DeviceRequest): LockedField[] {
  const out = (Object.keys(LOCKED_FIELDS) as LockedField[]).filter((k) => baseline[k] !== body[k]);
  return body.confirmChargeableChange !== undefined ? [...out, "modelName"] : out;
}

/** Editable fields whose value would change (for the review list; empty = nothing to save). */
export function changedFields(baseline: DeviceRequest, body: DeviceRequest): EditableField[] {
  return EDITABLE_FIELDS.filter((f) => (baseline as unknown as Record<string, unknown>)[f] !== (body as unknown as Record<string, unknown>)[f]);
}

export type SaveOutcome = { kind: "error"; message: string; refetch: boolean; fieldErrors: Partial<Record<EditableField, string>> };

/** A user-facing outcome for a failed PUT. Never suggests retrying a chargeable change with confirmation. */
export function describeSaveError(err: unknown): SaveOutcome {
  const fieldErrors: Partial<Record<EditableField, string>> = {};
  if (isApiError(err)) {
    const map = err.fieldErrorMap();
    for (const f of EDITABLE_FIELDS) if (map[f]) fieldErrors[f] = map[f];
    const msg = err.message || "";
    switch (err.errorCode) {
      case "CHARGEABLE_CHANGE":
      case "CONFIRMATION_REQUIRED":
        return { kind: "error", refetch: true, fieldErrors, message: `The server treats this update as a chargeable change and refused it${msg ? `: ${msg}` : ""}. Nothing was confirmed or charged by the app. The device is reloaded; ask the backend team before trying again.` };
      case "VENDOR_OUTCOME_UNKNOWN":
        return { kind: "error", refetch: true, fieldErrors, message: "The vendor didn't confirm the outcome. The device is reloaded: check whether the change was applied before trying again." };
      case "TENANT_REQUIRED":
        return { kind: "error", refetch: false, fieldErrors, message: "Select a tenant first." };
    }
    if (err.kind === "http" && err.status === 404) return { kind: "error", refetch: true, fieldErrors, message: msg || "The device no longer exists in this tenant." };
    if (err.kind === "http" && (err.status === 502 || err.status === 503)) return { kind: "error", refetch: true, fieldErrors, message: `The vendor or server couldn't apply the change${msg ? `: ${msg}` : ""}.` };
    return { kind: "error", refetch: false, fieldErrors, message: msg || `The server refused the update (HTTP ${err.status}).` };
  }
  return { kind: "error", refetch: false, fieldErrors, message: err instanceof Error && err.message ? err.message : "The update failed." };
}
