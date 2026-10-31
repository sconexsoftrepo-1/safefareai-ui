import { api, type QueryValue } from "./client";
import { readSource, toList, type ListResult } from "./fleet-service";
import type {
  ActiveTrips,
  AlertRow,
  DashboardOverviewDto,
  DataSourceExtend,
  DeviceHealth,
  DriverScoreDto,
  GeofenceEventDto,
  GeofenceEventQuery,
  GeofenceEventSummary,
  PagedWindowQuery,
  RouteDto,
  SafetyAnalyticsDto,
  SafetySummary,
  ScoreDto,
  StatusSlice,
  TimeWindowQuery,
  TrendDay,
  TripDetailDto,
  TripDto,
  TripListQuery,
  TripSummaryDto,
  VehicleCounts,
  VehicleSummaryDto,
  VoiceDto,
} from "./types";

/** A single-object read plus the envelope's data-source metadata. */
export interface Sourced<T> {
  data: T;
  source: DataSourceExtend | null;
}

async function sourced<T>(path: string, query: Record<string, QueryValue> | undefined, signal: AbortSignal | undefined, empty: T): Promise<Sourced<T>> {
  const res = await api.get<T>(path, { query, signal });
  return { data: res.data ?? empty, source: readSource(res.extend) };
}

/**
 * Read-only aggregates computed by the BFF: dashboard, trips, safety analytics/scores,
 * vehicle summary, geofence events. Every number shown from here is the server's; the UI
 * never recomputes a score or fills a missing metric.
 */
