import type { TrackPointDto } from "@/features/drive-vision/api/types";
import { DAY } from "@/features/drive-vision/utils/time";
import { checkPosition } from "../monitoring/live-fleet-model";

/** Observed backend limit for GET /devices/{id}/track (400 INVALID_VALUE beyond it). */
export const MAX_TRACK_RANGE_MS = 7 * DAY;

export interface TrackPoint extends TrackPointDto {
  /** Index in the server response, for stable keys. */
  index: number;
  time: number;
  /** Usable coordinates (see checkPosition); null when the point can't be plotted. */
  pos: { lat: number; lon: number } | null;
}

export interface PreparedTrack {
  /** Points with a valid time, in chronological order. */
  points: TrackPoint[];
  /** The subset that can be drawn. */
  plotted: TrackPoint[];
  withoutTime: number;
  withoutPosition: number;
  /** The server's order differed from chronological order. */
  reordered: boolean;
}

/** Orders by deviceTime (stable for equal times) and separates unusable points instead of guessing. */
export function prepareTrack(raw: TrackPointDto[] | undefined): PreparedTrack {
  const timed: TrackPoint[] = [];
  let withoutTime = 0;
  (raw ?? []).forEach((p, index) => {
    const time = p.deviceTime ? new Date(p.deviceTime).getTime() : NaN;
    if (Number.isNaN(time)) {
      withoutTime++;
      return;
    }
    const check = checkPosition(p);
    timed.push({ ...p, index, time, pos: check.ok ? { lat: check.lat, lon: check.lon } : null });
  });
  const reordered = timed.some((p, i) => i > 0 && p.time < timed[i - 1].time);
  const points = reordered ? [...timed].sort((a, b) => a.time - b.time || a.index - b.index) : timed;
  const plotted = points.filter((p) => p.pos);
  return { points, plotted, withoutTime, withoutPosition: points.length - plotted.length, reordered };
}

/** Max reported speed and odometer span — both derived only from returned point values. */
export function trackStats(points: TrackPoint[]) {
  const speeds = points.map((p) => p.speedKmh).filter((v): v is number => typeof v === "number");
  const odo = points.map((p) => p.mileageKm).filter((v): v is number => typeof v === "number");
  return {
    maxSpeed: speeds.length ? Math.max(...speeds) : null,
    odometerSpanKm: odo.length >= 2 ? odo[odo.length - 1] - odo[0] : null,
  };
}

/* Range inputs are in fleet time (IST, UTC+05:30, no DST), like every timestamp on screen. */
const IST_OFFSET_MS = 5.5 * 3_600_000;

/** "YYYY-MM-DDTHH:mm" in IST → Date. Returns null for empty/invalid input. */
export function istInputToDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET_MS);
}

/** Date → "YYYY-MM-DDTHH:mm" in IST, for datetime-local inputs. */
export function dateToIstInput(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 16);
}

/** Client-side check that mirrors the backend's observed rules, so invalid ranges aren't sent. */
export function validateRange(from: Date | null, to: Date | null, now: Date): string | null {
  if (!from || !to) return "Choose a start and end time.";
  if (from.getTime() >= to.getTime()) return "The start must be before the end.";
  if (to.getTime() - from.getTime() > MAX_TRACK_RANGE_MS) return "The range can be at most 7 days.";
  if (from.getTime() > now.getTime()) return "The start is in the future.";
  return null;
}
