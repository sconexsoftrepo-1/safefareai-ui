import { api } from "./client";
import { toList, type ListResult } from "./fleet-service";
import type { CreatePermissionRequest, CreateRoleRequest, PermissionDto, RoleDto, RolePermissionsDto, UpdatePermissionRequest, UpdateRoleRequest } from "./types";

/**
 * Global role and permission administration for the Safe-Fare Admin (Phase 7; V10 role-controller).
 *
 * Every call is PLATFORM_WIDE: it is sent with `tenant: "none"`, so the Safe-Fare Admin's selected tenant
 * (Phase 5) is never attached. Global role definitions and the permission catalogue must not be narrowed
 * to — or created inside — whichever tenant happens to be selected. (The Users page keeps its own,
 * tenant-scoped reads of /roles and /permissions in admin-service.ts; that behaviour is unchanged.)
 *
 * Not used (available in V10): GET /roles/{id}, PUT /roles/{id}/permissions (full replace — deltas are used
 * instead so concurrent edits aren't overwritten), GET /roles/permission-matrix, menus and screens.
 */
const PLATFORM = { tenant: "none" } as const;

export const roleAdminService = {
  /** GET /api/v1/roles → RoleDto[] (`role.read`). */
  async listRoles(signal?: AbortSignal): Promise<ListResult<RoleDto>> {
    return toList(await api.get<RoleDto[]>("/roles", { ...PLATFORM, signal }));
  },

  /** POST /api/v1/roles {code, description} → 201 RoleDto (`role.manage`). */
  async createRole(body: CreateRoleRequest): Promise<RoleDto> {
    return (await api.post<RoleDto>("/roles", body, PLATFORM)).data ?? {};
  },

  /** PUT /api/v1/roles/{id} {description} → RoleDto (`role.manage`). */
  async updateRole(id: number, body: UpdateRoleRequest): Promise<RoleDto> {
    return (await api.put<RoleDto>(`/roles/${id}`, body, PLATFORM)).data ?? {};
  },

  /** DELETE /api/v1/roles/{id} → ApiResponseVoid (`role.manage`). */
  async deleteRole(id: number): Promise<void> {
    await api.delete<unknown>(`/roles/${id}`, PLATFORM);
  },

  /** GET /api/v1/roles/{id}/permissions → RolePermissionsDto (`role.permission.read`). */
  async rolePermissions(id: number, signal?: AbortSignal): Promise<RolePermissionsDto> {
    return (await api.get<RolePermissionsDto>(`/roles/${id}/permissions`, { ...PLATFORM, signal })).data ?? {};
  },

  /** POST /api/v1/roles/{id}/permissions {permissionCodes} → RolePermissionsDto (`role.permission.create`). */
  async addRolePermissions(id: number, permissionCodes: string[]): Promise<RolePermissionsDto> {
    return (await api.post<RolePermissionsDto>(`/roles/${id}/permissions`, { permissionCodes }, PLATFORM)).data ?? {};
  },

  /** DELETE /api/v1/roles/{id}/permissions?codes=a&codes=b → RolePermissionsDto (`role.permission.delete`). */
  async removeRolePermissions(id: number, codes: string[]): Promise<RolePermissionsDto> {
    return (await api.delete<RolePermissionsDto>(`/roles/${id}/permissions`, { ...PLATFORM, query: { codes } })).data ?? {};
  },

  /** GET /api/v1/permissions → PermissionDto[] (`role.permission.read` or `permission.manage`). */
  async listPermissions(signal?: AbortSignal): Promise<ListResult<PermissionDto>> {
    return toList(await api.get<PermissionDto[]>("/permissions", { ...PLATFORM, signal }));
  },

  /** POST /api/v1/permissions {code, description, scope} → 201 PermissionDto (`permission.manage`). */
  async createPermission(body: CreatePermissionRequest): Promise<PermissionDto> {
    return (await api.post<PermissionDto>("/permissions", body, PLATFORM)).data ?? {};
  },

  /** PUT /api/v1/permissions/{code} {description, scope} → PermissionDto (`permission.manage`). */
  async updatePermission(code: string, body: UpdatePermissionRequest): Promise<PermissionDto> {
    return (await api.put<PermissionDto>(`/permissions/${encodeURIComponent(code)}`, body, PLATFORM)).data ?? {};
  },

  /** DELETE /api/v1/permissions/{code} → ApiResponseVoid (`permission.manage`). */
  async deletePermission(code: string): Promise<void> {
    await api.delete<unknown>(`/permissions/${encodeURIComponent(code)}`, PLATFORM);
  },
};
