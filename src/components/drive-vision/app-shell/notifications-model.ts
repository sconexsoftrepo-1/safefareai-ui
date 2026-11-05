import { reachableHref, type Access } from "@/features/drive-vision/access/access-policy";
import type { NotificationDto, NotificationPollDto, NotificationTabDto } from "@/features/drive-vision/api/types";
import { formatLocalDateTime } from "@/features/drive-vision/utils/format";
import { notificationLink } from "./search-model";

/** The bell's panels. AI_EVENT and ALARM are the poll's tabs; ALL is GET /notifications, for every other type. */
export type NotificationTab = "AI_EVENT" | "ALARM" | "ALL";

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
