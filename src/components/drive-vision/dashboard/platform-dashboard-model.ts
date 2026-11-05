import type { TenantDto } from "@/features/drive-vision/api/types";

/**
 * Platform-wide figures derived from GET /platform/tenants. Pure: unit-tested.
 *
 * Rules (never show a guess as a number):
 * - Per-tenant counts are summed only when the list is complete (`items.length === total`, the list isn't
 *   paged) and every tenant carries that count as a non-negative number. Otherwise the total is `null`
 *   ("unavailable"), never a partial sum.
 * - Tenant status: only "ACTIVE" and "INACTIVE" are counted as such (V10 doesn't enumerate the values);
 *   anything else, including a missing status, is `otherStatus`.
 */
export interface TenantSummary {
  /** The server's `total` (every tenant), or the rows received when `total` is malformed. */
  tenants: number;
  /** False when the server's `total` doesn't match the rows received; then every derived figure is null. */
  complete: boolean;
  active: number | null;
  inactive: number | null;
  otherStatus: number | null;
  users: number | null;
  devices: number | null;
  drivers: number | null;
}

const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

function sumWhenComplete(items: readonly TenantDto[], complete: boolean, key: "users" | "devices" | "drivers"): number | null {
  if (!complete) return null;
  let total = 0;
  for (const t of items) {
    const v = t[key];
    if (!count(v)) return null;
    total += v;
  }
  return total;
}

export function summarizeTenants(list: { items: readonly TenantDto[]; total: number } | undefined): TenantSummary | null {
  if (!list) return null;
  const { items } = list;
  const complete = count(list.total) && list.total === items.length;
  let active = 0;
  let inactive = 0;
  for (const t of items) {
    const status = typeof t.status === "string" ? t.status.trim().toUpperCase() : "";
    if (status === "ACTIVE") active++;
    else if (status === "INACTIVE") inactive++;
  }
  return {
    tenants: count(list.total) ? list.total : items.length,
    complete,
    active: complete ? active : null,
    inactive: complete ? inactive : null,
    otherStatus: complete ? items.length - active - inactive : null,
    users: sumWhenComplete(items, complete, "users"),
    devices: sumWhenComplete(items, complete, "devices"),
    drivers: sumWhenComplete(items, complete, "drivers"),
  };
}

/** Tenants for the table: by name, then code; rows without an id are kept (shown, not linked). */
export function sortTenants(items: readonly TenantDto[]): TenantDto[] {
  return [...items].sort((a, b) => (a.name ?? a.code ?? "").localeCompare(b.name ?? b.code ?? "") || (a.id ?? 0) - (b.id ?? 0));
}

/** A server count for display: the number, or null when absent / malformed (rendered "—", never 0). */
export const serverCount = (v: unknown): number | null => (count(v) ? v : null);

/** Severity buckets from SafetySummary.bySeverity, highest key first. The scale is undocumented, so keys are shown as-is. */
export function severityRows(map: Record<string, number> | undefined): { key: string; value: number }[] {
  return Object.entries(map ?? {})
    .filter(([k, v]) => k !== "" && count(v))
    .sort((a, b) => Number(b[0]) - Number(a[0]) || a[0].localeCompare(b[0]))
    .map(([key, value]) => ({ key, value }));
}

export interface TenantSize {
  id: string;
  name: string;
  devices: number;
}

/** Largest tenants by the server's device count. Tenants without a count are left out, never shown as 0. */
export function topTenantsByFleetSize(items: readonly TenantDto[], limit = 5): TenantSize[] {
  return items
    .filter((t) => count(t.devices))
    .map((t, i) => ({ id: String(t.id ?? `tenant-${i}`), name: t.name ?? t.code ?? "Unnamed tenant", devices: t.devices as number }))
    .sort((a, b) => b.devices - a.devices || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Chip colours for an alert, from the app's severity scale (1 Severe, 2 Moderate, 3 General, 4 Notice). Unknown levels stay neutral. */
export function alertChip(severity: number | undefined): string {
  if (severity === 1) return "bg-danger-soft text-danger";
  if (severity === 2) return "bg-warning-soft text-warning";
  if (severity === 3 || severity === 4) return "bg-powder text-info";
  return "bg-surface-sunken text-ink-muted";
}
