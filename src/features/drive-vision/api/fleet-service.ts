import { api } from "./client";
import type {
  ActivityDto,
  CommandDefinitionDto,
  CommandDto,
  CommandListQuery,
  ExportDto,
  ExportRequest,
  GeofenceDto,
  MediaDto,
  MileageDto,
  RecordingDto,
  ReportQuery,
  AlarmDto,
  AlarmListQuery,
  AlarmTypeDto,
  ApiResponse,
  DataSourceExtend,
  DeviceDto,
  DeviceListQuery,
  DeviceModelDto,
  GroupDto,
  ObjectTypeDto,
  ProtocolDto,
  RealtimeDto,
  TrackDto,
  TrackQuery,
} from "./types";

/** A list page plus the envelope's `total` and data-source metadata. */
export interface ListResult<T> {
  items: T[];
  total: number;
  source: DataSourceExtend | null;
}

/** All pages of a paged list, up to a cap. `truncated` when the server holds more than was fetched. */
export interface CollectedList<T> extends ListResult<T> {
  truncated: boolean;
}

export function readSource(extend: unknown): DataSourceExtend | null {
  if (!extend || typeof extend !== "object" || !("source" in extend)) return null;
  const e = extend as Record<string, unknown>;
  return {
    source: typeof e.source === "string" ? e.source : undefined,
    stale: typeof e.stale === "boolean" ? e.stale : null,
    fallbackReason: typeof e.fallbackReason === "string" ? e.fallbackReason : null,
    syncedAt: typeof e.syncedAt === "string" ? e.syncedAt : null,
  };
}

export function toList<T>(res: ApiResponse<T[]>): ListResult<T> {
  const items = res.data ?? [];
  return { items, total: res.total ?? items.length, source: readSource(res.extend) };
}

/** Max page size allowed by the spec for paged lists. */
const MAX_PAGE_SIZE = 100;

async function collectPages<T>(fetchPage: (pageNumber: number) => Promise<ListResult<T>>, maxPages: number): Promise<CollectedList<T>> {
  const first = await fetchPage(1);
  const items = [...first.items];
  let page = 1;
  while (items.length < first.total && page < maxPages) {
    page += 1;
    const next = await fetchPage(page);
    if (next.items.length === 0) break;
    items.push(...next.items);
  }
  return { items, total: first.total, source: first.source, truncated: items.length < first.total };
}

