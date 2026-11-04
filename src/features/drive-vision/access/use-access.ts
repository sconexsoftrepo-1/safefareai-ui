"use client";

import { useMemo } from "react";
import { useAuth } from "../store/auth-store";
import { clearTenantSelection, selectTenant, useTenantSelection, useTenantSwitchState, type SelectableTenant } from "../store/tenant-store";
import { actionBlock, canAccessPlatform, canPerform, computeAccess, type Access, type ActionKey } from "./access-policy";

/**
 * Access for the signed-in user, resolved from the GET /me/permissions identity plus, for the Safe-Fare
 * Admin, the selected tenant (Phase 5). Tenant users' tenant always comes from their identity.
 */
export function useAccess(): Access {
  // Select the stored reference (not a derived object) so useSyncExternalStore stays stable.
  const identity = useAuth((s) => s.identity);
  const selectedTenantId = useTenantSelection()?.tenantId ?? null;
  return useMemo(() => computeAccess(identity, undefined, { selectedTenantId }), [identity, selectedTenantId]);
}

/** Whether the signed-in user may perform a state-changing action (see ACTIONS in the access policy). */
export function useCan(action: ActionKey): boolean {
  return canPerform(useAccess(), action);
}

/**
 * An action's state for rendering: `allowed` → show it; `tenantBlocked` → permitted, but the Safe-Fare Admin
 * must select a tenant first (render disabled with the reason, send nothing); neither → hide it.
 */
export function useActionGate(action: ActionKey): { allowed: boolean; tenantBlocked: boolean } {
  const block = actionBlock(useAccess(), action);
  return { allowed: block === null, tenantBlocked: block === "tenant" };
}

/** The one tenant context (Phase 5). Selection is only possible for `platform === true` + `tenant.all`. */
export interface TenantContextValue {
  selectedTenantId: number | null;
  selectedTenantName: string | null;
  selectedTenantCode: string | null;
  /** Safe-Fare Admin (platform === true). */
  isPlatformUser: boolean;
  /** May select tenants (platform === true and tenant.all). */
  canSelectTenant: boolean;
  isTenantSelected: boolean;
  /** Tenant id a switch is pending for. */
  pendingTenantId: number | null;
  error: string | null;
  selectTenant: (tenant: SelectableTenant) => Promise<boolean>;
  clearTenantSelection: () => void;
}

export function useTenantContext(): TenantContextValue {
  const access = useAccess();
  const selection = useTenantSelection();
  const { pendingTenantId, error } = useTenantSwitchState();
  const canSelect = canAccessPlatform(access);
  // A selection is only meaningful for a platform identity; for anyone else it reads as "none".
  const effective = access.platform ? selection : null;
  return {
    selectedTenantId: effective?.tenantId ?? null,
    selectedTenantName: effective?.name ?? null,
    selectedTenantCode: effective?.code ?? null,
    isPlatformUser: access.platform,
    canSelectTenant: canSelect,
    isTenantSelected: effective !== null,
    pendingTenantId,
    error,
    selectTenant: (tenant) => selectTenant(access, tenant),
    clearTenantSelection,
  };
}
