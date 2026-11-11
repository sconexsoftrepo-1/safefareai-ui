import type { Access } from "./access-policy";

/**
 * Who may use Vehicle and Tyre Maintenance (the Vehicles drawer tabs and the Notifications Maintenance tab), and in
 * which tenant. Pure: shared by the UI and the same-origin proxy (app/api/maintenance), which decides on the
 * server from the identity the BFF verified.
 *
 * Product rule (2026-11-10): the Safe-Fare Admin and the Fleet Owner, nobody else for now. The V10 spec has no
 * maintenance permission code, so this narrows by identity rather than granting by permission:
 * - Safe-Fare Admin: `platform === true` (never the role code).
 * - Fleet Owner: not platform, not a driver login, and a role code in FLEET_OWNER_ROLE_CODES. The backend has not
 *   confirmed the Fleet Owner role code (docs/feature-status.md, Q1); the two spellings used in this codebase are
 *   accepted ("FLEET_OWNER", and "FLEET OWNER" from the landing tests) after normalising case, spaces and hyphens.
 *   Add the real code here once confirmed. Drivers, tenant ADMINs and every other tenant role are excluded.
 *
 * The Python service makes its own decision as well: a refusal it sends is shown, never bypassed.
 */
export type MaintenanceRole = "safe-fare-admin" | "fleet-owner";

export const FLEET_OWNER_ROLE_CODES: ReadonlySet<string> = new Set(["FLEET_OWNER"]);

const normaliseRoleCode = (code: string) => code.trim().toUpperCase().replace(/[\s-]+/g, "_");

export function maintenanceRole(access: Pick<Access, "identity" | "platform" | "kind" | "roleCode">): MaintenanceRole | null {
  if (!access.identity) return null;
  if (access.platform) return "safe-fare-admin";
  if (access.kind === "driver") return null;
  return access.roleCode && FLEET_OWNER_ROLE_CODES.has(normaliseRoleCode(access.roleCode)) ? "fleet-owner" : null;
}

export const canUseMaintenance = (access: Pick<Access, "identity" | "platform" | "kind" | "roleCode">) => maintenanceRole(access) !== null;

/**
 * The tenant maintenance requests run in, or why there is none:
 * - Fleet Owner: always the tenant in their own token (`access.tenantId`; a frontend selection is ignored).
 * - Safe-Fare Admin: the selected tenant. Maintenance data is per tenant, so platform-wide mode has none.
 */
export type MaintenanceTenant = { ok: true; tenantId: number } | { ok: false; reason: "forbidden" | "tenant_required" | "no_tenant" };

export function maintenanceTenant(access: Pick<Access, "identity" | "platform" | "kind" | "roleCode" | "tenantId">): MaintenanceTenant {
  const role = maintenanceRole(access);
  if (!role) return { ok: false, reason: "forbidden" };
  const id = access.tenantId;
  if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) return { ok: true, tenantId: id };
  return { ok: false, reason: role === "safe-fare-admin" ? "tenant_required" : "no_tenant" };
}

/**
 * Which maintenance actions the UI offers. Everything the backend contract gives Admin / Fleet Owner:
 * - Create schedule: Swagger says Fleet Owner only. The Admin is offered it too (product request); if the Python
 *   service refuses, its 403 is shown as is.
 * - Tyre register / complete replacement: both roles.
 * - Postpone / complete vehicle maintenance: driver-only in the contract, so never offered here (and not proxied).
 */
export function maintenanceActions(access: Pick<Access, "identity" | "platform" | "kind" | "roleCode" | "tenantId">) {
  const tenant = maintenanceTenant(access);
  return { createSchedule: tenant.ok, registerTyres: tenant.ok, completeTyreReplacement: tenant.ok, postpone: false, completeMaintenance: false } as const;
}
