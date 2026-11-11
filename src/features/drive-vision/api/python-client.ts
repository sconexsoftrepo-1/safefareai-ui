import { ApiError } from "./errors";
import { DEFAULT_TENANT_HEADER } from "./tenant-context";

/**
 * Browser client for the Safe-Fare Python API (Iris chat, Sensor Alerts, Vehicle and Tyre Maintenance), called
 * DIRECTLY from the browser. TEMPORARY DEMO INTEGRATION: it replaces the former same-origin Next.js proxies
 * (app/api/iris, app/api/sensors, app/api/maintenance) so the app can be served as static files.
 *
 * What changed with the proxies gone, and what this client still enforces:
 * - The Python API has no authentication of its own, and the Safe-Fare (Java) access token is NEVER sent to it:
 *   no Authorization header, no cookies (`credentials: "omit"`). Python can't tell who is calling, so anyone who can
 *   reach the Python host can call it. That is why this is scoped to one demo tenant with demo data.
 * - Tenant: every tenant-scoped call uses the configured demo tenant (NEXT_PUBLIC_DEMO_TENANT_ID), and only when the
 *   signed-in user's own tenant IS that demo tenant (demoTenantScope). X-Tenant-ID is added only to the calls that
 *   ask for it (`tenantId`), never by default.
 * - Responses carrying any other tenant's `tenant_id` are refused (expectTenantId → tenant_mismatch).
 * - Paths: only the allowlisted templates (PYTHON_API_PATHS) with a validated, percent-encoded vehicle number, and
 *   only relative paths under the configured base. No caller value can pick another host.
 * - CORS must be enabled for this site's origin on the Python host. A blocked or unreachable request is shown as a
 *   network error; there is no fallback to any proxy.
 * - Nothing here logs tokens, request bodies or responses.
 */

export const PYTHON_API_BASE_ENV = "NEXT_PUBLIC_PYTHON_API_BASE_URL";
export const DEMO_TENANT_ENV = "NEXT_PUBLIC_DEMO_TENANT_ID";

/** The only Python paths the app calls. Driver-only maintenance operations (postpone / complete) are absent. */
export const PYTHON_API_PATHS = {
  irisChat: "/api/chat/message",
  irisHealth: "/health",
  sensorAlerts: "/api/sensors/alerts",
  vehicleMaintenanceList: "/api/vehicle-maintenance",
  vehicleMaintenanceAlerts: "/api/vehicle-maintenance/alerts",
  vehicleMaintenanceSchedule: "/api/vehicle-maintenance/{vehicle_number}",
  tyreMaintenanceList: "/api/v1/tyre-maintenance",
  tyreMaintenanceAlerts: "/api/v1/tyre-maintenance/alerts",
  tyreMaintenanceVehicle: "/api/v1/tyre-maintenance/vehicle/{vehicle_number}",
  tyreMaintenanceRegister: "/api/v1/tyre-maintenance/vehicle/{vehicle_number}/register",
  tyreMaintenanceComplete: "/api/v1/tyre-maintenance/vehicle/{vehicle_number}/complete",
} as const;
export type PythonApiPath = (typeof PYTHON_API_PATHS)[keyof typeof PYTHON_API_PATHS];
const ALLOWED_PATHS: ReadonlySet<string> = new Set(Object.values(PYTHON_API_PATHS));
const VEHICLE_PLACEHOLDER = "{vehicle_number}";

/** A filled, allowlisted path (from pythonPath). */
export type PythonPath = string & { readonly __pythonPath: true };

/**
 * A vehicle number that may fill {vehicle_number}: letters, digits, spaces and hyphens, 1–20 characters, starting
 * with a letter or digit. "alerts" is refused so a path can never turn into /api/vehicle-maintenance/alerts.
 */
