import type { ChangePasswordRequest, CurrentUserDto, ExpiryReminderMode, PreferencesDto, UpdateMeRequest, VideoLayout } from "@/features/drive-vision/api/types";

/**
 * Client-side checks that mirror the OpenAPI constraints exactly (no extra rules — the server
 * stays authoritative and its field errors are shown as returned). Pure: unit-tested.
 */

export type Errors<K extends string> = Partial<Record<K, string>>;

export const PHONE_PATTERN = /^[+0-9 ()-]{5,30}$/;
export const LOCALE_PATTERN = /^[a-z]{2}(_[A-Z]{2})?$/;
/** Loose shape check for `format: email`; the server applies its own rule. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;

export type ProfileField = "displayName" | "email" | "phone" | "locale" | "timezone";
export const PROFILE_FIELDS: ProfileField[] = ["displayName", "email", "phone", "locale", "timezone"];
export type ProfileForm = Record<ProfileField, string>;

export function profileForm(user: CurrentUserDto | null | undefined): ProfileForm {
  return { displayName: user?.displayName ?? "", email: user?.email ?? "", phone: user?.phone ?? "", locale: user?.locale ?? "", timezone: user?.timezone ?? "" };
}

/** UpdateMeRequest constraints. Empty optional fields are allowed by the spec (minLength 0 / no pattern match needed when unchanged). */
export function validateProfile(form: ProfileForm): Errors<ProfileField> {
  const e: Errors<ProfileField> = {};
  const name = form.displayName.trim();
  if (name.length < 1) e.displayName = "Display name is required.";
  else if (name.length > 150) e.displayName = "Use 150 characters or fewer.";
  const email = form.email.trim();
  if (email.length > 320) e.email = "Use 320 characters or fewer.";
  else if (email && !EMAIL_SHAPE.test(email)) e.email = "Enter a valid email address.";
  const phone = form.phone.trim();
  if (phone && !PHONE_PATTERN.test(phone)) e.phone = "5–30 characters: digits, spaces, +, (, ) and - only.";
  const locale = form.locale.trim();
  if (locale && !LOCALE_PATTERN.test(locale)) e.locale = "Use a language code like en or en_IN.";
  if (form.timezone.trim().length > 50) e.timezone = "Use 50 characters or fewer.";
  return e;
}

/** PATCH body with only the fields that changed (trimmed). Empty when nothing changed. */
export function profilePatch(original: ProfileForm, form: ProfileForm): UpdateMeRequest {
  const patch: UpdateMeRequest = {};
  for (const f of PROFILE_FIELDS) {
    const next = form[f].trim();
    if (next !== original[f].trim()) patch[f] = next;
  }
  return patch;
}

export type PasswordField = "currentPassword" | "newPassword" | "confirmPassword";
export type PasswordForm = Record<PasswordField, string>;

/** ChangePasswordRequest: both required, each ≤ 72. No strength rule is documented, so none is invented. */
export function validatePasswordChange(form: PasswordForm): Errors<PasswordField> {
  const e: Errors<PasswordField> = {};
  if (!form.currentPassword) e.currentPassword = "Enter your current password.";
  else if (form.currentPassword.length > 72) e.currentPassword = "Use 72 characters or fewer.";
  if (!form.newPassword) e.newPassword = "Enter a new password.";
  else if (form.newPassword.length > 72) e.newPassword = "Use 72 characters or fewer.";
  else if (form.newPassword === form.currentPassword) e.newPassword = "The new password must be different from the current one.";
  if (form.confirmPassword !== form.newPassword) e.confirmPassword = "Passwords don't match.";
  return e;
}

export function passwordRequest(form: PasswordForm): ChangePasswordRequest {
  return { currentPassword: form.currentPassword, newPassword: form.newPassword };
}

// ── Server preferences ──────────────────────────────────────────────────────

export const VIDEO_LAYOUTS: VideoLayout[] = ["GRID_1", "GRID_4", "GRID_9", "GRID_16"];
export const EXPIRY_MODES: ExpiryReminderMode[] = ["NONE", "BADGE", "POPUP_AND_BADGE"];

/** Fields PUT /me/preferences requires (it replaces the whole object). */
export const REQUIRED_PREFERENCE_FIELDS = ["deviceInfoFields", "expiryReminderMode", "homeModules", "theme", "trackAlarmTypeIds", "videoLayout"] as const;

/** Required fields the loaded preferences are missing — saving would have to invent them, so it's blocked. */
export function missingRequiredPreferences(p: PreferencesDto): string[] {
  return REQUIRED_PREFERENCE_FIELDS.filter((k) => p[k] === undefined || p[k] === null);
}

export type PreferenceField = "videoLayout" | "videoAutoStopMin" | "alarmPopupCloseSec" | "alarmPopupMax" | "expiryReminderDays" | "expiryReminderMode";

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

export function validatePreferences(p: PreferencesDto): Errors<PreferenceField> {
  const e: Errors<PreferenceField> = {};
  if (p.videoLayout !== undefined && !VIDEO_LAYOUTS.includes(p.videoLayout)) e.videoLayout = "Choose a layout.";
  if (p.expiryReminderMode !== undefined && !EXPIRY_MODES.includes(p.expiryReminderMode)) e.expiryReminderMode = "Choose a reminder mode.";
  const range = (k: PreferenceField, min: number, max: number) => {
    const v = p[k];
    if (v === undefined || v === null) return;
    if (!isInt(v) || v < min || v > max) e[k] = `Whole number from ${min} to ${max}.`;
  };
  range("videoAutoStopMin", 1, 120);
  range("alarmPopupCloseSec", 0, 600);
  range("alarmPopupMax", 1, 50);
  // No range is documented for expiryReminderDays; only require a whole number.
  if (p.expiryReminderDays !== undefined && p.expiryReminderDays !== null && !isInt(p.expiryReminderDays)) e.expiryReminderDays = "Whole number of days.";
  return e;
}

/** Number input → value: "" clears to undefined, anything non-numeric stays NaN so validation flags it. */
export function parseIntInput(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  return Number(raw);
}

/** PUT body: the loaded object with edits applied; `updatedAt` is server-owned and dropped. */
export function preferencesBody(loaded: PreferencesDto, edits: PreferencesDto): PreferencesDto {
  const body: PreferencesDto = { ...loaded, ...edits };
  delete body.updatedAt;
  return body;
}

/** Reminder window for the Overview card: the server preference when it's a usable whole number, else null. */
export function reminderDaysFrom(p: PreferencesDto | undefined): number | null {
  const v = p?.expiryReminderDays;
  return isInt(v) && v > 0 ? v : null;
}
