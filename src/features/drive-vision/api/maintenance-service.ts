import { ApiError, isApiError } from "./errors";
import {
  TYRE_ALERT_LIMIT,
  cleanMaintenanceVehicleNumber,
  fromTyreAlert,
  parseScheduleList,
  parseScheduleResponse,
  parseTyreAlerts,
  parseTyreList,
  parseTyreRecord,
  parseVehicleAlerts,
  readCreateSchedule,
  readScheduleListQuery,
  readTyreComplete,
  readTyreRegister,
  sortNotifications,
  toSearch,
  vehicleAlertNotifications,
  type CreateScheduleRequest,
  type MaintenanceFeed,
  type MaintenanceNotification,
  type Parsed,
  type ScheduleListQuery,
} from "./maintenance";
import { PYTHON_API_PATHS, demoScopeError, demoTenantScope, gatewayNote, pythonJson, pythonPath, type PythonApiPath, type PythonErrorDetail, type PythonMethod } from "./python-client";
import { vehicleRegistryService } from "./vehicle-registry-service";

/**
 * Vehicle and Tyre Maintenance, called DIRECTLY on the Python API (python-client.ts; temporary demo integration).
 * Replaces the former same-origin proxy (app/api/maintenance/**, maintenance-proxy.ts); what it enforced is kept
 * here where a browser can keep it:
 *
 * - Tenant: every method takes the caller's maintenance tenant (maintenanceTenant(access).tenantId). Requests are
 *   only sent when that is the configured demo tenant (demoTenantScope); the demo tenant is what Python receives.
 * - X-Tenant-ID: on the five Tyre Maintenance operations (their Swagger requires it) and on schedule creation (kept
 *   from the proxy until the Python contract for create is confirmed). Never on the Vehicle Maintenance GETs: their
 *   Swagger declares no tenant header, and the gateway answers 502 when one is sent.
 * - Every response is checked for other tenants' tenant_id (tenant_mismatch). Requests are validated before they
 *   are sent (documented fields and query parameters only). Writes first confirm through the Java BFF, with the
 *   user's own session, that the vehicle is registered in the tenant (vehicle_not_found otherwise).
 * - The Safe-Fare token is never sent to Python. Errors keep the real HTTP status; a failure is never shown as empty.
 * - The Notifications feed is assembled here, in the browser, with the proxy's bounds and cache (FEED_LIMITS).
 */

const FEATURE = "Maintenance";

/** Plain-language message for a failure. `serverMessage` (cleaned) wins when present. */
export function maintenanceMessage(status: number, code?: string, serverMessage?: string): string {
  if (code === "not_configured") return serverMessage ?? "Maintenance isn't set up for this site.";
  if (code === "tenant_mismatch") return "The maintenance service answered with another organisation's data, so it was withheld. Please report this to support.";
  if (code === "upstream_route_missing") return "The maintenance service at the configured address doesn't have this endpoint (HTTP 404). It may not be deployed there yet.";
  if (code === "vehicle_not_found") return serverMessage ?? "This vehicle isn't registered in this organisation.";
  if (code === "vehicle_check_failed") return "The vehicle couldn't be checked against your organisation right now, so nothing was sent. Please try again.";
  if (code === "invalid_request") return "This request isn't valid, so it wasn't sent.";
  if (code === "upstream_invalid") return "The maintenance service sent a response that couldn't be read.";
  if (serverMessage) return serverMessage;
  if (code === "timeout" || status === 504) return "The maintenance service took too long to respond. Please try again.";
  if (status === 502 || status === 503) return "The maintenance service can't be reached right now. Please try again shortly.";
  if (status === 401) return "The maintenance service refused this request (HTTP 401).";
  if (status === 403) return "The maintenance service refused this for your role.";
  if (status === 404) return "Not found.";
  if (status === 422 || status === 400) return "The maintenance service didn't accept this request.";
  if (status >= 500) return "The maintenance service ran into a problem. Please try again shortly.";
  return `Maintenance request failed (HTTP ${status}).`;
}

