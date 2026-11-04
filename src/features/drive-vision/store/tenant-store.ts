import { useSyncExternalStore } from "react";
import { onSessionEnded } from "../api/client";
import { describeApiError, isApiError } from "../api/errors";
import { platformService } from "../api/platform-service";
import { DEFAULT_TENANT_HEADER, getTenantSelection, isSafeTenantHeader, isTenantId, onTenantRejected, setTenantSelection, subscribeTenantSelection, type TenantSelection } from "../api/tenant-context";
import { canAccessPlatform, type Access } from "../access/access-policy";

/**
 * Safe-Fare Admin tenant selection (Phase 5). One store, no second auth or permission context:
 * - the selection itself lives in api/tenant-context.ts (read by the API client per request);
 * - this module owns switching: POST /platform/switch-tenant, validate, then commit — or keep the
 *   previous selection on any failure.
 *
 * Rules: only `platform === true` + `tenant.all` may select; only ACTIVE tenants (backend rule); one switch at
 * a time per tenant, and a newer switch or a clear supersedes a pending one (its late result is dropped).
 */
export interface TenantSwitchState {
  /** Tenant id a switch is pending for (null when idle). */
  pendingTenantId: number | null;
  /** Last user-facing tenant error (failed switch, or a selection the server rejected). */
  error: string | null;
}

let switchState: TenantSwitchState = { pendingTenantId: null, error: null };
const listeners = new Set<() => void>();
let seq = 0;

function setSwitchState(patch: Partial<TenantSwitchState>) {
  switchState = { ...switchState, ...patch };
  listeners.forEach((l) => l());
}
function subscribeSwitch(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export const getTenantSwitchState = () => switchState;

/** User-facing message for a tenant-related API failure. Never includes tokens (ApiError carries none). */
export function describeTenantError(err: unknown): string {
  if (!isApiError(err)) return err instanceof Error && err.message ? err.message : "Couldn't switch tenant.";
  switch (err.errorCode) {
    case "INVALID_TENANT":
      return "This tenant can't be selected: it doesn't exist or isn't active.";
    case "TENANT_ACCESS_DENIED":
      return "Your account isn't allowed to work in this tenant.";
    case "TENANT_REQUIRED":
      return "Select a tenant first.";
  }
  if (err.kind === "http" && err.status === 403) return "Your account isn't allowed to switch tenants.";
  if (err.kind === "http" && err.status === 404) return "Tenant not found.";
  if (err.kind === "http" && err.status === 409) return err.message || "The tenant can't be selected right now.";
  return describeApiError(err);
}

export interface SelectableTenant {
  id?: number;
  code?: string;
  name?: string;
  status?: string;
}

/** Whether a listed tenant may be selected: valid id, and status ACTIVE when the server reports one. */
export function tenantSelectable(t: SelectableTenant): boolean {
  if (!isTenantId(t.id)) return false;
  return typeof t.status !== "string" || t.status.trim().toUpperCase() === "ACTIVE";
}

/**
 * Selects a tenant for the Safe-Fare Admin. Resolves true when the selection changed to `tenant`, false when
 * it was refused, superseded or ignored (duplicate click). Never changes the selection on failure.
 */
export async function selectTenant(access: Access, tenant: SelectableTenant): Promise<boolean> {
  if (!canAccessPlatform(access)) {
    setSwitchState({ error: "Only the Safe-Fare Admin can switch tenants." });
    return false;
  }
  if (!isTenantId(tenant.id)) {
    setSwitchState({ error: "This tenant has no valid id." });
    return false;
  }
  if (!tenantSelectable(tenant)) {
    setSwitchState({ error: "Only active tenants can be selected." });
    return false;
  }
  if (switchState.pendingTenantId === tenant.id) return false; // duplicate submission
  const mine = ++seq;
  setSwitchState({ pendingTenantId: tenant.id, error: null });
  try {
    const res = await platformService.switchTenant(tenant.id);
    if (mine !== seq) return false; // superseded by a newer switch or a clear
    if (res.tenantId !== tenant.id) throw new Error("The server confirmed a different tenant; the selection was not changed.");
    const header = res.header ?? DEFAULT_TENANT_HEADER;
    if (!isSafeTenantHeader(header)) throw new Error("The server returned an unusable tenant header name; the selection was not changed.");
    const next: TenantSelection = { tenantId: res.tenantId, code: res.code ?? tenant.code ?? null, name: res.name ?? tenant.name ?? null, header };
    setTenantSelection(next);
    setSwitchState({ pendingTenantId: null, error: null });
    return true;
  } catch (err) {
    if (mine === seq) setSwitchState({ pendingTenantId: null, error: describeTenantError(err) });
    return false;
  }
}

/** Back to platform-wide mode: no tenant header from now on. Cancels a pending switch. */
export function clearTenantSelection(): void {
  seq++;
  setTenantSelection(null);
  setSwitchState({ pendingTenantId: null, error: null });
}

export function dismissTenantError(): void {
  if (switchState.error) setSwitchState({ error: null });
}

if (typeof window !== "undefined") {
  // A selection never outlives the session.
  onSessionEnded(() => clearTenantSelection());
  // The server refused the selected tenant (e.g. deactivated): drop it rather than keep showing it.
  onTenantRejected(() => {
    seq++;
    setTenantSelection(null);
    setSwitchState({ pendingTenantId: null, error: "The selected tenant was rejected by the server (inactive or invalid). Showing all tenants again." });
  });
}

const serverSnapshot = () => null;

/** The selected tenant (null in platform-wide mode and for tenant users). */
export function useTenantSelection(): TenantSelection | null {
  return useSyncExternalStore(subscribeTenantSelection, getTenantSelection, serverSnapshot);
}

const idleSnapshot: TenantSwitchState = { pendingTenantId: null, error: null };
export function useTenantSwitchState(): TenantSwitchState {
  return useSyncExternalStore(subscribeSwitch, getTenantSwitchState, () => idleSnapshot);
}
