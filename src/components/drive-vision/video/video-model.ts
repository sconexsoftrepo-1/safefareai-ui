import type { DeviceDto, ExportRequest, RecordingDto } from "@/features/drive-vision/api/types";

/** Recording calendar / list / export helpers (fleet days are IST). Pure: unit-tested. */

const IST_OFFSET_MS = 5.5 * 3_600_000;
const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD of the IST day containing `date`. */
export function istDayKey(date: Date): string {
  const d = new Date(date.getTime() + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** [from, to) of an IST calendar day as ISO instants. */
export function istDayRange(key: string): { from: string; to: string } {
  const [y, m, d] = key.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d) - IST_OFFSET_MS;
  return { from: new Date(start).toISOString(), to: new Date(start + DAY).toISOString() };
}

/**
 * Day keys from GET /devices/{id}/recording-calendar. The response is a list of integers; reading
 * them as days of the requested month is an assumption (undocumented) — anything outside 1..days
 * in that month is ignored rather than guessed at.
 */
export function calendarDayKeys(month: string, days: unknown): Set<string> {
  const [y, m] = month.split("-").map(Number);
  const inMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out = new Set<string>();
  if (!Array.isArray(days)) return out;
  for (const d of days) if (typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= inMonth) out.add(`${month}-${pad(d)}`);
  return out;
}

/** Channels to offer: the device's `cameraLines` when valid, else 1..cameraCount. API range is 1–16. */
export function channelOptions(device: Pick<DeviceDto, "cameraLines" | "cameraCount"> | undefined): number[] {
  const valid = (c: unknown): c is number => typeof c === "number" && Number.isInteger(c) && c >= 1 && c <= 16;
  const lines = Array.isArray(device?.cameraLines) ? [...new Set(device!.cameraLines.filter(valid))].sort((a, b) => a - b) : [];
  if (lines.length > 0) return lines;
  const count = device?.cameraCount;
  return typeof count === "number" && Number.isInteger(count) && count > 0 ? Array.from({ length: Math.min(count, 16) }, (_, i) => i + 1) : [];
}

/** ExportRequest for one recording segment, or null when it lacks what the API requires. */
export function exportRequestFor(rec: RecordingDto, deviceId: number): ExportRequest | null {
  const ch = rec.channel;
  if (typeof ch !== "number" || !Number.isInteger(ch) || ch < 1 || ch > 16) return null;
  const from = rec.beginTime ? Date.parse(rec.beginTime) : NaN;
  const to = rec.endTime ? Date.parse(rec.endTime) : NaN;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  return { deviceId, channel: ch, from: rec.beginTime!, to: rec.endTime! };
}
