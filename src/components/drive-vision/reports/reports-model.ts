import type { MileageDto, ReportQuery } from "@/features/drive-vision/api/types";

/** Report kinds and their request shapes (GET /reports/*). Pure: unit-tested. */

export type ReportKind = "mileage" | "driving" | "parking" | "media";
export const REPORT_KINDS: ReportKind[] = ["mileage", "driving", "parking", "media"];
export const REPORT_LABEL: Record<ReportKind, string> = { mileage: "Mileage", driving: "Driving", parking: "Parking", media: "Media" };
export const REPORT_PAGE_SIZE = 20;

/** Mileage takes no paging parameters (the spec lists none); the other reports are server-paged. */
export const isPaged = (kind: ReportKind) => kind !== "mileage";

export function reportQuery(kind: ReportKind, range: { from: Date; to: Date }, deviceId: number | null, page: number): ReportQuery {
  const q: ReportQuery = { from: range.from.toISOString(), to: range.to.toISOString() };
  if (deviceId !== null) q.deviceIds = [deviceId];
  if (isPaged(kind)) {
    q.pageNumber = page;
    q.pageSize = REPORT_PAGE_SIZE;
  }
  return q;
}

/** Sum of `distanceKm` over rows that report it, and how many rows didn't. */
export function mileageTotal(rows: MileageDto[]): { km: number; missing: number } {
  let km = 0;
  let missing = 0;
  for (const r of rows) {
    if (typeof r.distanceKm === "number" && Number.isFinite(r.distanceKm)) km += r.distanceKm;
    else missing += 1;
  }
  return { km: Math.round(km * 10) / 10, missing };
}

/**
 * Hosts reserved for documentation/never-resolving use (RFC 2606, RFC 6761). The BFF has returned
 * placeholder URLs on these (an export at `example.invalid`, 2026-10-27); they can never serve a file.
 */
function isReservedPlaceholderHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return /(^|\.)(invalid|example)$/.test(host) || /(^|\.)example\.(com|net|org)$/.test(host);
}

/** Only http(s) links from the API are rendered as links (never javascript:, data:, or placeholder hosts). */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return isReservedPlaceholderHost(u.hostname) ? null : u.href;
  } catch {
    return null;
  }
}
