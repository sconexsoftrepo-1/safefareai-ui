import { api } from "./client";
import { toList, type ListResult } from "./fleet-service";
import type {
  CreateUserRequest,
  PasswordResetRequest,
  PermissionDto,
  RoleDto,
  StatusRequest,
  UpdateUserRequest,
  UserDetailDto,
  UserListQuery,
  UserSummaryDto,
  UserTreeNode,
} from "./types";

/**
 * User and role administration (/users, /roles, /permissions). The BFF decides who may call
 * these; a 403 is shown as-is. Deleting users and editing roles are intentionally not exposed
 * yet (see docs/feature-status.md).
 */
export const adminService = {
  /** GET /api/v1/users → ApiResponseListUserSummaryDto. */
  async listUsers(query: UserListQuery, signal?: AbortSignal): Promise<ListResult<UserSummaryDto>> {
    return toList(await api.get<UserSummaryDto[]>("/users", { query: { ...query }, signal }));
  },

  /** GET /api/v1/users/{id} → ApiResponseUserDetailDto. */
  async getUser(id: number, signal?: AbortSignal): Promise<UserDetailDto> {
    return (await api.get<UserDetailDto>(`/users/${id}`, { signal })).data ?? {};
  },

  /** GET /api/v1/users/tree → ApiResponseListUserTreeNode. */
  async userTree(signal?: AbortSignal): Promise<UserTreeNode[]> {
    return (await api.get<UserTreeNode[]>("/users/tree", { signal })).data ?? [];
  },

  /** POST /api/v1/users → 201 ApiResponseUserDetailDto. */
  async createUser(body: CreateUserRequest): Promise<UserDetailDto> {
    return (await api.post<UserDetailDto>("/users", body)).data ?? {};
  },

  /** PUT /api/v1/users/{id} → ApiResponseUserDetailDto. */
  async updateUser(id: number, body: UpdateUserRequest): Promise<UserDetailDto> {
    return (await api.put<UserDetailDto>(`/users/${id}`, body)).data ?? {};
  },

  /** PATCH /api/v1/users/{id}/status → ApiResponseUserDetailDto. */
  async setStatus(id: number, body: StatusRequest): Promise<UserDetailDto> {
    return (await api.patch<UserDetailDto>(`/users/${id}/status`, body)).data ?? {};
  },

  /** POST /api/v1/users/{id}/unlock → ApiResponseUserDetailDto. */
  async unlock(id: number): Promise<UserDetailDto> {
    return (await api.post<UserDetailDto>(`/users/${id}/unlock`)).data ?? {};
  },

  /** POST /api/v1/users/{id}/password → ApiResponseVoid. */
  async resetPassword(id: number, body: PasswordResetRequest): Promise<void> {
    await api.post<unknown>(`/users/${id}/password`, body);
  },

  /** GET /api/v1/roles → ApiResponseListRoleDto. */
  async listRoles(signal?: AbortSignal): Promise<ListResult<RoleDto>> {
    return toList(await api.get<RoleDto[]>("/roles", { signal }));
  },

  /** GET /api/v1/permissions → ApiResponseListPermissionDto. */
  async listPermissions(signal?: AbortSignal): Promise<ListResult<PermissionDto>> {
    return toList(await api.get<PermissionDto[]>("/permissions", { signal }));
  },
};
