import { ApiError } from "./errors";
import { PYTHON_API_PATHS, demoScopeError, demoTenantScope, gatewayNote, pythonJson, pythonPath, type PythonErrorDetail } from "./python-client";
import { parseSensorAlertsResponse, sensorAlertsSearch, type SensorAlertsQuery, type SensorAlertsResponse } from "./sensor-alerts";

/**
 * Sensor alerts, read DIRECTLY from the Python API (python-client.ts; temporary demo integration). Separate from
 * sensorService: it is a different backend, and nothing here touches the BFF's passenger-counting data.
 *
 * - tenant_id is always the configured demo tenant, and a request is only sent when the signed-in user's tenant is
 *   that demo tenant (demoTenantScope). There is no all-tenant request. No token or tenant header is sent.
 * - Only the documented filters are sent (sensorAlertsSearch validates and URL-encodes them).
 * - A response carrying another tenant's tenant_id is refused (tenant_mismatch).
 * - Errors are ApiErrors with plain-language messages that keep the real HTTP status.
 */
const METHOD = "GET";
const PATH = PYTHON_API_PATHS.sensorAlerts;
const FEATURE = "Sensor alerts";

/** User-facing message for an HTTP error from the service. */
export function sensorAlertsMessage(status: number, detail?: Pick<PythonErrorDetail, "html" | "routeMissing" | "message" | "fields">): string {
  const d = { html: false, routeMissing: false, message: null, fields: [], ...detail };
  const note = gatewayNote(status, d);
  if (d.routeMissing || status === 404) return `The sensor alerts endpoint wasn't found on the Python API${note}. It may not be deployed yet.`;
  if (status === 422 || status === 400) return `The sensor alerts service didn't accept these filters${d.message ? `: ${d.message}` : ""}${note}.`;
  if (status === 401 || status === 403) return `The sensor alerts service refused this request${note}.`;
  if (status === 504) return `The sensor alerts service took too long to respond${note}.`;
  if (status === 502 || status === 503) return `The sensor alerts service can't be reached right now${note}. Please try again shortly.`;
  if (status >= 500) return `The sensor alerts service ran into a problem${note}. Please try again shortly.`;
  return `Sensor alerts couldn't be loaded${note}.`;
}

export const sensorAlertsService = {
  /**
   * GET <Python API>/api/sensors/alerts ?tenant_id(demo) ?vehicle_number ?sensor_sub_id ?from_time ?to_time
   * ?max_gap_seconds (always sent; default 60). `callerTenantId` is the signed-in user's tenant (the Safe-Fare Admin's
   * selected one); it only decides whether the demo may be shown, it is never sent. Omitted filters are left out.
   */
  async list(query: Omit<SensorAlertsQuery, "tenantId"> = {}, callerTenantId: number | null = null, signal?: AbortSignal): Promise<SensorAlertsResponse> {
    const scope = demoTenantScope(callerTenantId);
    if (!scope.ok) throw demoScopeError(scope, FEATURE, PATH);
    const search = new URLSearchParams(sensorAlertsSearch({ ...query, tenantId: scope.tenantId }).replace(/^\?/, ""));
    const raw = await pythonJson(pythonPath(PATH), { search, signal, expectTenantId: scope.tenantId, describe: sensorAlertsMessage });
    const parsed = parseSensorAlertsResponse(raw);
    if (!parsed.ok) {
      if (parsed.reason === "unsuccessful") throw new ApiError({ kind: "http", status: 200, errorCode: "SENSOR_ALERTS_UNSUCCESSFUL", message: "The sensor alerts service couldn't return alerts right now. Please try again.", method: METHOD, path: PATH });
      throw new ApiError({ kind: "parse", status: 200, message: "The sensor alerts service sent a response that couldn't be read.", method: METHOD, path: PATH });
    }
    return parsed.value;
  },
};
