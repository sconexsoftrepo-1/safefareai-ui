import { api } from "./client";
import { toList, type ListResult } from "./fleet-service";
import type {
  AlcoholDetectionDto,
  BusBmsDto,
  BusStopsDto,
  PassengerSummaryDto,
  RecalculateResultDto,
  SensorIngestResult,
  SensorReadingDto,
  SensorReadingInput,
  SensorReadingsQuery,
  SensorTypeDto,
  SensorWindowQuery,
  StopComparisonDto,
} from "./types";

/**
 * Sensors, stop-wise passenger counts and BMS reconciliation. Not in the V10 spec: contract from the backend
 * team, docs/contracts/passenger-counting-api.txt. `{id}` is the bus's device id. The Safe-Fare Admin's tenant
 * goes in the tenant header (api/tenant-scope.ts); another organisation's bus answers 404.
 */
export const sensorService = {
  /** GET /api/v1/sensors/types → sensor catalog. */
  async sensorTypes(signal?: AbortSignal): Promise<ListResult<SensorTypeDto>> {
    return toList(await api.get<SensorTypeDto[]>("/sensors/types", { signal }));
  },

  /** POST /api/v1/sensors/readings {readings} (1–500, all or nothing). */
  async sendReadings(readings: SensorReadingInput[]): Promise<SensorIngestResult> {
    return (await api.post<SensorIngestResult>("/sensors/readings", { readings })).data ?? {};
  },

  /** GET /api/v1/devices/{id}/sensors/readings → raw readings, newest first (paged). */
  async readings(id: number, query: SensorReadingsQuery, signal?: AbortSignal): Promise<ListResult<SensorReadingDto>> {
    return toList(await api.get<SensorReadingDto[]>(`/devices/${id}/sensors/readings`, { query: { ...query }, signal }));
  },

  /** GET /api/v1/devices/{id}/stops → stop-wise BMS + sensor passenger counts. */
  async stops(id: number, window: SensorWindowQuery, signal?: AbortSignal): Promise<BusStopsDto> {
    return (await api.get<BusStopsDto>(`/devices/${id}/stops`, { query: { ...window }, signal })).data ?? {};
  },

  /** GET /api/v1/devices/{id}/bms → original BMS records. */
  async bms(id: number, window: SensorWindowQuery, signal?: AbortSignal): Promise<BusBmsDto> {
    return (await api.get<BusBmsDto>(`/devices/${id}/bms`, { query: { ...window }, signal })).data ?? {};
  },

  /** GET /api/v1/devices/{id}/stops/comparison → sensor vs BMS reconciliation. */
  async comparison(id: number, window: SensorWindowQuery, signal?: AbortSignal): Promise<StopComparisonDto> {
    return (await api.get<StopComparisonDto>(`/devices/${id}/stops/comparison`, { query: { ...window }, signal })).data ?? {};
  },

  /** GET /api/v1/devices/{id}/passenger-summary → passenger / capacity dashboard. */
  async passengerSummary(id: number, window: SensorWindowQuery, signal?: AbortSignal): Promise<PassengerSummaryDto> {
    return (await api.get<PassengerSummaryDto>(`/devices/${id}/passenger-summary`, { query: { ...window }, signal })).data ?? {};
  },

  /** GET /api/v1/devices/{id}/sensors/alcohol → latest active alcohol reading (in the window, or ever without one). */
  async alcohol(id: number, window: SensorWindowQuery, signal?: AbortSignal): Promise<AlcoholDetectionDto> {
    return (await api.get<AlcoholDetectionDto>(`/devices/${id}/sensors/alcohol`, { query: { ...window }, signal })).data ?? {};
  },

  /** POST /api/v1/devices/{id}/stops/recalculate ?fromUtc&toUtc (no body; at most 7 days; idempotent). */
  async recalculate(id: number, window: SensorWindowQuery): Promise<RecalculateResultDto> {
    return (await api.post<RecalculateResultDto>(`/devices/${id}/stops/recalculate`, undefined, { query: { ...window } })).data ?? {};
  },
};
