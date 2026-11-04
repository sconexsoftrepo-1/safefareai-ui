import type { LoginRequest } from "@/features/drive-vision/api/types";

/**
 * Sign-in form model (V10 LoginRequest). Pure, so the payload rules are unit-tested.
 *
 * Two account types share one form:
 * - `tenant` — tenant users: tenant code, login and password are required.
 * - `platform` — the Safe-Fare Admin: login and password only; `tenantCode` is omitted from the request
 *   (never sent as "" or null, never filled in).
 */
export type LoginMode = "tenant" | "platform";

export interface LoginForm {
  tenantCode: string;
  login: string;
  password: string;
}

export type LoginField = keyof LoginForm;
export type LoginErrors = Partial<Record<LoginField, string>>;

/** Limits from the V10 LoginRequest schema. */
export const LOGIN_MAX_LENGTH: Record<LoginField, number> = { tenantCode: 50, login: 320, password: 72 };
export const LOGIN_LABELS: Record<LoginField, string> = { tenantCode: "Tenant code", login: "Email or username", password: "Password" };

/** Fields the form shows and checks for a mode. */
export const loginFields = (mode: LoginMode): LoginField[] => (mode === "tenant" ? ["tenantCode", "login", "password"] : ["login", "password"]);

export function validateLogin(mode: LoginMode, form: LoginForm): LoginErrors {
  const errors: LoginErrors = {};
  for (const field of loginFields(mode)) {
    const value = field === "password" ? form[field] : form[field].trim();
    if (!value) errors[field] = `${LOGIN_LABELS[field]} is required.`;
    else if (value.length > LOGIN_MAX_LENGTH[field]) errors[field] = `${LOGIN_LABELS[field]} must be at most ${LOGIN_MAX_LENGTH[field]} characters.`;
  }
  return errors;
}

/**
 * The request body. `tenantCode` is present only for a tenant sign-in with a non-blank code; in every
 * other case the property is absent. The password is passed through untouched (no trimming).
 */
export function buildLoginRequest(mode: LoginMode, form: LoginForm): LoginRequest {
  const request: LoginRequest = { login: form.login.trim(), password: form.password };
  const tenantCode = form.tenantCode.trim();
  if (mode === "tenant" && tenantCode !== "") request.tenantCode = tenantCode;
  return request;
}
