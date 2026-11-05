import { api } from "./client";
import { toList, type ListResult } from "./fleet-service";
import type { AvailableVehicleQuery, VehicleDto, VehicleListQuery, VehicleRequest, VehicleRow } from "./types";

/**
 * Vehicle registry (vehicle-controller). Not in the V10 spec: contract from the backend team,
 * docs/contracts/vehicle-api.txt. Vehicles are separate from devices; a device is fitted to a vehicle
 * on the device APIs. The Safe-Fare Admin's tenant goes in the tenant header (api/tenant-scope.ts).
 */
export const vehicleRegistryService = {
  /** GET /api/v1/vehicles → list of VehicleRow, `total` = all matching rows. */
  async listVehicles(query: VehicleListQuery, signal?: AbortSignal): Promise<ListResult<VehicleRow>> {
    return toList(await api.get<VehicleRow[]>("/vehicles", { query: { ...query }, signal }));
  },

  /** GET /api/v1/vehicles/available → ACTIVE vehicles with no device fitted. */
  async listAvailableVehicles(query: AvailableVehicleQuery, signal?: AbortSignal): Promise<ListResult<VehicleRow>> {
    return toList(await api.get<VehicleRow[]>("/vehicles/available", { query: { ...query }, signal }));
  },

  /** GET /api/v1/vehicles/{id} → VehicleDto. */
  async getVehicle(id: number, signal?: AbortSignal): Promise<VehicleDto> {
    return (await api.get<VehicleDto>(`/vehicles/${id}`, { signal })).data ?? {};
  },

  /** POST /api/v1/vehicles → VehicleDto (201). */
  async createVehicle(body: VehicleRequest): Promise<VehicleDto> {
    return (await api.post<VehicleDto>("/vehicles", body)).data ?? {};
  },

  /** PUT /api/v1/vehicles/{id} → VehicleDto. Replaces every field. */
  async updateVehicle(id: number, body: VehicleRequest): Promise<VehicleDto> {
    return (await api.put<VehicleDto>(`/vehicles/${id}`, body)).data ?? {};
  },

  /** DELETE /api/v1/vehicles/{id}. Refused (409 RESOURCE_IN_USE) while a device is fitted. */
  async deleteVehicle(id: number): Promise<void> {
    await api.delete<unknown>(`/vehicles/${id}`);
  },
};
