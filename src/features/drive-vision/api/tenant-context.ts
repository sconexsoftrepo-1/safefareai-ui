/**
 * The Safe-Fare Admin's selected tenant (Phase 5). Pure and framework-free: the API client reads it per
 * request, React reads it through useSyncExternalStore (store/tenant-store.ts).
 *
 * - In memory only: a reload or a new tab starts in platform-wide mode (no tenant), so a stale or
 *   deactivated tenant can't come back from storage. The backend doesn't persist the selection either.
 * - Only store/tenant-store.ts writes it, after POST /platform/switch-tenant succeeded for a platform
 *   admin. Tenant users never have a selection: their tenant comes from the access token.
 * - `header` is the header NAME returned by switch-tenant (V10 TenantSelectionDto.header), not a secret.
 */
export interface TenantSelection {
  tenantId: number;
  code: string | null;
  name: string | null;
  /** Header name to carry the tenant id, e.g. "X-Tenant-Id". */
  header: string;
}

/** V10 parameter name, used when switch-tenant returns no header name. */
export const DEFAULT_TENANT_HEADER = "X-Tenant-Id";

const HEADER_NAME = /^X-[A-Za-z0-9-]{1,64}$/i; // header names are case-insensitive
const FORBIDDEN_HEADERS = new Set(["authorization", "cookie", "proxy-authorization", "x-request-id"]);

/** A header name the client may set: an `X-…` token that can't overwrite credentials or correlation ids. */
export function isSafeTenantHeader(name: unknown): name is string {
  return typeof name === "string" && HEADER_NAME.test(name) && !FORBIDDEN_HEADERS.has(name.toLowerCase());
}

/** A tenant id the client may send: a positive safe integer. */
export const isTenantId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

let selection: TenantSelection | null = null;
const listeners = new Set<() => void>();

export function getTenantSelection(): TenantSelection | null {
  return selection;
}

/** Cache / query scope for the current selection: "all" (platform-wide or tenant user) or "t:<id>". */
export function tenantScopeKey(s: TenantSelection | null = selection): string {
  return s ? `t:${s.tenantId}` : "all";
}

export function subscribeTenantSelection(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const rejectedListeners = new Set<(tenantId: number, errorCode: string) => void>();

/** Notified when the server rejects the selected tenant on a request that carried it (e.g. 400 INVALID_TENANT). */
export function onTenantRejected(listener: (tenantId: number, errorCode: string) => void): () => void {
  rejectedListeners.add(listener);
  return () => {
    rejectedListeners.delete(listener);
  };
}

/** Called by the API client. Only reports a rejection of the tenant that is still selected. */
export function reportTenantRejected(tenantId: number, errorCode: string): void {
  if (selection?.tenantId === tenantId) rejectedListeners.forEach((l) => l(tenantId, errorCode));
}

/** Internal: called by the tenant store only. Rejects invalid ids / header names instead of storing them. */
export function setTenantSelection(next: TenantSelection | null): void {
  if (next !== null && (!isTenantId(next.tenantId) || !isSafeTenantHeader(next.header))) throw new Error("Invalid tenant selection");
  if (next === selection || (next && selection && next.tenantId === selection.tenantId && next.header === selection.header && next.name === selection.name && next.code === selection.code)) return;
  selection = next ? { ...next } : null;
  listeners.forEach((l) => l());
}
