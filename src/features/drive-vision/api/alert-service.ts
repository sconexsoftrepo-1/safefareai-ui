import { api } from "./client";
import { toList, type ListResult } from "./fleet-service";
import type {
  ActionRow,
  AlertDetailDto,
  AlertListQuery,
  AlertRow,
  CommentRequest,
  EvidenceRow,
  NoteRequest,
  NotificationDto,
  NotificationListQuery,
  ResolveRequest,
} from "./types";

/** Handling actions with a `NoteRequest` body. */
export type AlertNoteAction = "acknowledge" | "dismiss" | "reopen";

/**
 * Alert handling (alert-controller) and the notification feed (notification-controller).
 * Every action returns the alert as the server now has it; the UI shows that, never a locally
 * assumed status. POST /alerts/{id}/assign is deliberately absent: its documented body is the
 * driver-assignment schema (deviceId, no assignee), so a correct request can't be built.
 */
export const alertService = {
  /** GET /api/v1/alerts → ApiResponseListAlertRow. */
  async listAlerts(query: AlertListQuery, signal?: AbortSignal): Promise<ListResult<AlertRow>> {
    return toList(await api.get<AlertRow[]>("/alerts", { query: { ...query }, signal }));
  },

  /** GET /api/v1/alerts/{id} → ApiResponseAlertDetailDto (alert + actions + evidence). */
  async getAlert(id: number, signal?: AbortSignal): Promise<AlertDetailDto> {
    return (await api.get<AlertDetailDto>(`/alerts/${id}`, { signal })).data ?? {};
  },

  /** GET /api/v1/alerts/{id}/evidence → ApiResponseListEvidenceRow. */
  async evidence(id: number, signal?: AbortSignal): Promise<ListResult<EvidenceRow>> {
    return toList(await api.get<EvidenceRow[]>(`/alerts/${id}/evidence`, { signal }));
  },

  /** GET /api/v1/alerts/{id}/actions → ApiResponseListActionRow. */
  async actions(id: number, signal?: AbortSignal): Promise<ListResult<ActionRow>> {
    return toList(await api.get<ActionRow[]>(`/alerts/${id}/actions`, { signal }));
  },

  /** POST /api/v1/alerts/{id}/acknowledge | dismiss | reopen → ApiResponseAlertDetailDto. */
  async noteAction(id: number, action: AlertNoteAction, body: NoteRequest): Promise<AlertDetailDto> {
    return (await api.post<AlertDetailDto>(`/alerts/${id}/${action}`, body)).data ?? {};
  },

  /** POST /api/v1/alerts/{id}/resolve → ApiResponseAlertDetailDto. */
  async resolve(id: number, body: ResolveRequest): Promise<AlertDetailDto> {
    return (await api.post<AlertDetailDto>(`/alerts/${id}/resolve`, body)).data ?? {};
  },

  /** POST /api/v1/alerts/{id}/comments → ApiResponseAlertDetailDto. */
  async comment(id: number, body: CommentRequest): Promise<AlertDetailDto> {
    return (await api.post<AlertDetailDto>(`/alerts/${id}/comments`, body)).data ?? {};
  },

  // ── Notifications ──────────────────────────────────────────────────────────

  /** GET /api/v1/notifications → ApiResponseListNotificationDto. */
  async listNotifications(query: NotificationListQuery, signal?: AbortSignal): Promise<ListResult<NotificationDto>> {
    return toList(await api.get<NotificationDto[]>("/notifications", { query: { ...query }, signal }));
  },

  /**
   * GET /api/v1/notifications/unread-count → ApiResponseMapStringLong. The spec doesn't name the
   * key; the live BFF returned `{ unread: n }` (2026-10-29). Anything else → null (no badge).
   */
  async unreadCount(signal?: AbortSignal): Promise<number | null> {
    return readUnreadCount((await api.get<Record<string, number>>("/notifications/unread-count", { signal })).data);
  },

  /** POST /api/v1/notifications/{id}/read or /unread → ApiResponseNotificationDto. */
  async markNotification(id: number, read: boolean): Promise<NotificationDto> {
    return (await api.post<NotificationDto>(`/notifications/${id}/${read ? "read" : "unread"}`)).data ?? {};
  },

  /** POST /api/v1/notifications/read-all → ApiResponseMapStringInteger. */
  async markAllRead(): Promise<Record<string, number>> {
    return (await api.post<Record<string, number>>("/notifications/read-all")).data ?? {};
  },
};

/** Pure: unit-tested. The `unread` count from the map (key observed live), or null when absent or invalid. */
export function readUnreadCount(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const v = (data as Record<string, unknown>).unread;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}
