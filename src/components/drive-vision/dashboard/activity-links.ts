import type { DateRangeKey } from "@/features/drive-vision/types";
import { alertsSearch } from "../alerts/alerts-model";
import type { LiveAlarm } from "./live-dashboard-model";

/**
 * Where a Recent activity row opens: the alert itself on Alerts & Events, by its own id.
 *
 *   /drive-vision/alerts?kind=ai|routine[&range=today|30d][&device=<deviceId>]&alarm=<id>
 *
 * The id is the record's `id` from GET /alarms/ai or /alarms/routine. The documented contract
 * (docs/contracts/polling-apis.txt) shows the same record with the same id in GET /alerts, and the Alerts page opens
 * `alarm=<id>` through GET /alerts/{id} (as notification links already do), so the drawer shows that exact alert even
 * when it is outside the list's current page or filters. Nothing is matched by title or vehicle.
 *
 * The tab follows the record's feed (AI events / Routine alarms); the Overview's date range and the vehicle are kept as
 * the list's filters. Null when the record has no usable id: such a row stays a plain, non-clickable row.
 */
export function activityAlertHref(a: Pick<LiveAlarm, "id" | "kind" | "deviceId">, range: DateRangeKey): string | null {
  if (typeof a.id !== "number" || !Number.isSafeInteger(a.id) || a.id <= 0) return null;
  if (a.kind !== "ai" && a.kind !== "routine") return null;
  const deviceId = typeof a.deviceId === "number" && Number.isSafeInteger(a.deviceId) && a.deviceId > 0 ? a.deviceId : null;
  return `/drive-vision/alerts${alertsSearch({ kind: a.kind, range, deviceId, typeId: null, page: 1, alarmId: a.id, history: false })}`;
}