/** describe() for pythonJson: the backend's message when useful, plus the status (and an HTML gateway note). */
const describe = (status: number, d: PythonErrorDetail) => {
  const base = maintenanceMessage(status, d.routeMissing ? "upstream_route_missing" : undefined, d.message ?? undefined);
  return d.routeMissing || /HTTP \d{3}/.test(base) ? base : `${base.replace(/\.$/, "")}${gatewayNote(status, d)}.`;
};

const invalid = (path: string, method: PythonMethod = "GET") => new ApiError({ kind: "http", status: 400, errorCode: "invalid_request", message: maintenanceMessage(400, "invalid_request"), method, path });

/** The demo tenant to send for this caller, or the refusal as an ApiError. */
function scope(callerTenantId: number | null | undefined, path: string): number {
  const s = demoTenantScope(callerTenantId);
  if (!s.ok) throw demoScopeError(s, FEATURE, path);
  return s.tenantId;
}

interface Call<T> {
  template: PythonApiPath;
  vehicleNumber?: string;
  method?: PythonMethod;
  search?: string;
  body?: unknown;
  /** Send X-Tenant-ID. */
  tenantHeader?: boolean;
  parse: (raw: unknown) => Parsed<T>;
  signal?: AbortSignal;
}

async function call<T>(tenantId: number, c: Call<T>): Promise<T> {
  const method = c.method ?? "GET";
  const path = pythonPath(c.template, c.vehicleNumber);
  const raw = await pythonJson(path, {
    method,
    search: c.search ? new URLSearchParams(c.search.replace(/^\?/, "")) : null,
    body: c.body,
    tenantId: c.tenantHeader ? tenantId : undefined,
    expectTenantId: tenantId,
    signal: c.signal,
    describe,
  });
  const parsed = c.parse(raw);
  if (!parsed.ok) {
    if (parsed.reason === "unsuccessful") throw new ApiError({ kind: "http", status: 200, errorCode: "MAINTENANCE_UNSUCCESSFUL", message: parsed.message ?? "The maintenance service reported that the request didn't succeed.", method, path });
    throw new ApiError({ kind: "parse", status: 200, errorCode: "upstream_invalid", message: maintenanceMessage(502, "upstream_invalid"), method, path });
  }
  return parsed.value;
}

const any = (raw: unknown): Parsed<unknown> => ({ ok: true, value: raw });

/** A vehicle number for a path, or the 400 refusal (nothing is sent). */
function vehicle(vehicleNumber: string, template: PythonApiPath, method: PythonMethod = "GET"): string {
  const v = cleanMaintenanceVehicleNumber(vehicleNumber);
  if (!v || v !== vehicleNumber.trim()) throw invalid(template, method);
  return v;
}

/**
 * Whether `vehicleNumber` is registered in the user's tenant, asked of the Java BFF with the user's own session
 * (GET /api/v1/vehicles?keyword=, a contains-search, so the match is exact and case-insensitive).
 */
export async function vehicleInTenant(vehicleNumber: string): Promise<"yes" | "no" | "error"> {
  try {
    const list = await vehicleRegistryService.listVehicles({ keyword: vehicleNumber, pageNumber: 1, pageSize: 100 });
    const want = vehicleNumber.toUpperCase();
    return list.items.some((r) => typeof r?.vehicleNumber === "string" && r.vehicleNumber.trim().toUpperCase() === want) ? "yes" : "no";
  } catch {
    return "error";
  }
}

async function writeGuard(vehicleNumber: string, path: string): Promise<void> {
  const member = await vehicleInTenant(vehicleNumber);
  if (member === "no") throw new ApiError({ kind: "http", status: 404, errorCode: "vehicle_not_found", message: `Vehicle ${vehicleNumber} isn't registered in this organisation.`, method: "POST", path });
  if (member === "error") throw new ApiError({ kind: "http", status: 502, errorCode: "vehicle_check_failed", message: maintenanceMessage(502, "vehicle_check_failed"), method: "POST", path });
}

