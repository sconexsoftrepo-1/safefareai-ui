import { getTenantSelection } from "./tenant-context";

/**
 * Which requests carry the Safe-Fare Admin's selected tenant (Phase 5). Explicit, not "every request":
 *
 * - PLATFORM_WIDE — platform operations; must never be narrowed to one tenant (GET /platform/tenants,
 *   POST /platform/switch-tenant).
 * - SELF — the signed-in user's own session, profile, notifications and driver app (/auth, /me, /me/*,
 *   /notifications, /driver). Their scope is the caller, not a tenant.
 * - TENANT_SCOPED — fleet data and tenant writes (everything else). With a selection they carry the header;
 *   without one they're unscoped (platform-wide reads; creates would answer TENANT_REQUIRED, so the UI
 *   doesn't offer them). Existing-record operations are TENANT_SCOPED too: with a selection, the records on
 *   screen were loaded with the same header.
 *
 * The tenant is only ever sent as a header, never also as `?tenantId` (both disagreeing → 400 INVALID_TENANT).
 */
export type TenantScope = "PLATFORM_WIDE" | "SELF" | "TENANT_SCOPED";

const PLATFORM_WIDE = [/^\/platform(\/|$)/];
const SELF = [/^\/auth\//, /^\/me(\/|$)/, /^\/notifications(\/|$)/, /^\/driver(\/|$)/];

export function tenantScopeFor(path: string): TenantScope {
  const p = path.split("?")[0];
  if (PLATFORM_WIDE.some((r) => r.test(p))) return "PLATFORM_WIDE";
  if (SELF.some((r) => r.test(p))) return "SELF";
  return "TENANT_SCOPED";
}

/**
 * The tenant header for one request, or null. Resolved once per request so a 401 retry keeps the same
 * tenant. `none` (request option) forces no header.
 */
export function tenantHeaderFor(path: string, opts: { auth?: boolean; tenant?: "none" } = {}): { name: string; value: string } | null {
  if (opts.auth === false || opts.tenant === "none") return null;
  if (tenantScopeFor(path) !== "TENANT_SCOPED") return null;
  const s = getTenantSelection();
  return s ? { name: s.header, value: String(s.tenantId) } : null;
}
