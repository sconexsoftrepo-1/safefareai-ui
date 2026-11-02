import type { MyPermissionsDto } from "../api/types";

/**
 * The signed-in user's effective identity, parsed from an untrusted GET /api/v1/me/permissions
 * response (V10 `MyPermissionsDto`). This is the frontend's only source for authorisation; the
 * GET /me profile is display data. Parsing fails closed: anything missing or malformed becomes "no",
 * never "yes".
 *
 * Pure module (no React) so tests can load it directly.
 */
export interface IdentityOperation {
  operation: string;
  permissionCode: string | null;
  allowed: boolean;
}

export interface IdentityScreen {
  menuKey: string | null;
  title: string | null;
  routePath: string | null;
  icon: string | null;
  readOnly: boolean;
  operations: IdentityOperation[];
}

export interface Identity {
  userId: number | null;
  /** True only when the server sends `platform: true` (the Safe-Fare Admin). Anything else is false. */
  platform: boolean;
  homeTenantId: number | null;
  /** The tenant the caller currently works in; null for the Safe-Fare Admin until one is selected. */
  tenantId: number | null;
  roleId: number | null;
  /** Exact role code; display and narrowing only — never a grant on its own. */
  roleCode: string | null;
  permissions: ReadonlySet<string>;
  screens: readonly IdentityScreen[];
}

const MAX_SCREENS = 500;
const MAX_OPERATIONS = 100;

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const id = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);

/** Exact, non-empty string codes; anything else (non-arrays, numbers, objects, "") is dropped. */
export function readCodes(raw: unknown): Set<string> {
  return new Set(Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string" && p !== "") : []);
}

function readOperations(raw: unknown): IdentityOperation[] {
  if (!Array.isArray(raw)) return [];
  const out: IdentityOperation[] = [];
  for (const o of raw.slice(0, MAX_OPERATIONS)) {
    if (!isObject(o)) continue;
    const operation = str(o.operation);
    if (!operation) continue;
    // Only an explicit `allowed: true` allows; the frontend never treats a missing flag as permission.
    out.push({ operation, permissionCode: str(o.permissionCode), allowed: o.allowed === true });
  }
  return out;
}

function readScreens(raw: unknown): IdentityScreen[] {
  if (!Array.isArray(raw)) return [];
  const out: IdentityScreen[] = [];
  for (const s of raw.slice(0, MAX_SCREENS)) {
    if (!isObject(s)) continue;
    out.push({
      menuKey: str(s.menuKey),
      title: typeof s.title === "string" && s.title.trim() ? s.title.trim() : null,
      routePath: str(s.routePath),
      icon: str(s.icon),
      // `readOnly: true` removes the screen's write actions. Absent means "not flagged", which can't
      // widen access: every write action still needs its own permission code.
      readOnly: s.readOnly === true,
      operations: readOperations(s.operations),
    });
  }
  return out;
}

/** Parses GET /me/permissions `data`; null when it isn't an object (no identity → no access). */
export function readIdentity(raw: MyPermissionsDto | unknown): Identity | null {
  if (!isObject(raw)) return null;
  return {
    userId: id(raw.userId),
    platform: raw.platform === true,
    homeTenantId: id(raw.homeTenantId),
    tenantId: id(raw.tenantId),
    roleId: id(raw.roleId),
    roleCode: str(raw.roleCode),
    permissions: readCodes(raw.permissions),
    screens: readScreens(raw.screens),
  };
}

/**
 * How the UI describes the user. Derived, never a grant:
 * - `platform-admin` — Safe-Fare Admin: `platform === true` (whatever the role code).
 * - `tenant-admin`   — `platform === false` and role code exactly `ADMIN`.
 * - `driver`         — not platform, role code exactly `DRIVER` (confirmed live 2026-10-29).
 * - `tenant-user`    — any other signed-in identity (Fleet Owner, Dispatcher, Viewer, …).
 * - `none`           — no usable identity.
 */
export type IdentityKind = "platform-admin" | "tenant-admin" | "driver" | "tenant-user" | "none";

export const ADMIN_ROLE_CODE = "ADMIN";
export const DRIVER_ROLE_CODE = "DRIVER";

export function identityKind(identity: Identity | null): IdentityKind {
  if (!identity) return "none";
  if (identity.platform) return "platform-admin";
  if (identity.roleCode === ADMIN_ROLE_CODE) return "tenant-admin";
  if (identity.roleCode === DRIVER_ROLE_CODE) return "driver";
  return "tenant-user";
}

export const IDENTITY_KIND_LABELS: Record<IdentityKind, string> = {
  "platform-admin": "Safe-Fare Admin",
  "tenant-admin": "Tenant administrator",
  driver: "Driver",
  "tenant-user": "Tenant user",
  none: "No identity",
};
