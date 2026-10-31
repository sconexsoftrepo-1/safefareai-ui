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

export type TripAction = "accept" | "start" | "complete" | "decline" | "swap";
export const TRIP_ACTIONS: readonly TripAction[] = ["accept", "start", "complete", "decline", "swap"];

/** The dispatch fields the server records for a trip's progress (spec `Row`). */
export interface TripFacts {
  id?: number;
  respondedAt?: string;
  startedAt?: string;
  completedAt?: string;
  declineReason?: string;
  cancelReason?: string;
  pendingSwapRequestId?: number;
}

const set = (v: string | number | undefined) => (typeof v === "string" ? v.trim() !== "" : typeof v === "number");

/**
 * Which driver actions to offer for a trip: `null` = offered (the server still decides), a string =
 * not offered, and why. Status codes and transitions are undocumented (missing-backend-apis #9), so
 * no rule reads `status`: an action is withheld only when the server's own record shows it is moot —
 * the trip is completed, cancelled or declined, the step was already recorded (responded, started),
 * or a swap request is already pending. Unit-tested.
 */
export function tripActionAvailability(trip: TripFacts): Record<TripAction, string | null> {
  const closed = trip.id === undefined ? "This trip has no id from the server" : set(trip.completedAt) ? "This trip is completed" : set(trip.cancelReason) ? "This trip was cancelled" : set(trip.declineReason) ? "You declined this trip" : null;
  if (closed) return { accept: closed, start: closed, complete: closed, decline: closed, swap: closed };
  const started = set(trip.startedAt) ? "This trip has already started" : null;
  return {
    accept: started ?? (set(trip.respondedAt) ? "You already responded to this trip" : null),
    start: started,
    complete: null,
    decline: started,
    swap: set(trip.pendingSwapRequestId) ? "A swap request for this trip is already pending" : null,
  };
}

/** One sentence for the actions withheld on a trip (distinct reasons, in action order), or null. */
export function withheldTripReason(availability: Record<TripAction, string | null>, shown: readonly TripAction[]): string | null {
  const reasons = [...new Set(shown.map((a) => availability[a]).filter((r): r is string => r !== null))];
  return reasons.length ? `${reasons.join(". ")}.` : null;
}
