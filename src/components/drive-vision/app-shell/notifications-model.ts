import { SCREEN_ROUTES, reachableHref, type Access } from "@/features/drive-vision/access/access-policy";
import type { MaintenanceNotification } from "@/features/drive-vision/api/maintenance";
import type { NotificationDto, NotificationPollDto, NotificationTabDto } from "@/features/drive-vision/api/types";
import { formatLocalDateTime } from "@/features/drive-vision/utils/format";
import { notificationLink } from "./search-model";

/**
 * The bell's panels. AI_EVENT and ALARM are the poll's tabs; ALL is GET /notifications, for every other type.
 * MAINTENANCE is the Python Vehicle / Tyre Maintenance alerts (Safe-Fare Admin and Fleet Owner only), read through
 * /api/maintenance/notifications. Those alerts have no read state anywhere, so they never count as unread.
 */
export type NotificationTab = "AI_EVENT" | "ALARM" | "MAINTENANCE" | "ALL";

export interface PollTab {
  unread: number;
  items: NotificationDto[];
}
export interface NotificationPoll {
  /** Also counts types with no tab (SENSOR, DISPATCH, LEAVE, SWAP, SHIFT), so it can exceed the two tabs. */
  unreadTotal: number;
  ai: PollTab;
  alarm: PollTab;
}

const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const readTab = (t: NotificationTabDto | null | undefined): PollTab => ({ unread: count(t?.unread), items: Array.isArray(t?.items) ? t.items.filter((n) => n && typeof n === "object") : [] });

/** GET /notifications/poll → what the bell shows. A missing part reads as empty: nothing is invented. Pure: unit-tested. */
export function readNotificationPoll(dto: NotificationPollDto | null | undefined): NotificationPoll {
  return { unreadTotal: count(dto?.unreadTotal), ai: readTab(dto?.aiEvents), alarm: readTab(dto?.alarm) };
}

/**
 * The row's time. `vendorAlarmTime` is the vendor's clock as text, with no time zone, so it is shown as sent;
 * anything else is UTC and shown in the user's zone. "Alert assigned" and other types have no `details`.
 */
export function notificationTime(n: NotificationDto): { text: string; iso?: string } | null {
  const vendor = n.details?.vendorAlarmTime;
  if (vendor) return { text: vendor, iso: n.details?.alarmTime ?? undefined };
  return n.createdAt ? { text: formatLocalDateTime(n.createdAt), iso: n.createdAt } : null;
}

/** Where a notification opens, or null when the user can't open it: the alert it names, else its reference. */
export function notificationHref(access: Access, n: NotificationDto): string | null {
  const alarmId = n.details?.alarmId;
  if (typeof alarmId === "number" && Number.isSafeInteger(alarmId) && alarmId > 0) return reachableHref(access, `/drive-vision/alerts?kind=incidents&alarm=${alarmId}`);
  return notificationLink(access, n.refType, n.refId);
}

/**
 * Where a maintenance notification opens: the vehicle's Maintenance Alerts tab in the Vehicles drawer, found by
 * vehicle number in the user's own tenant (the page says so when the vehicle isn't there). Null when the user can't
 * open the Vehicles screen.
 */
export function maintenanceNotificationHref(access: Access, n: Pick<MaintenanceNotification, "vehicleNumber" | "id">): string | null {
  const q = new URLSearchParams({ vehicleNumber: n.vehicleNumber, tab: "alerts", alert: n.id });
  return reachableHref(access, `${SCREEN_ROUTES.vehicleRegistry}?${q.toString()}`);
}

/**
 * Maintenance alerts have no read / unread state: the Python APIs offer none, and the Safe-Fare notification
 * service only stores read state for its own notifications. So they add nothing to the unread badge, have no
 * Mark read buttons, and Mark all read never runs on the Maintenance tab.
 */
export const MAINTENANCE_HAS_READ_STATE = false;
