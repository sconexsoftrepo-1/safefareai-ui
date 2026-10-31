import { api } from "./client";
import { toList, type ListResult } from "./fleet-service";
import type {
  AlertRow,
  AssignmentOverviewDto,
  ChecklistDto,
  ChecklistItem,
  ChecklistRequest,
  DispatchDto,
  DispatchListQuery,
  DriverContactRequest,
  DriverDto,
  DriverScoreDto,
  LeaveCreateRequest,
  LeaveDto,
  PagedWindowQuery,
  ReasonRequest,
  ShiftDto,
  ShiftEndRequest,
  ShiftHistoryDto,
  ShiftStartRequest,
  SwapCreateRequest,
  SwapRequestDto,
  TimeWindowQuery,
} from "./types";

/** Driver dispatch transitions with no request body. */
export type DriverDispatchAction = "accept" | "start" | "complete";

/**
 * Driver self-service (/driver/*, driver-app-controller). The server resolves "me" from the
 * bearer token; the frontend never passes a driver id here. Only reachable from the My Work
 * screen, which the access policy grants to the Driver app role only.
 */
export const driverAppService = {
  /** GET /api/v1/driver/me → ApiResponseDriverDto. */
  async me(signal?: AbortSignal): Promise<DriverDto> {
    return (await api.get<DriverDto>("/driver/me", { signal })).data ?? {};
  },

  /** PATCH /api/v1/driver/me → ApiResponseDriverDto (contact details only). */
  async updateContact(body: DriverContactRequest): Promise<DriverDto> {
    return (await api.patch<DriverDto>("/driver/me", body)).data ?? {};
  },

  /** GET /api/v1/driver/assignment → ApiResponseAssignmentOverviewDto. */
  async assignment(signal?: AbortSignal): Promise<AssignmentOverviewDto> {
    return (await api.get<AssignmentOverviewDto>("/driver/assignment", { signal })).data ?? {};
  },

  /** GET /api/v1/driver/dispatches → ApiResponseListRow. */
  async dispatches(query: Omit<DispatchListQuery, "driverId" | "deviceId">, signal?: AbortSignal): Promise<ListResult<DispatchDto>> {
    return toList(await api.get<DispatchDto[]>("/driver/dispatches", { query: { ...query }, signal }));
  },

  /** GET /api/v1/driver/dispatches/{id} → ApiResponseRow. */
  async dispatch(id: number, signal?: AbortSignal): Promise<DispatchDto> {
    return (await api.get<DispatchDto>(`/driver/dispatches/${id}`, { signal })).data ?? {};
  },

  /** POST /api/v1/driver/dispatches/{id}/accept | start | complete → ApiResponseRow. */
  async dispatchAction(id: number, action: DriverDispatchAction): Promise<DispatchDto> {
    return (await api.post<DispatchDto>(`/driver/dispatches/${id}/${action}`)).data ?? {};
  },

  /** POST /api/v1/driver/dispatches/{id}/decline → ApiResponseRow. */
  async decline(id: number, body: ReasonRequest): Promise<DispatchDto> {
    return (await api.post<DispatchDto>(`/driver/dispatches/${id}/decline`, body)).data ?? {};
  },

  /** POST /api/v1/driver/dispatches/{id}/swap-requests → ApiResponseSwapRow. */
  async requestSwap(id: number, body: SwapCreateRequest): Promise<SwapRequestDto> {
    return (await api.post<SwapRequestDto>(`/driver/dispatches/${id}/swap-requests`, body)).data ?? {};
  },

  /** GET /api/v1/driver/shifts/current → ApiResponseShiftDto (empty data when no shift is open). */
  async currentShift(signal?: AbortSignal): Promise<ShiftDto | null> {
    const data = (await api.get<ShiftDto | null>("/driver/shifts/current", { signal })).data;
    return data && typeof data === "object" && data.id !== undefined ? data : null;
  },

  /** POST /api/v1/driver/shifts/start → ApiResponseShiftDto. */
  async startShift(body: ShiftStartRequest): Promise<ShiftDto> {
    return (await api.post<ShiftDto>("/driver/shifts/start", body)).data ?? {};
  },

  /** POST /api/v1/driver/shifts/end → ApiResponseShiftDto. */
  async endShift(body: ShiftEndRequest): Promise<ShiftDto> {
    return (await api.post<ShiftDto>("/driver/shifts/end", body)).data ?? {};
  },

  /** GET /api/v1/driver/working-hours {from, to} → ApiResponseShiftHistoryDto. */
  async workingHours(query: TimeWindowQuery, signal?: AbortSignal): Promise<ShiftHistoryDto> {
    return (await api.get<ShiftHistoryDto>("/driver/working-hours", { query: { ...query }, signal })).data ?? {};
  },

  /** GET /api/v1/driver/leave-requests → ApiResponseListLeaveDto. */
  async leave(query: { status?: string; pageNumber?: number; pageSize?: number }, signal?: AbortSignal): Promise<ListResult<LeaveDto>> {
    return toList(await api.get<LeaveDto[]>("/driver/leave-requests", { query: { ...query }, signal }));
  },

  /** POST /api/v1/driver/leave-requests → ApiResponseLeaveDto. `driverId` is never sent here. */
  async requestLeave(body: Omit<LeaveCreateRequest, "driverId">): Promise<LeaveDto> {
    return (await api.post<LeaveDto>("/driver/leave-requests", body)).data ?? {};
  },

  /** POST /api/v1/driver/leave-requests/{id}/cancel → ApiResponseLeaveDto. */
  async cancelLeave(id: number): Promise<LeaveDto> {
    return (await api.post<LeaveDto>(`/driver/leave-requests/${id}/cancel`)).data ?? {};
  },

  /** GET /api/v1/driver/checklist-template → ApiResponseListChecklistItem. */
  async checklistTemplate(signal?: AbortSignal): Promise<ListResult<ChecklistItem>> {
    return toList(await api.get<ChecklistItem[]>("/driver/checklist-template", { signal }));
  },

  /** GET /api/v1/driver/checklists → ApiResponseListChecklistDto. */
  async checklists(query: PagedWindowQuery, signal?: AbortSignal): Promise<ListResult<ChecklistDto>> {
    return toList(await api.get<ChecklistDto[]>("/driver/checklists", { query: { ...query }, signal }));
  },

  /** POST /api/v1/driver/checklists → ApiResponseChecklistDto. */
  async submitChecklist(body: ChecklistRequest): Promise<ChecklistDto> {
    return (await api.post<ChecklistDto>("/driver/checklists", body)).data ?? {};
  },

  /** GET /api/v1/driver/safety-score {from, to} → ApiResponseDriverScoreDto. */
  async safetyScore(query: TimeWindowQuery, signal?: AbortSignal): Promise<DriverScoreDto> {
    return (await api.get<DriverScoreDto>("/driver/safety-score", { query: { ...query }, signal })).data ?? {};
  },

  /** GET /api/v1/driver/safety-events → ApiResponseListAlertRow. */
  async safetyEvents(query: PagedWindowQuery, signal?: AbortSignal): Promise<ListResult<AlertRow>> {
    return toList(await api.get<AlertRow[]>("/driver/safety-events", { query: { ...query }, signal }));
  },
};