/** `limit` 1–500 (absent → omitted; the service defaults to 50), optional vehicle_number. Null when invalid. */
export function readTyreAlertsQuery(q: { vehicle_number?: string; limit?: number }): { vehicle_number?: string; limit?: number } | null {
  const out: { vehicle_number?: string; limit?: number } = {};
  if (q.vehicle_number !== undefined) {
    const clean = cleanMaintenanceVehicleNumber(q.vehicle_number);
    if (!clean) return null;
    out.vehicle_number = clean;
  }
  if (q.limit !== undefined) {
    if (!Number.isInteger(q.limit) || q.limit < TYRE_ALERT_LIMIT.min || q.limit > TYRE_ALERT_LIMIT.max) return null;
    out.limit = q.limit;
  }
  return out;
}

// ── Notifications feed (assembled in the browser) ───────────────────────────

/**
 * Bounds for the feed, unchanged from the proxy. Vehicle Maintenance alerts need a vehicle_number (latest three
 * per vehicle), so the feed lists the tenant's schedules (one page of SCHEDULE_PAGE_SIZE), then asks for the alerts
 * of at most MAX_VEHICLES distinct vehicles, FEED_CONCURRENCY at a time. The result is cached per tenant for
 * FEED_TTL_MS; concurrent requests share one build; a refresh within MIN_REFRESH_MS of the last build is served
 * from the cache.
 */
export const FEED_LIMITS = { TYRE_LIMIT: 50, SCHEDULE_PAGE_SIZE: 100, MAX_VEHICLES: 25, FEED_CONCURRENCY: 4, FEED_TTL_MS: 60_000, MIN_REFRESH_MS: 10_000 } as const;
/** A shared build isn't tied to the request that started it, so one closed popover can't cancel it for others. */
const FEED_BUILD_TIMEOUT_MS = 45_000;

const feedCache = new Map<number, { at: number; feed?: MaintenanceFeed; building?: Promise<MaintenanceFeed> }>();
/** For tests (and sign-out). */
export const resetMaintenanceFeedCache = () => feedCache.clear();

export async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: ApiError };
const settle = <T>(p: Promise<T>): Promise<Outcome<T>> =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (e: unknown) => ({ ok: false as const, error: isApiError(e) ? e : new ApiError({ kind: "network", message: "Unexpected failure.", method: "GET", path: "maintenance-feed", cause: e }) })
  );

async function buildFeed(tenantId: number): Promise<MaintenanceFeed> {
  const signal = AbortSignal.timeout(FEED_BUILD_TIMEOUT_MS);
  const [tyreR, listR] = await Promise.all([
    settle(call(tenantId, { template: PYTHON_API_PATHS.tyreMaintenanceAlerts, search: toSearch({ limit: FEED_LIMITS.TYRE_LIMIT }), tenantHeader: true, parse: parseTyreAlerts, signal })),
    settle(call(tenantId, { template: PYTHON_API_PATHS.vehicleMaintenanceList, search: toSearch({ page: 1, page_size: FEED_LIMITS.SCHEDULE_PAGE_SIZE }), parse: parseScheduleList, signal })),
  ]);

  const items: MaintenanceNotification[] = [];
  const sources: MaintenanceFeed["sources"] = {
    tyre: { ok: false, count: 0 },
    vehicle: { ok: false, vehiclesChecked: 0, vehiclesWithSchedules: 0, failedVehicles: 0, truncated: false },
  };

  if (tyreR.ok) {
    tyreR.value.items.forEach((a, i) => items.push(fromTyreAlert(a, i)));
    sources.tyre = { ok: true, count: tyreR.value.items.length };
  } else sources.tyre = { ok: false, status: tyreR.error.status, error: tyreR.error.errorCode ?? tyreR.error.kind, count: 0 };

  if (listR.ok) {
    const numbers = [...new Set(listR.value.items.map((s) => cleanMaintenanceVehicleNumber(s.vehicle_number)).filter((n): n is string => n !== null))];
    const chosen = numbers.slice(0, FEED_LIMITS.MAX_VEHICLES);
    const total = listR.value.pagination.total;
    const results = await mapLimited(chosen, FEED_LIMITS.FEED_CONCURRENCY, (n) =>
      settle(call(tenantId, { template: PYTHON_API_PATHS.vehicleMaintenanceAlerts, search: toSearch({ vehicle_number: n }), parse: parseVehicleAlerts, signal })).then((r) => ({ n, r }))
    );
    let failed = 0;
    for (const { n, r } of results) {
      if (!r.ok) {
        // 404 = no alerts / no schedule for this vehicle, not a failure.
        if (r.error.errorCode !== "not_found") failed += 1;
        continue;
      }
      items.push(...vehicleAlertNotifications(r.value, n));
    }
    sources.vehicle = {
      ok: true,
      vehiclesChecked: chosen.length,
      vehiclesWithSchedules: total ?? numbers.length,
      failedVehicles: failed,
      truncated: numbers.length > chosen.length || (typeof total === "number" && total > listR.value.items.length),
    };
  } else sources.vehicle = { ...sources.vehicle, ok: false, status: listR.error.status, error: listR.error.errorCode ?? listR.error.kind };

  if (!tyreR.ok && !listR.ok) throw tyreR.error;
  return { items: sortNotifications(items), sources, generatedAt: new Date().toISOString() };
}