const PATH_VEHICLE_NUMBER = /^[A-Za-z0-9][A-Za-z0-9 -]{0,19}$/;
export const isPathVehicleNumber = (v: unknown): v is string => typeof v === "string" && PATH_VEHICLE_NUMBER.test(v) && v.trim() === v && !/^(alerts|undefined|null)$/i.test(v);

/** An allowlisted path, with {vehicle_number} filled in (percent-encoded: exactly one segment). Throws otherwise. */
export function pythonPath(template: PythonApiPath, vehicleNumber?: string): PythonPath {
  if (!ALLOWED_PATHS.has(template)) throw new Error("[python-client] not an allowed Python API path");
  if (template.includes(VEHICLE_PLACEHOLDER)) {
    if (!isPathVehicleNumber(vehicleNumber)) throw new Error("[python-client] invalid vehicle number for a Python API path");
    return template.replace(VEHICLE_PLACEHOLDER, encodeURIComponent(vehicleNumber)) as PythonPath;
  }
  if (vehicleNumber !== undefined) throw new Error("[python-client] this Python API path takes no vehicle number");
  return template as PythonPath;
}

// ── Configuration ───────────────────────────────────────────────────────────

// process.env.NEXT_PUBLIC_* must be written out literally so Next.js inlines it into the browser bundle.
const configuredBase = () => process.env.NEXT_PUBLIC_PYTHON_API_BASE_URL;
const configuredTenant = () => process.env.NEXT_PUBLIC_DEMO_TENANT_ID;
const isProduction = () => process.env.NODE_ENV === "production";

/**
 * The configured base URL without a trailing slash, keeping its path ("/safe-fare-python"), or null when it is
 * missing or invalid: not absolute http(s), carries credentials, a query or a fragment, or is plain http in a
 * production build.
 */
export function pythonApiBase(raw: string | undefined = configuredBase(), production = isProduction()): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && !production)) return null;
  if (url.search || url.hash || url.username || url.password) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** The demo tenant id (a positive whole number), or null when NEXT_PUBLIC_DEMO_TENANT_ID is missing or invalid. */
