import type { StatusSetDto, TenantDto } from "@/features/drive-vision/api/types";

/**
 * Tenant Management view model (Phase 6). Pure: unit-tested.
 *
 * Data sources (V10, the only tenant operations that exist):
 * - GET /api/v1/platform/tenants → TenantDto[] (complete list, not paged; `total` = every tenant).
 * - GET /api/v1/reference/statuses → CatalogDto.statusSets: valid status values per entity. Used only if it
 *   contains a set that names tenants; nothing is assumed about its contents otherwise.
 * Missing values stay missing (rendered "—"), never 0. Statuses are shown as the server sends them.
 */

/** Rows per page in the tenant table. Client-side only: the API returns the whole list (no paging params). */
export const TENANT_PAGE_SIZE = 25;
/** Filter value for "every status". */
export const ALL_STATUSES = "__all__";
/** Filter value for tenants the server returned without a status. */
export const NO_STATUS = "";

/** A tenant's status as a filter key: trimmed server value, or NO_STATUS when missing/blank. */
export const statusKey = (t: TenantDto): string => (typeof t.status === "string" ? t.status.trim() : NO_STATUS);

/** Case-insensitive search over name, code and id. */
export function matchTenant(t: TenantDto, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [t.name, t.code, t.id !== undefined ? String(t.id) : undefined].some((v) => typeof v === "string" && v.toLowerCase().includes(needle));
}

/**
 * The tenant status set from the reference catalogue, if the server provides one (a set whose `name` or
 * `field` mentions "tenant"). Null when the catalogue is missing, failed, or has no such set.
 */
export function tenantStatusSet(sets: readonly StatusSetDto[] | undefined): StatusSetDto | null {
  if (!Array.isArray(sets)) return null;
  const named = (s: StatusSetDto) => typeof s.name === "string" && /tenant/i.test(s.name);
  const byField = (s: StatusSetDto) => typeof s.field === "string" && /tenant/i.test(s.field);
  const set = sets.find(named) ?? sets.find(byField) ?? null;
  return set && Array.isArray(set.values) ? set : null;
}

export interface StatusOption {
  value: string;
  label: string;
  /** Tenants in the list with this status. */
  count: number;
  /** Listed by the server's status catalogue (GET /reference/statuses). */
  documented: boolean;
}

/**
 * Status filter options: every status present in the list, plus documented statuses from the catalogue
 * (count 0) — both are server values; nothing is invented. "No status" appears only if a tenant lacks one.
 */
export function statusOptions(items: readonly TenantDto[], catalogue: StatusSetDto | null = null): StatusOption[] {
  const counts = new Map<string, number>();
  for (const t of items) counts.set(statusKey(t), (counts.get(statusKey(t)) ?? 0) + 1);
  const documented = new Set((catalogue?.values ?? []).filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim()));
  for (const v of documented) if (!counts.has(v)) counts.set(v, 0);
  return [...counts.entries()]
    .sort((a, b) => (a[0] === NO_STATUS ? 1 : b[0] === NO_STATUS ? -1 : a[0].localeCompare(b[0])))
    .map(([value, count]) => ({ value, label: value === NO_STATUS ? "No status" : value, count, documented: documented.has(value) }));
}

/** Tenants by name (then code, then id), filtered by search text and status. */
export function filterTenants(items: readonly TenantDto[], query: string, status: string): TenantDto[] {
  return [...items]
    .filter((t) => matchTenant(t, query) && (status === ALL_STATUSES || statusKey(t) === status))
    .sort((a, b) => (a.name ?? a.code ?? "").localeCompare(b.name ?? b.code ?? "") || (a.id ?? 0) - (b.id ?? 0));
}

export interface Page<T> {
  rows: T[];
  page: number;
  pages: number;
  from: number;
  to: number;
  total: number;
}

/** One page of rows; `page` is clamped into range (1-based). */
export function paginate<T>(rows: readonly T[], page: number, size = TENANT_PAGE_SIZE): Page<T> {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (p - 1) * size;
  const slice = rows.slice(start, start + size);
  return { rows: slice, page: p, pages, from: slice.length ? start + 1 : 0, to: start + slice.length, total: rows.length };
}

/** Why a tenant can't be selected (null = selectable). Backend rule: the tenant must exist and be ACTIVE. */
export function selectBlockReason(t: TenantDto): string | null {
  if (typeof t.id !== "number" || !Number.isSafeInteger(t.id) || t.id <= 0) return "This tenant has no valid id.";
  if (typeof t.status === "string" && t.status.trim().toUpperCase() !== "ACTIVE") return `Only active tenants can be selected (status ${t.status.trim()}).`;
  return null;
}

export interface DetailRowData {
  label: string;
  value: string | null;
  /** Shown when value is null. */
  missing: string;
}

const count = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? String(v) : null);
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Every TenantDto field for the detail drawer. V10 has no tenant detail endpoint, so this is the list
 * row itself. `current` is the server's flag; the frontend selection is shown separately.
 */
export function tenantDetailRows(t: TenantDto): DetailRowData[] {
  return [
    { label: "Tenant ID", value: count(t.id) ?? (typeof t.id === "number" ? String(t.id) : null), missing: "Not returned" },
    { label: "Code", value: text(t.code), missing: "Not returned" },
    { label: "Name", value: text(t.name), missing: "Not returned" },
    { label: "Status", value: text(t.status), missing: "Not returned" },
    { label: "Timezone", value: text(t.timezone), missing: "Not returned" },
    { label: "Users", value: count(t.users), missing: "Not reported by the server" },
    { label: "Devices", value: count(t.devices), missing: "Not reported by the server" },
    { label: "Drivers", value: count(t.drivers), missing: "Not reported by the server" },
    { label: "Server 'current' flag", value: typeof t.current === "boolean" ? (t.current ? "true" : "false") : null, missing: "Not returned" },
  ];
}
