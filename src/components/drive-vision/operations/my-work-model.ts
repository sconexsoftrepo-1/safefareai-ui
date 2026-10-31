import { formatSeconds } from "@/features/drive-vision/utils/format";
import type { Tone } from "../shared/status-badge";

/** Pure display helpers for the driver screens. Unit-tested. */

/** Tone for status strings the server returns. Values aren't enumerated in the spec: known words get a colour, anything else stays neutral (the text is always shown). */
export function statusTone(status: string | undefined): Tone {
  switch ((status ?? "").toUpperCase()) {
    case "APPROVED":
    case "ACCEPTED":
    case "COMPLETED":
    case "VALID":
    case "ACTIVE":
      return "success";
    case "PENDING":
    case "ASSIGNED":
    case "EXPIRING":
      return "warning";
    case "IN_PROGRESS":
    case "STARTED":
      return "info";
    case "REJECTED":
    case "DECLINED":
    case "EXPIRED":
      return "danger";
    default:
      return "neutral";
  }
}

/** "IN_PROGRESS" → "In progress". */
export const humanize = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

/** Elapsed time since a server start timestamp (open shift), or null when it can't be computed. */
export function elapsedSince(startedAt: string | undefined, now: Date): string | null {
  if (!startedAt) return null;
  const s = Math.floor((now.getTime() - new Date(startedAt).getTime()) / 1000);
  return Number.isFinite(s) && s >= 0 ? formatSeconds(s) : null;
}

/** Items grouped by the server's `category` in first-seen order; items without one go under "Other". */
export function groupByCategory<T extends { category?: string }>(items: readonly T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const i of items) {
    const k = i.category?.trim() || "Other";
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  return [...groups.entries()];
}

/** Count of items per status in the list the server returned (missing status → "—"). */
export function countByStatus(items: readonly { status?: string }[]): Record<string, number> {
  return items.reduce<Record<string, number>>((m, l) => ((m[l.status || "—"] = (m[l.status || "—"] ?? 0) + 1), m), {});
}
