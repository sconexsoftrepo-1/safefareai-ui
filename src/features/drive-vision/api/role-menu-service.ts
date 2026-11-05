import { api } from "./client";
import { toList, type ListResult } from "./fleet-service";
import type { RoleDto, RoleMenuPermissionsDto } from "./types";

/**
 * Role menu permissions (the Permission Catalogue's role grid). Not in the V10 spec: contract in
 * docs/contracts/role-menu-permission-api.txt.
 *
 * All three calls are TENANT_SCOPED on purpose (unlike role-admin-service.ts): a role's permissions belong to
 * one tenant. The API client adds X-Tenant-Id from the Safe-Fare Admin's selection; tenant users have no
 * selection, so their tenant always comes from the access token. Never pass a tenant id here.
 */
export const roleMenuService = {
  /** GET /api/v1/roles → RoleDto[] (`role.read`). */
  async listRoles(signal?: AbortSignal): Promise<ListResult<RoleDto>> {
    return toList(await api.get<RoleDto[]>("/roles", { signal }));
  },

  /** GET /api/v1/roles/{roleId}/menu-permissions (`role.permission.read`). */
  async getMatrix(roleId: number, signal?: AbortSignal): Promise<RoleMenuPermissionsDto> {
    return (await api.get<RoleMenuPermissionsDto>(`/roles/${roleId}/menu-permissions`, { signal })).data ?? {};
  },

  /** PUT /api/v1/roles/{roleId}/menu-permissions {permissionCodes} → the saved grid (`role.permission.update`). */
  async saveMatrix(roleId: number, permissionCodes: string[]): Promise<RoleMenuPermissionsDto> {
    return (await api.put<RoleMenuPermissionsDto>(`/roles/${roleId}/menu-permissions`, { permissionCodes })).data ?? {};
  },
};
