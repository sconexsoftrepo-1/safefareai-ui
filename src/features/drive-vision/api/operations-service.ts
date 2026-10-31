import { api } from "./client";
import { toList, type ListResult } from "./fleet-service";
import type {
  AssignDriverRequest,
  AssignmentDto,
  AvailabilityOverviewDto,
  ChecklistDto,
  ChecklistItem,
  ConflictDto,
  DecisionRequest,
  DispatchCheckResult,
  DispatchDto,
  DispatchListQuery,
  DispatchRequest,
  DriverDto,
  DriverListQuery,
  DriverRequest,
  EndAssignmentRequest,
  LeaveCreateRequest,
  LeaveDto,
  LeaveListQuery,
  ReasonRequest,
  ShiftDto,
  ShiftListQuery,
  SwapCreateRequest,
  SwapListQuery,
  SwapRequestDto,
  TimeWindowQuery,
  VerificationDto,
} from "./types";

/**
 * Fleet operations (driver-controller, dispatch-controller, workforce-controller). The BFF
 * decides who may call these and scopes the data; a 403 is shown as-is. Writes are only sent
 * from confirmed UI actions — never automatically.
 */
export const operationsService = {
  // ── Drivers ────────────────────────────────────────────────────────────────

  /** GET /api/v1/drivers → ApiResponseListDriverDto. */
  async listDrivers(query: DriverListQuery, signal?: AbortSignal): Promise<ListResult<DriverDto>> {
    return toList(await api.get<DriverDto[]>("/drivers", { query: { ...query }, signal }));
  },

  /** GET /api/v1/drivers/{id} → ApiResponseDriverDto. */
  async getDriver(id: number, signal?: AbortSignal): Promise<DriverDto> {
    return (await api.get<DriverDto>(`/drivers/${id}`, { signal })).data ?? {};
  },

  /** POST /api/v1/drivers → ApiResponseDriverDto. */
  async createDriver(body: DriverRequest): Promise<DriverDto> {
    return (await api.post<DriverDto>("/drivers", body)).data ?? {};
  },

  /** PUT /api/v1/drivers/{id} → ApiResponseDriverDto. */
  async updateDriver(id: number, body: DriverRequest): Promise<DriverDto> {
    return (await api.put<DriverDto>(`/drivers/${id}`, body)).data ?? {};
  },

  /** DELETE /api/v1/drivers/{id} → ApiResponseVoid. */
  async deleteDriver(id: number): Promise<void> {
    await api.delete<unknown>(`/drivers/${id}`);
  },

  /** GET /api/v1/drivers/licence-expiries {withinDays} → ApiResponseListDriverDto. */
  async licenceExpiries(withinDays: number, signal?: AbortSignal): Promise<ListResult<DriverDto>> {
    return toList(await api.get<DriverDto[]>("/drivers/licence-expiries", { query: { withinDays }, signal }));
  },

  /** GET /api/v1/drivers/{id}/assignments → ApiResponseListAssignmentDto. */
  async driverAssignments(id: number, signal?: AbortSignal): Promise<ListResult<AssignmentDto>> {
    return toList(await api.get<AssignmentDto[]>(`/drivers/${id}/assignments`, { signal }));
  },

  /** POST /api/v1/drivers/{id}/assignments → ApiResponseAssignmentDto. */
  async assignVehicle(id: number, body: AssignDriverRequest): Promise<AssignmentDto> {
    return (await api.post<AssignmentDto>(`/drivers/${id}/assignments`, body)).data ?? {};
  },

  /** POST /api/v1/drivers/{id}/assignments/{assignmentId}/end → ApiResponseAssignmentDto. */
  async endAssignment(id: number, assignmentId: number, body: EndAssignmentRequest): Promise<AssignmentDto> {
    return (await api.post<AssignmentDto>(`/drivers/${id}/assignments/${assignmentId}/end`, body)).data ?? {};
  },

  /** GET /api/v1/devices/{id}/driver-assignments → ApiResponseListAssignmentDto. */
  async deviceAssignments(deviceId: number, signal?: AbortSignal): Promise<ListResult<AssignmentDto>> {
    return toList(await api.get<AssignmentDto[]>(`/devices/${deviceId}/driver-assignments`, { signal }));
  },

  // ── Dispatch ───────────────────────────────────────────────────────────────

  /** GET /api/v1/dispatches → ApiResponseListRow. */
  async listDispatches(query: DispatchListQuery, signal?: AbortSignal): Promise<ListResult<DispatchDto>> {
    return toList(await api.get<DispatchDto[]>("/dispatches", { query: { ...query }, signal }));
  },

  /** GET /api/v1/dispatches/{id} → ApiResponseRow. */
  async getDispatch(id: number, signal?: AbortSignal): Promise<DispatchDto> {
    return (await api.get<DispatchDto>(`/dispatches/${id}`, { signal })).data ?? {};
  },

  /** POST /api/v1/dispatches → ApiResponseRow. */
  async createDispatch(body: DispatchRequest): Promise<DispatchDto> {
    return (await api.post<DispatchDto>("/dispatches", body)).data ?? {};
  },

  /** PUT /api/v1/dispatches/{id} → ApiResponseRow. */
  async updateDispatch(id: number, body: DispatchRequest): Promise<DispatchDto> {
    return (await api.put<DispatchDto>(`/dispatches/${id}`, body)).data ?? {};
  },

  /** POST /api/v1/dispatches/check → ApiResponseCheckResultDto. Read-like: validates a draft, creates nothing. */
  async checkDispatch(body: DispatchRequest): Promise<DispatchCheckResult> {
    return (await api.post<DispatchCheckResult>("/dispatches/check", body)).data ?? {};
  },

  /** POST /api/v1/dispatches/{id}/cancel → ApiResponseRow. */
  async cancelDispatch(id: number, body: ReasonRequest): Promise<DispatchDto> {
    return (await api.post<DispatchDto>(`/dispatches/${id}/cancel`, body)).data ?? {};
  },

  /** GET /api/v1/dispatches/{id}/verification → ApiResponseVerificationDto. */
  async verification(id: number, signal?: AbortSignal): Promise<VerificationDto> {
    return (await api.get<VerificationDto>(`/dispatches/${id}/verification`, { signal })).data ?? {};
  },

  /** GET /api/v1/dispatches/conflicts {from, to} → ApiResponseListConflictDto. */
  async conflicts(query: TimeWindowQuery, signal?: AbortSignal): Promise<ListResult<ConflictDto>> {
    return toList(await api.get<ConflictDto[]>("/dispatches/conflicts", { query: { ...query }, signal }));
  },

  /** POST /api/v1/dispatches/{id}/swap-requests → ApiResponseSwapRow. */
  async requestSwap(id: number, body: SwapCreateRequest): Promise<SwapRequestDto> {
    return (await api.post<SwapRequestDto>(`/dispatches/${id}/swap-requests`, body)).data ?? {};
  },

  /** GET /api/v1/swap-requests → ApiResponseListSwapRow. */
  async listSwaps(query: SwapListQuery, signal?: AbortSignal): Promise<ListResult<SwapRequestDto>> {
    return toList(await api.get<SwapRequestDto[]>("/swap-requests", { query: { ...query }, signal }));
  },

  /** POST /api/v1/swap-requests/{id}/approve or /reject → ApiResponseSwapRow. */
  async decideSwap(id: number, decision: "approve" | "reject", body: DecisionRequest): Promise<SwapRequestDto> {
    return (await api.post<SwapRequestDto>(`/swap-requests/${id}/${decision}`, body)).data ?? {};
  },

  // ── Workforce ──────────────────────────────────────────────────────────────

  /** GET /api/v1/shifts → ApiResponseListShiftDto. */
  async listShifts(query: ShiftListQuery, signal?: AbortSignal): Promise<ListResult<ShiftDto>> {
    return toList(await api.get<ShiftDto[]>("/shifts", { query: { ...query }, signal }));
  },

  /** GET /api/v1/leave-requests → ApiResponseListLeaveDto. */
  async listLeave(query: LeaveListQuery, signal?: AbortSignal): Promise<ListResult<LeaveDto>> {
    return toList(await api.get<LeaveDto[]>("/leave-requests", { query: { ...query }, signal }));
  },

  /** POST /api/v1/leave-requests → ApiResponseLeaveDto (on behalf of a driver: `driverId` set). */
  async createLeave(body: LeaveCreateRequest): Promise<LeaveDto> {
    return (await api.post<LeaveDto>("/leave-requests", body)).data ?? {};
  },

  /** POST /api/v1/leave-requests/{id}/approve or /reject → ApiResponseLeaveDto. */
  async decideLeave(id: number, decision: "approve" | "reject", body: DecisionRequest): Promise<LeaveDto> {
    return (await api.post<LeaveDto>(`/leave-requests/${id}/${decision}`, body)).data ?? {};
  },

  /** GET /api/v1/checklists → ApiResponseListChecklistDto. */
  async listChecklists(query: ShiftListQuery, signal?: AbortSignal): Promise<ListResult<ChecklistDto>> {
    return toList(await api.get<ChecklistDto[]>("/checklists", { query: { ...query }, signal }));
  },

  /** GET /api/v1/checklist-template → ApiResponseListChecklistItem. */
  async checklistTemplate(signal?: AbortSignal): Promise<ListResult<ChecklistItem>> {
    return toList(await api.get<ChecklistItem[]>("/checklist-template", { signal }));
  },

  /** GET /api/v1/drivers/availability {date: YYYY-MM-DD} → ApiResponseAvailabilityOverviewDto. */
  async availability(date: string | undefined, signal?: AbortSignal): Promise<AvailabilityOverviewDto> {
    return (await api.get<AvailabilityOverviewDto>("/drivers/availability", { query: { date }, signal })).data ?? {};
  },
};