async function notificationsFeed(tenantId: number, refresh: boolean, now: () => number): Promise<MaintenanceFeed> {
  const entry = feedCache.get(tenantId);
  const age = entry ? now() - entry.at : Infinity;
  if (entry?.building) return entry.building;
  if (entry?.feed && (age < FEED_LIMITS.MIN_REFRESH_MS || (!refresh && age < FEED_LIMITS.FEED_TTL_MS))) return entry.feed;
  const building = buildFeed(tenantId);
  feedCache.set(tenantId, { at: entry?.at ?? 0, feed: entry?.feed, building });
  try {
    const feed = await building;
    feedCache.set(tenantId, { at: now(), feed });
    return feed;
  } catch (e) {
    // Errors aren't cached; the previous feed (if any) stays for the next call.
    feedCache.set(tenantId, { at: entry?.at ?? 0, feed: entry?.feed });
    throw e;
  }
}

// ── Service ─────────────────────────────────────────────────────────────────

const P = PYTHON_API_PATHS;

export const maintenanceService = {
  /** GET /api/vehicle-maintenance/{vehicle_number} (no tenant header). A 404 is ApiError not_found ("no schedule"). */
  async getSchedule(callerTenantId: number | null, vehicleNumber: string, signal?: AbortSignal) {
    const tenantId = scope(callerTenantId, P.vehicleMaintenanceSchedule);
    return call(tenantId, { template: P.vehicleMaintenanceSchedule, vehicleNumber: vehicle(vehicleNumber, P.vehicleMaintenanceSchedule), parse: parseScheduleResponse, signal });
  },
  /** GET /api/vehicle-maintenance with the documented filters (no tenant header). */
  async listSchedules(callerTenantId: number | null, query: ScheduleListQuery = {}, signal?: AbortSignal) {
    const tenantId = scope(callerTenantId, P.vehicleMaintenanceList);
    const q = readScheduleListQuery(new URLSearchParams(toSearch({ ...query }).replace(/^\?/, "")));
    if (!q) throw invalid(P.vehicleMaintenanceList);
    return call(tenantId, { template: P.vehicleMaintenanceList, search: toSearch({ ...q }), parse: parseScheduleList, signal });
  },
  /**
   * POST /api/vehicle-maintenance {vehicle_number, previous_vehicle_maintenance_date, reason?}. The backend
   * calculates the next date. X-Tenant-ID kept as the proxy sent it (see the module note); vehicle must be in tenant.
   */
  async createSchedule(callerTenantId: number | null, body: CreateScheduleRequest) {
    const tenantId = scope(callerTenantId, P.vehicleMaintenanceList);
    const out = readCreateSchedule(body);
    if (!out) throw invalid(P.vehicleMaintenanceList, "POST");
    await writeGuard(out.vehicle_number, P.vehicleMaintenanceList);
    return call(tenantId, { template: P.vehicleMaintenanceList, method: "POST", body: out, tenantHeader: true, parse: any });
  },
  /** GET /api/vehicle-maintenance/alerts?vehicle_number= (latest three alerts; no tenant header). */
  async vehicleAlerts(callerTenantId: number | null, vehicleNumber: string, signal?: AbortSignal) {
    const tenantId = scope(callerTenantId, P.vehicleMaintenanceAlerts);
    const v = cleanMaintenanceVehicleNumber(vehicleNumber);
    if (!v) throw invalid(P.vehicleMaintenanceAlerts);
    return call(tenantId, { template: P.vehicleMaintenanceAlerts, search: toSearch({ vehicle_number: v }), parse: parseVehicleAlerts, signal });
  },
  /** GET /api/v1/tyre-maintenance/vehicle/{vehicle_number} (X-Tenant-ID). */
  async getTyre(callerTenantId: number | null, vehicleNumber: string, signal?: AbortSignal) {
    const tenantId = scope(callerTenantId, P.tyreMaintenanceVehicle);
    return call(tenantId, { template: P.tyreMaintenanceVehicle, vehicleNumber: vehicle(vehicleNumber, P.tyreMaintenanceVehicle), tenantHeader: true, parse: parseTyreRecord, signal });
  },
  /** GET /api/v1/tyre-maintenance (every record of the tenant; X-Tenant-ID). */
  async listTyres(callerTenantId: number | null, signal?: AbortSignal) {
    const tenantId = scope(callerTenantId, P.tyreMaintenanceList);
    return call(tenantId, { template: P.tyreMaintenanceList, tenantHeader: true, parse: parseTyreList, signal });
  },
  /** GET /api/v1/tyre-maintenance/alerts ?vehicle_number ?limit (1–500; X-Tenant-ID). */
  async tyreAlerts(callerTenantId: number | null, query: { vehicle_number?: string; limit?: number } = {}, signal?: AbortSignal) {
    const tenantId = scope(callerTenantId, P.tyreMaintenanceAlerts);
    const q = readTyreAlertsQuery(query);
    if (!q) throw invalid(P.tyreMaintenanceAlerts);
    return call(tenantId, { template: P.tyreMaintenanceAlerts, search: toSearch(q), tenantHeader: true, parse: parseTyreAlerts, signal });
  },
  /** POST …/vehicle/{n}/register {installation_date} (X-Tenant-ID; vehicle must be in tenant). */
  async registerTyres(callerTenantId: number | null, vehicleNumber: string, installationDate: string) {
    const tenantId = scope(callerTenantId, P.tyreMaintenanceRegister);
    const v = vehicle(vehicleNumber, P.tyreMaintenanceRegister, "POST");
    const body = readTyreRegister({ installation_date: installationDate });
    if (!body) throw invalid(P.tyreMaintenanceRegister, "POST");
    await writeGuard(v, P.tyreMaintenanceRegister);
    return call(tenantId, { template: P.tyreMaintenanceRegister, vehicleNumber: v, method: "POST", body, tenantHeader: true, parse: any });
  },
  /** POST …/vehicle/{n}/complete {replacement_date?} (omitted → the backend's current UTC time; X-Tenant-ID). */
  async completeTyreReplacement(callerTenantId: number | null, vehicleNumber: string, replacementDate?: string) {
    const tenantId = scope(callerTenantId, P.tyreMaintenanceComplete);
    const v = vehicle(vehicleNumber, P.tyreMaintenanceComplete, "POST");
    const body = readTyreComplete(replacementDate ? { replacement_date: replacementDate } : {});
    if (!body) throw invalid(P.tyreMaintenanceComplete, "POST");
    await writeGuard(v, P.tyreMaintenanceComplete);
    return call(tenantId, { template: P.tyreMaintenanceComplete, vehicleNumber: v, method: "POST", body, tenantHeader: true, parse: any });
  },
  /** The tenant's maintenance alerts from both sources, newest first, assembled and cached in the browser. */
  async notifications(callerTenantId: number | null, refresh = false, now: () => number = Date.now) {
    const tenantId = scope(callerTenantId, "maintenance-notifications");
    return notificationsFeed(tenantId, refresh, now);
  },
};
