import type { CreateUserRequest, RoleDto, UpdateUserRequest, UserDetailDto, UserTreeNode } from "@/features/drive-vision/api/types";
import { LOCALE_PATTERN, PHONE_PATTERN, type Errors } from "../settings/settings-model";

/** Client checks mirroring CreateUserRequest / UpdateUserRequest / PasswordResetRequest. Pure: unit-tested. */

export type UserField = "displayName" | "email" | "phone" | "password" | "roleId" | "locale" | "timezone";
export interface UserForm {
  displayName: string;
  email: string;
  phone: string;
  /** Create only. */
  password: string;
  /** Select value; "" when nothing is chosen. */
  roleId: string;
  locale: string;
  timezone: string;
}

export const EMPTY_USER_FORM: UserForm = { displayName: "", email: "", phone: "", password: "", roleId: "", locale: "", timezone: "" };

export function userFormFrom(u: UserDetailDto): UserForm {
  return { displayName: u.displayName ?? "", email: u.email ?? "", phone: u.phone ?? "", password: "", roleId: u.role?.id !== undefined ? String(u.role.id) : "", locale: u.locale ?? "", timezone: u.timezone ?? "" };
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;

export function validateUserForm(form: UserForm, mode: "create" | "edit"): Errors<UserField> {
  const e: Errors<UserField> = {};
  const name = form.displayName.trim();
  if (!name) e.displayName = "Display name is required.";
  else if (name.length > 150) e.displayName = "Use 150 characters or fewer.";
  const email = form.email.trim();
  if (email.length > 320) e.email = "Use 320 characters or fewer.";
  else if (email && !EMAIL_SHAPE.test(email)) e.email = "Enter a valid email address.";
  if (form.phone.trim() && !PHONE_PATTERN.test(form.phone.trim())) e.phone = "5–30 characters: digits, spaces, +, (, ) and - only.";
  if (form.locale.trim() && !LOCALE_PATTERN.test(form.locale.trim())) e.locale = "Use a language code like en or en_IN.";
  if (form.timezone.trim().length > 50) e.timezone = "Use 50 characters or fewer.";
  if (!/^\d+$/.test(form.roleId)) e.roleId = "Choose a role.";
  if (mode === "create") {
    if (!form.password) e.password = "Set an initial password.";
    else if (form.password.length > 72) e.password = "Use 72 characters or fewer.";
  }
  return e;
}

/** Optional strings are sent only when non-empty, so an unset field isn't sent as "". */
function optional(form: UserForm) {
  const out: { email?: string; phone?: string; locale?: string; timezone?: string } = {};
  for (const k of ["email", "phone", "locale", "timezone"] as const) if (form[k].trim()) out[k] = form[k].trim();
  return out;
}

export function createUserBody(form: UserForm): CreateUserRequest {
  return { displayName: form.displayName.trim(), password: form.password, roleId: Number(form.roleId), ...optional(form) };
}

/**
 * PUT body. The user's current parentUserId is resent so the hierarchy doesn't change as a side
 * effect (the spec doesn't say whether omitting it clears it).
 */
export function updateUserBody(form: UserForm, current: UserDetailDto): UpdateUserRequest {
  const body: UpdateUserRequest = { displayName: form.displayName.trim(), roleId: Number(form.roleId), ...optional(form) };
  if (current.parentUserId !== undefined && current.parentUserId !== null) body.parentUserId = current.parentUserId;
  return body;
}

export function validateResetPassword(newPassword: string, confirm: string): Errors<"newPassword" | "confirm"> {
  const e: Errors<"newPassword" | "confirm"> = {};
  if (!newPassword) e.newPassword = "Enter a new password.";
  else if (newPassword.length > 72) e.newPassword = "Use 72 characters or fewer.";
  if (confirm !== newPassword) e.confirm = "Passwords don't match.";
  return e;
}

/**
 * Roles offered when creating or editing a user: `assignable !== false`. The user's current role
 * stays listed so an edit doesn't silently change it.
 */
export function roleOptions(roles: RoleDto[], currentRoleId?: number): { value: string; label: string }[] {
  return roles
    .filter((r) => r.id !== undefined && (r.assignable !== false || r.id === currentRoleId))
    .map((r) => ({ value: String(r.id), label: r.description ? `${r.code} · ${r.description}` : (r.code ?? `Role ${r.id}`) }));
}

/** Account status values the API accepts for PATCH /users/{id}/status. */
export type SettableStatus = "ACTIVE" | "DISABLED";

/** The status toggle offered for a user, or null when the current status isn't one the toggle covers (e.g. INVITED, unknown). */
export function nextStatus(status: string | undefined): SettableStatus | null {
  if (status === "ACTIVE") return "DISABLED";
  if (status === "DISABLED") return "ACTIVE";
  return null;
}

/** Flattens /users/tree for an indented list. Cycles and very deep trees are cut off. */
export function flattenTree(nodes: UserTreeNode[] | null | undefined): { node: UserTreeNode; depth: number }[] {
  const out: { node: UserTreeNode; depth: number }[] = [];
  const seen = new Set<number>();
  const visit = (list: unknown, depth: number) => {
    if (!Array.isArray(list) || depth > 20) return;
    for (const n of list as UserTreeNode[]) {
      if (!n || typeof n !== "object") continue;
      if (typeof n.id === "number") {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
      }
      out.push({ node: n, depth });
      visit(n.children, depth + 1);
    }
  };
  visit(nodes, 0);
  return out;
}
