import type { DispatchDto, DispatchRequest, LeaveCreateRequest, LeaveType } from "@/features/drive-vision/api/types";
import { LEAVE_TYPES } from "@/features/drive-vision/api/types";
import type { Errors } from "../settings/settings-model";
import { dateToIstInput, istInputToDate } from "../trips/track-model";
import { isIsoDate } from "../drivers/drivers-model";

/**
 * Client checks mirroring DispatchRequest and LeaveRequest. Times are entered in fleet time (IST)
 * via datetime-local inputs and sent as ISO instants. Pure: unit-tested.
 */

export type DispatchField = "deviceId" | "driverId" | "title" | "origin" | "destination" | "routeNotes" | "instructions" | "reportingTime" | "scheduledStart" | "scheduledEnd";

export interface DispatchForm {
  deviceId: string;
  driverId: string;
  title: string;
  origin: string;
  destination: string;
  routeNotes: string;
  instructions: string;
  /** IST "YYYY-MM-DDTHH:mm"; "" = not sent. */
  reportingTime: string;
  scheduledStart: string;
  scheduledEnd: string;
}

export const EMPTY_DISPATCH_FORM: DispatchForm = { deviceId: "", driverId: "", title: "", origin: "", destination: "", routeNotes: "", instructions: "", reportingTime: "", scheduledStart: "", scheduledEnd: "" };

export const DISPATCH_MAX: Partial<Record<DispatchField, number>> = { title: 150, origin: 300, destination: 300, routeNotes: 1000, instructions: 1000 };

const toInput = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : dateToIstInput(d);
};

export function dispatchFormFrom(d: DispatchDto): DispatchForm {
  return {
    deviceId: d.deviceId !== undefined ? String(d.deviceId) : "",
    driverId: d.driverId !== undefined ? String(d.driverId) : "",
    title: d.title ?? "",
    origin: d.origin ?? "",
    destination: d.destination ?? "",
    routeNotes: d.routeNotes ?? "",
    instructions: d.instructions ?? "",
    reportingTime: toInput(d.reportingTime),
    scheduledStart: toInput(d.scheduledStart),
    scheduledEnd: toInput(d.scheduledEnd),
  };
}

export function validateDispatchForm(form: DispatchForm): Errors<DispatchField> {
  const e: Errors<DispatchField> = {};
  if (!/^\d+$/.test(form.deviceId)) e.deviceId = "Choose a vehicle.";
  if (!/^\d+$/.test(form.driverId)) e.driverId = "Choose a driver.";
  if (!form.title.trim()) e.title = "Title is required.";
  for (const [f, max] of Object.entries(DISPATCH_MAX) as [DispatchField, number][]) {
    if (!e[f] && (form[f] as string).trim().length > max) e[f] = `Use ${max} characters or fewer.`;
  }
  const start = istInputToDate(form.scheduledStart);
  const end = istInputToDate(form.scheduledEnd);
  if (!start) e.scheduledStart = "Choose a start time.";
  if (!end) e.scheduledEnd = "Choose an end time.";
  if (start && end && end.getTime() <= start.getTime()) e.scheduledEnd = "The end must be after the start.";
  if (form.reportingTime && !istInputToDate(form.reportingTime)) e.reportingTime = "Enter a valid time.";
  return e;
}

/** Call only after validateDispatchForm returned no errors. Blank optional fields are omitted. */
export function dispatchRequestBody(form: DispatchForm): DispatchRequest {
  const body: DispatchRequest = {
    deviceId: Number(form.deviceId),
    driverId: Number(form.driverId),
    title: form.title.trim(),
    scheduledStart: istInputToDate(form.scheduledStart)!.toISOString(),
    scheduledEnd: istInputToDate(form.scheduledEnd)!.toISOString(),
  };
  for (const f of ["origin", "destination", "routeNotes", "instructions"] as const) if (form[f].trim()) body[f] = form[f].trim();
  const reporting = form.reportingTime ? istInputToDate(form.reportingTime) : null;
  if (reporting) body.reportingTime = reporting.toISOString();
  return body;
}

export type LeaveField = "driverId" | "leaveType" | "startDate" | "endDate" | "reason";

export interface LeaveForm {
  /** Fleet form only; the driver app never sends it. */
  driverId: string;
  leaveType: LeaveType | "";
  startDate: string;
  endDate: string;
  reason: string;
}

export const EMPTY_LEAVE_FORM: LeaveForm = { driverId: "", leaveType: "", startDate: "", endDate: "", reason: "" };

export function validateLeaveForm(form: LeaveForm, opts: { requireDriver: boolean }): Errors<LeaveField> {
  const e: Errors<LeaveField> = {};
  if (opts.requireDriver && !/^\d+$/.test(form.driverId)) e.driverId = "Choose a driver.";
  if (!(LEAVE_TYPES as readonly string[]).includes(form.leaveType)) e.leaveType = "Choose a leave type.";
  if (!isIsoDate(form.startDate)) e.startDate = "Choose a start date.";
  if (!isIsoDate(form.endDate)) e.endDate = "Choose an end date.";
  if (!e.startDate && !e.endDate && form.endDate < form.startDate) e.endDate = "The end date can't be before the start date.";
  if (form.reason.trim().length > 500) e.reason = "Use 500 characters or fewer.";
  return e;
}

export function leaveRequestBody(form: LeaveForm, opts: { includeDriver: boolean }): LeaveCreateRequest {
  const body: LeaveCreateRequest = { leaveType: form.leaveType as LeaveType, startDate: form.startDate, endDate: form.endDate };
  if (opts.includeDriver) body.driverId = Number(form.driverId);
  if (form.reason.trim()) body.reason = form.reason.trim();
  return body;
}

/** A relative window around now, as ISO instants. */
export function windowAround(now: Date, pastDays: number, futureDays: number) {
  const DAY = 86_400_000;
  return { from: new Date(now.getTime() - pastDays * DAY).toISOString(), to: new Date(now.getTime() + futureDays * DAY).toISOString() };
}

/** "YYYY-MM-DD" of a date in fleet time (IST). */
export function istDate(d: Date) {
  return dateToIstInput(d).slice(0, 10);
}
