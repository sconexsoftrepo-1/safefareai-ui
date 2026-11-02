import { api } from "./client";
import { toList, type ListResult } from "./fleet-service";
import type { CreateTenantRequest, CreatedTenantDto, TenantDto, TenantSelectionDto } from "./types";

/**
 * Safe-Fare Admin platform operations (V10 platform-controller), through the shared client (same session,
 * refresh and retry). Both are PLATFORM_WIDE: they never carry the selected tenant header.
 */
export const platformService = {
  /** GET /api/v1/platform/tenants → ApiResponseListTenantDto (`tenant.all`). Not paged: `total` = every tenant. */
  async tenants(signal?: AbortSignal): Promise<ListResult<TenantDto>> {
    return toList(await api.get<TenantDto[]>("/platform/tenants", { signal }));
  },

  /**
   * POST /api/v1/platform/tenants {CreateTenantRequest} → CreatedTenantDto. NOT in the V10 spec: contract from
   * the backend team (observed 201 response). PLATFORM_WIDE: sent without a tenant header even when a tenant is
   * selected. Never retried automatically (a create isn't idempotent).
   */
  async createTenant(body: CreateTenantRequest, signal?: AbortSignal): Promise<CreatedTenantDto> {
    const res = await api.post<CreatedTenantDto>("/platform/tenants", body, { signal, tenant: "none" });
    return res.data ?? {};
  },

  /**
   * POST /api/v1/platform/switch-tenant {tenantId} → TenantSelectionDto {tenantId, code, name, header}
   * (`tenant.all`). Validates the tenant (exists, ACTIVE) and returns the header NAME to send it in. No new
   * token, no server-side session change. Sent without any tenant header (PLATFORM_WIDE).
   */
  async switchTenant(tenantId: number, signal?: AbortSignal): Promise<TenantSelectionDto> {
    const res = await api.post<TenantSelectionDto>("/platform/switch-tenant", { tenantId }, { signal, tenant: "none" });
    return res.data ?? {};
  },
};
