import { api } from "./client";
import { isApiError } from "./errors";
import { MAX_PAGE_SIZE, collectPages, toList, type CollectedList, type ListResult } from "./fleet-service";
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

  /**
   * Every vehicle matching `query` (GET /api/v1/vehicles in pages of 100 — the spec's maximum — up to `maxPages`).
   * `truncated` is set when the server holds more than was fetched, so callers can say so instead of hiding rows.
   * Used by the device form's Assign Vehicle picker (assigned and unassigned) and the Sensors picker (assigned=true).
   */
  listAllVehicles(query: Omit<VehicleListQuery, "pageNumber" | "pageSize"> = {}, maxPages = 20, signal?: AbortSignal): Promise<CollectedList<VehicleRow>> {
    return collectPages((pageNumber) => vehicleRegistryService.listVehicles({ ...query, pageNumber, pageSize: MAX_PAGE_SIZE }, signal), maxPages);
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

  /**
   * The registered vehicle a device is fitted in, or null when none. Uses GET /vehicles/{vehicleId} when the device
   * response carries its vehicleId, otherwise searches GET /vehicles?assigned=true (pages of 100, capped) for the
   * vehicle whose device is this one. A 404 for the vehicle id means "not found", not an error.
   */
  async vehicleForDevice(deviceId: number, vehicleId?: number | null, signal?: AbortSignal): Promise<VehicleDto | null> {
    if (typeof vehicleId === "number") {
      try {
        const v = await vehicleRegistryService.getVehicle(vehicleId, signal);
        return v.device?.id === undefined || v.device?.id === null || v.device.id === deviceId ? v : null;
      } catch (err) {
        if (isApiError(err) && err.status === 404) return null;
        throw err;
      }
    }
    if (vehicleId === null) return null;
    for (let page = 1, seen = 0; page <= 20; page += 1) {
      const res = await vehicleRegistryService.listVehicles({ assigned: true, pageNumber: page, pageSize: 100 }, signal);
      const hit = res.items.find((v) => v.device?.id === deviceId);
      if (hit) return hit;
      seen += res.items.length;
      if (res.items.length === 0 || seen >= res.total) break;
    }
    return null;
  },

  /** DELETE /api/v1/vehicles/{id}. Refused (409 RESOURCE_IN_USE) while a device is fitted. */
  async deleteVehicle(id: number): Promise<void> {
    await api.delete<unknown>(`/vehicles/${id}`);
  },
};