export const fleetService = {
  /** GET /api/v1/groups → ApiResponseListGroupDto. */
  async listGroups(signal?: AbortSignal): Promise<ListResult<GroupDto>> {
    return toList(await api.get<GroupDto[]>("/groups", { signal }));
  },

  /** GET /api/v1/devices → ApiResponseListDeviceDto. */
  async listDevices(query: DeviceListQuery = {}, signal?: AbortSignal): Promise<ListResult<DeviceDto>> {
    return toList(await api.get<DeviceDto[]>("/devices", { query: { ...query }, signal }));
  },

  /** Every device the user can see (pages of 100, capped). */
  listAllDevices(query: Omit<DeviceListQuery, "pageNumber" | "pageSize"> = {}, maxPages = 20): Promise<CollectedList<DeviceDto>> {
    return collectPages((pageNumber) => fleetService.listDevices({ ...query, pageNumber, pageSize: MAX_PAGE_SIZE }), maxPages);
  },

  /** GET /api/v1/devices/{id} → ApiResponseDeviceDto. 404 NOT_FOUND for unknown ids. */
  async getDevice(id: number, signal?: AbortSignal): Promise<{ data: DeviceDto; source: DataSourceExtend | null }> {
    const res = await api.get<DeviceDto>(`/devices/${id}`, { signal });
    return { data: res.data ?? {}, source: readSource(res.extend) };
  },

  /** GET /api/v1/devices/{id}/track → ApiResponseTrackDto. */
  async track(id: number, query: TrackQuery, signal?: AbortSignal): Promise<{ data: TrackDto; source: DataSourceExtend | null }> {
    const res = await api.get<TrackDto>(`/devices/${id}/track`, { query: { ...query }, signal });
    return { data: res.data ?? {}, source: readSource(res.extend) };
  },

  /** GET /api/v1/monitor/realtime → ApiResponseRealtimeDto. Omit deviceIds for all devices. */
  async realtime(deviceIds?: number[], signal?: AbortSignal): Promise<{ data: RealtimeDto; source: DataSourceExtend | null }> {
    const res = await api.get<RealtimeDto>("/monitor/realtime", { query: { deviceIds }, signal });
    return { data: res.data ?? {}, source: readSource(res.extend) };
  },

  /** GET /api/v1/alarms/routine → ApiResponseListAlarmDto. */
  async routineAlarms(query: AlarmListQuery, signal?: AbortSignal): Promise<ListResult<AlarmDto>> {
    return toList(await api.get<AlarmDto[]>("/alarms/routine", { query: { ...query }, signal }));
  },

  /** GET /api/v1/alarms/ai → ApiResponseListAlarmDto. */
  async aiAlarms(query: AlarmListQuery, signal?: AbortSignal): Promise<ListResult<AlarmDto>> {
    return toList(await api.get<AlarmDto[]>("/alarms/ai", { query: { ...query }, signal }));
  },

  /** All alarms of one kind in a time window (pages of 100, capped). */
  listAllAlarms(kind: "routine" | "ai", query: Omit<AlarmListQuery, "pageNumber" | "pageSize">, maxPages = 5): Promise<CollectedList<AlarmDto>> {
    const fetchPage = kind === "ai" ? fleetService.aiAlarms : fleetService.routineAlarms;
    return collectPages((pageNumber) => fetchPage({ ...query, pageNumber, pageSize: MAX_PAGE_SIZE }), maxPages);
  },

  /** GET /api/v1/reference/device-models → ApiResponseListDeviceModelDto. */
  async deviceModels(signal?: AbortSignal): Promise<ListResult<DeviceModelDto>> {
    return toList(await api.get<DeviceModelDto[]>("/reference/device-models", { signal }));
  },

  /** GET /api/v1/reference/protocols → ApiResponseListProtocolDto. */
  async protocols(signal?: AbortSignal): Promise<ListResult<ProtocolDto>> {
    return toList(await api.get<ProtocolDto[]>("/reference/protocols", { signal }));
  },

  /** GET /api/v1/reference/object-types → ApiResponseListObjectTypeDto. */
  async objectTypes(query: { category?: number } = {}, signal?: AbortSignal): Promise<ListResult<ObjectTypeDto>> {
    return toList(await api.get<ObjectTypeDto[]>("/reference/object-types", { query, signal }));
  },

  /** GET /api/v1/reference/alarm-types → ApiResponseListAlarmTypeDto. */
  async alarmTypes(query: { category?: number; active?: boolean } = {}, signal?: AbortSignal): Promise<ListResult<AlarmTypeDto>> {
    return toList(await api.get<AlarmTypeDto[]>("/reference/alarm-types", { query, signal }));
  },

  // ── Geofences ──────────────────────────────────────────────────────────────

  /** GET /api/v1/geofences → ApiResponseListGeofenceDto. Not paged. */
  async listGeofences(query: { shape?: "AREA" | "LINE"; name?: string } = {}, signal?: AbortSignal): Promise<ListResult<GeofenceDto>> {
    return toList(await api.get<GeofenceDto[]>("/geofences", { query, signal }));
  },

  /** DELETE /api/v1/geofences/{id} → ApiResponseVoid. */
  async deleteGeofence(id: number): Promise<void> {
    await api.delete<unknown>(`/geofences/${id}`);
  },

  // ── Reports ────────────────────────────────────────────────────────────────

  /** GET /api/v1/reports/mileage → ApiResponseListMileageDto. No paging parameters. */
  async mileageReport(query: Omit<ReportQuery, "pageNumber" | "pageSize">, signal?: AbortSignal): Promise<ListResult<MileageDto>> {
    return toList(await api.get<MileageDto[]>("/reports/mileage", { query: { ...query }, signal }));
  },

  /** GET /api/v1/reports/driving or /parking → ApiResponseListActivityDto. */
  async activityReport(kind: "driving" | "parking", query: ReportQuery, signal?: AbortSignal): Promise<ListResult<ActivityDto>> {
    return toList(await api.get<ActivityDto[]>(`/reports/${kind}`, { query: { ...query }, signal }));
  },

  /** GET /api/v1/reports/media → ApiResponseListMediaDto. `mediaType` codes are undocumented, so it isn't sent. */
  async mediaReport(query: ReportQuery, signal?: AbortSignal): Promise<ListResult<MediaDto>> {
    return toList(await api.get<MediaDto[]>("/reports/media", { query: { ...query }, signal }));
  },

  // ── Video ──────────────────────────────────────────────────────────────────

  /** GET /api/v1/devices/{id}/recording-calendar {month} → ApiResponseListInteger. `month` format is undocumented (sent as YYYY-MM). */
  async recordingCalendar(id: number, month: string, signal?: AbortSignal): Promise<ListResult<number>> {
    return toList(await api.get<number[]>(`/devices/${id}/recording-calendar`, { query: { month }, signal }));
  },

  /** GET /api/v1/devices/{id}/recordings {from, to, channel?} → ApiResponseListRecordingDto. */
  async recordings(id: number, query: { from: string; to: string; channel?: number }, signal?: AbortSignal): Promise<ListResult<RecordingDto>> {
    return toList(await api.get<RecordingDto[]>(`/devices/${id}/recordings`, { query: { ...query }, signal }));
  },

  /** GET /api/v1/video/exports {deviceId?, pageNumber, pageSize} → ApiResponseListExportDto. */
  async listExports(query: { deviceId?: number; pageNumber?: number; pageSize?: number }, signal?: AbortSignal): Promise<ListResult<ExportDto>> {
    return toList(await api.get<ExportDto[]>("/video/exports", { query: { ...query }, signal }));
  },

  /** POST /api/v1/video/exports → ApiResponseExportDto. Starts a vendor clip job. */
  async requestExport(body: ExportRequest): Promise<ExportDto> {
    return (await api.post<ExportDto>("/video/exports", body)).data ?? {};
  },

  // ── Commands (read-only) ───────────────────────────────────────────────────

  /** GET /api/v1/commands/types → ApiResponseListDefinition. */
  async commandTypes(signal?: AbortSignal): Promise<ListResult<CommandDefinitionDto>> {
    return toList(await api.get<CommandDefinitionDto[]>("/commands/types", { signal }));
  },

  /** GET /api/v1/commands → ApiResponseListCommandDto. */
  async listCommands(query: CommandListQuery, signal?: AbortSignal): Promise<ListResult<CommandDto>> {
    return toList(await api.get<CommandDto[]>("/commands", { query: { ...query }, signal }));
  },

  /** GET /api/v1/commands/{id} → ApiResponseCommandDto. `refresh` (undocumented, may poll the vendor) is never sent. */
  async getCommand(id: number, signal?: AbortSignal): Promise<CommandDto> {
    return (await api.get<CommandDto>(`/commands/${id}`, { signal })).data ?? {};
  },
};