export function getPythonDemoTenantId(raw: string | undefined = configuredTenant()): number | null {
  const text = (raw ?? "").trim();
  if (!/^\d{1,12}$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export type DemoTenantScope = { ok: true; tenantId: number } | { ok: false; reason: "not_configured" | "no_tenant" | "not_demo_tenant"; demoTenantId: number | null };

/**
 * Whether the signed-in user's tenant may use the Python demo, and the tenant to send. Only the demo tenant's own
 * users (or the Safe-Fare Admin with the demo tenant selected) get data, so nobody sees the demo tenant's records
 * under another organisation's name. There is no all-tenant request.
 */
export function demoTenantScope(callerTenantId: number | null | undefined, demoTenantId: number | null = getPythonDemoTenantId()): DemoTenantScope {
  if (demoTenantId === null) return { ok: false, reason: "not_configured", demoTenantId };
  if (typeof callerTenantId !== "number" || !Number.isSafeInteger(callerTenantId) || callerTenantId <= 0) return { ok: false, reason: "no_tenant", demoTenantId };
  if (callerTenantId !== demoTenantId) return { ok: false, reason: "not_demo_tenant", demoTenantId };
  return { ok: true, tenantId: demoTenantId };
}

/** Plain-language text for a scope refusal. */
export function demoScopeMessage(scope: Exclude<DemoTenantScope, { ok: true }>, feature: string): string {
  if (scope.reason === "not_configured") return `${feature} isn't set up for this demo: ${DEMO_TENANT_ENV} is missing.`;
  if (scope.reason === "no_tenant") return `${feature} is a demo for one organisation. Select the demo tenant (tenant ${scope.demoTenantId}) first.`;
  return `${feature} is only available in the demo tenant (tenant ${scope.demoTenantId}) during the demo.`;
}

/** The ApiError for a scope refusal (status 403, errorCode = the reason). */
export function demoScopeError(scope: Exclude<DemoTenantScope, { ok: true }>, feature: string, path: string): ApiError {
  return new ApiError({ kind: "http", status: scope.reason === "not_configured" ? 503 : 403, errorCode: scope.reason, message: demoScopeMessage(scope, feature), method: "GET", path });
}

// ── URLs ────────────────────────────────────────────────────────────────────

/** A relative path: one leading slash, then unreserved / percent-encoded segments. No scheme, host, "//", "..", query. */
const RELATIVE_PATH = /^\/(?:[A-Za-z0-9\-._~%]+(?:\/[A-Za-z0-9\-._~%]+)*)?$/;

/**
 * `${base}${path}${search}`, or null when the base URL isn't configured. Throws for a path that isn't a plain
 * relative API path (a full URL, "//host", "..", a query), so nothing can send a request to another host.
 */
export function pythonApiUrl(path: string, search: URLSearchParams | null = null, base: string | null = pythonApiBase()): string | null {
  if (!RELATIVE_PATH.test(path) || path.split("/").some((seg) => seg === "." || seg === "..")) throw new Error("[python-client] only relative Python API paths are allowed");
  if (!base) return null;
  const qs = search?.toString();
  return `${base}${path}${qs ? `?${qs}` : ""}`;
}

// ── Requests ────────────────────────────────────────────────────────────────

export type PythonMethod = "GET" | "POST" | "PATCH";

export interface PythonRequest {
  method?: PythonMethod;
  search?: URLSearchParams | null;
  /** Sent as JSON. */
  body?: unknown;
  /** Adds X-Tenant-ID with this tenant. Only for endpoints whose contract takes it. */
  tenantId?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export const PYTHON_TIMEOUT_MS = 20_000;

/**
 * One request to the Python API. Resolves with the Response for any HTTP status; throws an ApiError for "not
 * configured", network failure (including a CORS block, which the browser reports the same way), timeout and abort.
 */
export async function pythonFetch(path: PythonPath, init: PythonRequest = {}): Promise<Response> {
  const method = init.method ?? "GET";
  const url = pythonApiUrl(path, init.search ?? null);
  if (!url) throw new ApiError({ kind: "http", status: 503, errorCode: "not_configured", message: `The Python API isn't configured: ${PYTHON_API_BASE_ENV} is missing or invalid.`, method, path });
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.tenantId !== undefined) headers[DEFAULT_TENANT_HEADER] = String(init.tenantId);
  const timeout = AbortSignal.timeout(init.timeoutMs ?? PYTHON_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
      cache: "no-store",
      credentials: "omit",
      mode: "cors",
    });
  } catch (cause) {
    if (init.signal?.aborted) throw new ApiError({ kind: "aborted", message: "The request was cancelled.", method, path, cause });
    if (timeout.aborted) throw new ApiError({ kind: "timeout", message: "The Python API took too long to respond.", method, path, cause });
    const text = cause && typeof (cause as { message?: unknown }).message === "string" ? (cause as { message: string }).message : "";
    const reason = text ? ` (${text.slice(0, 120)})` : "";
    throw new ApiError({
      kind: "network",
      errorCode: "unreachable",
      message: `Couldn't reach the Python API${reason}. The service may be down, or its CORS settings don't allow this site.`,
      method,
      path,
      cause,
    });
  }
}

/** What a failed Python response says: FastAPI `detail` (string or 422 list) or the envelope's `message`. */
export interface PythonErrorDetail {
  message: string | null;
  fields: { field: string; message: string }[];
  /** FastAPI's generic 404 "Not Found": the route isn't deployed, which is not "no record". */
  routeMissing: boolean;
  /** The body was an HTML page (a gateway error, e.g. IIS/ARR 502), not the API's JSON. */
  html: boolean;
}

const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 300);