export const insightService = {
  // ── Dashboard ──────────────────────────────────────────────────────────────

  /** GET /api/v1/dashboard/overview → ApiResponseOverviewDto (vehicles, trips, safety, health, operations in one call). */
  overview: (signal?: AbortSignal) => sourced<DashboardOverviewDto>("/dashboard/overview", undefined, signal, {}),

  /** GET /api/v1/dashboard/vehicles → ApiResponseVehicleCounts. Same block as `overview.vehicles`. */
  vehicleCounts: (signal?: AbortSignal) => sourced<VehicleCounts>("/dashboard/vehicles", undefined, signal, {}),

  /** GET /api/v1/dashboard/active-trips → ApiResponseActiveTrips. Same block as `overview.trips`. */
  activeTrips: (signal?: AbortSignal) => sourced<ActiveTrips>("/dashboard/active-trips", undefined, signal, {}),

  /** GET /api/v1/dashboard/device-health → ApiResponseDeviceHealth. Same block as `overview.health`. */
  deviceHealth: (signal?: AbortSignal) => sourced<DeviceHealth>("/dashboard/device-health", undefined, signal, {}),

  /** GET /api/v1/dashboard/safety-events {from, to} → ApiResponseSafetySummary. */
  safetyEvents: (query: TimeWindowQuery, signal?: AbortSignal) => sourced<SafetySummary>("/dashboard/safety-events", { ...query }, signal, {}),

  /** GET /api/v1/dashboard/trends {from, to} → ApiResponseListTrendDay. */
  async trends(query: TimeWindowQuery, signal?: AbortSignal): Promise<ListResult<TrendDay>> {
    return toList(await api.get<TrendDay[]>("/dashboard/trends", { query: { ...query }, signal }));
  },

  /** GET /api/v1/dashboard/fleet-status → ApiResponseListStatusSlice. */
  async fleetStatus(signal?: AbortSignal): Promise<ListResult<StatusSlice>> {
    return toList(await api.get<StatusSlice[]>("/dashboard/fleet-status", { signal }));
  },

  /** GET /api/v1/devices/{id}/summary → ApiResponseVehicleSummaryDto. */
  vehicleSummary: (id: number, signal?: AbortSignal) => sourced<VehicleSummaryDto>(`/devices/${id}/summary`, undefined, signal, {}),

  /** GET /api/v1/devices/{id}/event-markers {from, to} → ApiResponseListAlertRow. */
  async eventMarkers(id: number, query: TimeWindowQuery, signal?: AbortSignal): Promise<ListResult<AlertRow>> {
    return toList(await api.get<AlertRow[]>(`/devices/${id}/event-markers`, { query: { ...query }, signal }));
  },

  // ── Trips (read-only; the spec has no trip writes) ─────────────────────────

  /** GET /api/v1/trips → ApiResponseListTripDto. */
  async listTrips(query: TripListQuery, signal?: AbortSignal): Promise<ListResult<TripDto>> {
    return toList(await api.get<TripDto[]>("/trips", { query: { ...query }, signal }));
  },

  /** GET /api/v1/trips/summary → ApiResponseSummaryDto. */
  tripSummary: (query: Omit<TripListQuery, "pageNumber" | "pageSize">, signal?: AbortSignal) => sourced<TripSummaryDto>("/trips/summary", { ...query }, signal, {}),

  /** GET /api/v1/trips/{id} → ApiResponseTripDetailDto. */
  tripDetail: (id: number, signal?: AbortSignal) => sourced<TripDetailDto>(`/trips/${id}`, undefined, signal, {}),

  /** GET /api/v1/trips/{id}/route → ApiResponseRouteDto. `truncated` when the server cut the point list. */
  tripRoute: (id: number, signal?: AbortSignal) => sourced<RouteDto>(`/trips/${id}/route`, undefined, signal, {}),

  // ── Safety ─────────────────────────────────────────────────────────────────

  /** GET /api/v1/safety/analytics {from, to} → ApiResponseAnalyticsDto. */
  safetyAnalytics: (query: TimeWindowQuery, signal?: AbortSignal) => sourced<SafetyAnalyticsDto>("/safety/analytics", { ...query }, signal, {}),

  /** GET /api/v1/safety/scores/drivers or /vehicles → ApiResponseListScoreDto. */
  async scores(kind: "drivers" | "vehicles", query: PagedWindowQuery, signal?: AbortSignal): Promise<ListResult<ScoreDto>> {
    return toList(await api.get<ScoreDto[]>(`/safety/scores/${kind}`, { query: { ...query }, signal }));
  },

  /** GET /api/v1/drivers/{id}/safety-score {from, to} → ApiResponseDriverScoreDto. */
  driverScore: (id: number, query: TimeWindowQuery, signal?: AbortSignal) => sourced<DriverScoreDto>(`/drivers/${id}/safety-score`, { ...query }, signal, {}),

  /** GET /api/v1/drivers/{id}/safety-events → ApiResponseListAlertRow. */
  async driverSafetyEvents(id: number, query: PagedWindowQuery, signal?: AbortSignal): Promise<ListResult<AlertRow>> {
    return toList(await api.get<AlertRow[]>(`/drivers/${id}/safety-events`, { query: { ...query }, signal }));
  },

  // ── Geofence events ────────────────────────────────────────────────────────

  /** GET /api/v1/geofences/events → ApiResponseListGeofenceEventDto. */
  async geofenceEvents(query: GeofenceEventQuery, signal?: AbortSignal): Promise<ListResult<GeofenceEventDto>> {
    return toList(await api.get<GeofenceEventDto[]>("/geofences/events", { query: { ...query }, signal }));
  },

  /** GET /api/v1/geofences/events/summary → ApiResponseEventSummary. */
  geofenceEventSummary: (query: Omit<GeofenceEventQuery, "eventType" | "pageNumber" | "pageSize">, signal?: AbortSignal) =>
    sourced<GeofenceEventSummary>("/geofences/events/summary", { ...query }, signal, {}),

  /** GET /api/v1/voices/fence → ApiResponseListVoiceDto (voice prompts available to geofence rules). Read-only. */
  async fenceVoices(signal?: AbortSignal): Promise<ListResult<VoiceDto>> {
    return toList(await api.get<VoiceDto[]>("/voices/fence", { signal }));
  },
};