export function readPythonErrorBody(status: number, text: string): PythonErrorDetail {
  const fields: { field: string; message: string }[] = [];
  const html = /^\s*</.test(text);
  let raw: unknown = null;
  try {
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  let message: string | null = null;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    const detail = r.detail;
    if (typeof detail === "string") message = clean(detail);
    else if (Array.isArray(detail)) {
      for (const d of detail.slice(0, 20)) {
        if (!d || typeof d !== "object" || typeof (d as { msg?: unknown }).msg !== "string") continue;
        const loc = Array.isArray((d as { loc?: unknown }).loc) ? ((d as { loc: unknown[] }).loc.filter((x) => typeof x === "string" && x !== "body" && x !== "query" && x !== "path") as string[]).join(".") : "";
        fields.push({ field: clean(loc).slice(0, 60), message: clean((d as { msg: string }).msg) });
      }
      message = fields.length ? fields.map((f) => (f.field ? `${f.field}: ${f.message}` : f.message)).join("; ").slice(0, 300) : null;
    } else if (detail && typeof detail === "object" && typeof (detail as { message?: unknown }).message === "string") message = clean((detail as { message: string }).message);
    else if (typeof r.message === "string") message = clean(r.message);
  }
  return { message, fields, routeMissing: status === 404 && message === "Not Found", html };
}

/** Every numeric `tenant_id` in a JSON value (depth-limited). */
export function tenantIdsIn(v: unknown, depth = 0, out: Set<number> = new Set()): Set<number> {
  if (depth > 6 || v === null || typeof v !== "object") return out;
  if (Array.isArray(v)) {
    for (const x of v.slice(0, 1000)) tenantIdsIn(x, depth + 1, out);
    return out;
  }
  for (const [k, x] of Object.entries(v)) {
    if (k === "tenant_id" && typeof x === "number") out.add(x);
    else if (x && typeof x === "object") tenantIdsIn(x, depth + 1, out);
  }
  return out;
}

export interface PythonJsonRequest extends PythonRequest {
  /** Refuse the body (502 tenant_mismatch) when it carries any other tenant_id. */
  expectTenantId?: number;
  /** User-facing message for an HTTP error, from its status and what the body said. */
  describe: (status: number, detail: PythonErrorDetail) => string;
}

/**
 * A Python request whose 2xx answer is JSON. HTTP errors become ApiErrors with the real status, errorCode
 * "upstream_route_missing" (FastAPI's generic 404) / "not_found" (any other 404) / "upstream", the describe()
 * message and any 422 field errors. A non-JSON 2xx body is a
 * parse error. Nothing is logged.
 */
export async function pythonJson(path: PythonPath, init: PythonJsonRequest): Promise<unknown> {
  const method = init.method ?? "GET";
  const res = await pythonFetch(path, init);
  let text: string;
  try {
    text = await res.text();
  } catch (cause) {
    throw new ApiError({ kind: "network", status: res.status, message: "The Python API response couldn't be read.", method, path, cause });
  }
  if (!res.ok) {
    const detail = readPythonErrorBody(res.status, text);
    throw new ApiError({
      kind: "http",
      status: res.status,
      errorCode: detail.routeMissing ? "upstream_route_missing" : res.status === 404 ? "not_found" : "upstream",
      message: init.describe(res.status, detail),
      method,
      path,
      fieldErrors: detail.fields.length ? detail.fields : undefined,
    });
  }
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (json === undefined) throw new ApiError({ kind: "parse", status: res.status, message: "The Python API sent a response that couldn't be read.", method, path });
  if (init.expectTenantId !== undefined && [...tenantIdsIn(json)].some((t) => t !== init.expectTenantId)) {
    throw new ApiError({ kind: "http", status: 502, errorCode: "tenant_mismatch", message: "The Python API answered with another organisation's data, so it was withheld. Please report this.", method, path });
  }
  return json;
}

/** "HTTP 502 from the Python API gateway" style suffix when the body was an HTML error page. */
export const gatewayNote = (status: number, detail: PythonErrorDetail) => (detail.html ? ` (HTTP ${status}, the gateway's HTML error page rather than the API's JSON)` : ` (HTTP ${status})`);
