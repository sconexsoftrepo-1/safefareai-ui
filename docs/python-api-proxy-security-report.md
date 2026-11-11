# Python API proxy: security verification and fixes

Date: 2026-11-09 (live checks at 13:00 UTC) · Branch `new-features/Prakash` · Next.js 16.4.2 on Windows, port 3000

## Summary

| Area | Result |
| --- | --- |
| Shared `PYTHON_API_URL`, server-only | Verified. Hardened so only **allowlisted** upstream paths can be fetched |
| Sensor Alerts proxy | Verified. Now uses the shared caller check and the **centralized resolver** (`computeAccess` → Sensors screen) |
| Iris proxy | **Fixed:** it had **no authentication**. Anyone able to reach the Next.js server could relay messages to the chat service. It now requires a verified Safe-Fare user with the `assistant` feature, for chat and health alike |
| Tokens to Python | Never. The Safe-Fare token reaches only our route and the BFF (tested) |
| Browser bundle | Contains neither `PYTHON_API_URL` nor the Python host or port (scanned after build) |
| **Live Python service** | **Not working.** `185.193.19.156:8088` serves "SafeFare - Vehicle Maintenance (local check)". `GET /api/sensors/alerts`, `POST /api/chat/message` and `GET /health` all answer **404**. **No successful live response from either integration has been observed** |
| Network security | **Not secured.** The Python service is publicly reachable without authentication and exposes `/dev/*` routes. The proxy can't prevent direct calls (§10–11) |

---

## 1. Shared configuration implementation

`src/features/drive-vision/api/python-api.ts` (server only):

- **`pythonApiBase(env)`** returns the base from `PYTHON_API_URL`, or `null`.
  - Missing, blank or unparsable values give `null`.
  - Only absolute `http:`/`https:` URLs are accepted. `ftp:`, `file:`, `javascript:` and schemeless values are
    rejected.
  - URLs with credentials, a query or a fragment are rejected.
  - Trailing slashes are removed.
- **`pythonApiUrl(path, env)`** returns `base + path` with exactly one slash. A base ending in `/api` is not doubled
  (`…/api` + `/api/sensors/alerts` → `…/api/sensors/alerts`).
- **New: allowlisted paths.** `PYTHON_API_PATHS` is the only set of upstream paths:
  - `irisChat` → `/api/chat/message`
  - `irisHealth` → `/health`
  - `sensorAlerts` → `/api/sensors/alerts`

  The parameter is typed to these values and checked at runtime; anything else throws. Proxies pass only these
  constants, so no request value can choose the upstream URL. The Sensors query string is built only from validated
  `tenant_id` and `vehicle_number`.
- **Missing config:** `503 {"error":"not_configured"}`, plus a one-time server log naming the variable.
- **Exposure:** never `NEXT_PUBLIC_`, and not imported by any client module (tested and bundle-scanned).

Configuration state:
- **`.env.example`:** one `PYTHON_API_URL=http://185.193.19.156:8088`. `IRIS_CHAT_API_URL` and `SENSOR_ALERTS_API_URL`
  are gone (they were migrated in the previous step).
- **`.env.local`:** `PYTHON_API_URL` set; the BFF and GPSTrackTech settings untouched. Line 7 still holds a
  commented-out `# NEXT_PUBLIC_PYTHON_API_BASE_URL=…`. It has no effect, and it was left alone because only the
  example file was in scope. Delete it at will.
- **Separate services:** the Java BFF (`NEXT_PUBLIC_API_BASE_URL=http://185.193.19.156:9096`) and the GPSTrackTech
  video configuration are unchanged.

## 2. Sensor Alerts proxy implementation

Browser: `GET /api/sensors/alerts?tenant_id=…&vehicle_number=…` (same-origin, `route.ts`).
Server: `forwardSensorAlerts()` → `GET ${PYTHON_API_URL}/api/sensors/alerts?…`

Order of checks:
1. Cross-site (`Sec-Fetch-Site` ≠ `same-origin`) → 403.
2. Parameters:
   - `tenant_id` must be a positive integer.
   - `vehicle_number` must be 1–20 characters of `[A-Za-z0-9 -]`, not "undefined" or "null".
   - Other parameters are dropped.
   - Invalid input → 400.
3. Python configuration → 503 if missing.
4. Caller verification and permission (§4, §6) → 401 / 403 / 502.
5. Tenant decision (§5) → 403 on a cross-tenant request.
6. Upstream call (20 s timeout), forwarding only `tenant_id` and `vehicle_number`, with no auth or cookie headers.

Response mapping:

| Upstream or condition | Our status | Body |
| --- | --- | --- |
| 200 | 200 | upstream JSON, passed through and validated by the client |
| 400 / 404 / 500 / other 4xx–5xx | same status | `{"error":"upstream"}` (no upstream text) |
| connection refused / DNS | 502 | `{"error":"unreachable"}` |
| timeout | 504 | `{"error":"timeout"}` |
| config missing | 503 | `{"error":"not_configured"}` |

Stack traces and exception messages are never returned or logged. Only the status is logged.

## 3. Iris proxy implementation

The browser routes are unchanged: `POST /api/iris/chat` and `GET /api/iris/health`. Server side, `forwardIrisChat` →
`POST ${PYTHON_API_URL}/api/chat/message`, and `forwardIrisHealth` → `GET ${PYTHON_API_URL}/health`.

- **Request contract unchanged:** `{ message, conversation_uuid? }`, validated (message 1–10 000 characters, UUID
  format, body size limit). Extra fields are dropped. Only `Accept` and `Content-Type` go upstream.
- **Response handling unchanged:** conversation UUID matching, `created_at` parsing and Markdown rendering behave as
  before (all 39 Iris tests pass).
- **Added:** caller verification plus the `assistant` feature from the centralized resolver. The `assistant` feature
  is defined as every signed-in role, drivers included.
- **Client:** `iris-chat-service.ts` now sends the session token to **our** route through the shared
  `same-origin-auth.ts` helper. An expired token is refreshed once. With no session, the request isn't sent and the
  UI shows its existing "You don't have access to Iris right now" message.

## 4. Authentication validation

The new `src/features/drive-vision/api/safefare-caller.ts` is shared by both proxies:
- It reads `Authorization: Bearer <token>` (bounded length and charset).
- It confirms the token with the **Java BFF**, `GET /api/v1/me/permissions`, with a 15 s timeout.
- **Responses:**
  - BFF 401/403 → our 401 `unauthenticated`;
  - BFF down or invalid → 502 `identity_unavailable`;
  - missing BFF config → 503.

The token is sent **only** to the BFF. Neither proxy forwards `Authorization`, `Cookie` or any tenant header to Python
(tested for both).

**Real check (§8):** a fake token sent through the running server was rejected by the real BFF, and the proxy
answered 401.

## 5. Tenant isolation

`decideSensorTenant(identity, requested)` runs on the verified identity:
- **Tenant user:** `tenant_id` always comes from the token. A different requested tenant is rejected (`403
  cross_tenant`). A user without a tenant is rejected (`403 no_tenant`). If none was requested, the user's own tenant
  is sent.
- **Safe-Fare Admin** (`platform: true` from the BFF): the selected tenant, or omitted in All Tenants mode. Only a
  verified platform identity can omit it.
- **Isolation is unchanged and tested** (cross-tenant rejection, own-tenant forcing, admin selection and omission).

Iris carries no tenant. Per the existing policy, protecting tenant data in chat answers is the chat service's job.

## 6. Permission enforcement

Both proxies call the same centralized resolver as the UI, `computeAccess(identity)`:
- **Sensor Alerts:** `access.screens.has("sensors")` (the Sensors screen = `sensor.read`, including driver
  narrowing). The previous ad-hoc `permissions.has("sensor.read")` was removed.
- **Iris:** `access.features.has("assistant")`.

## 7. Upstream connectivity results (real, from this Windows machine, no credentials)

| Request | Status | Body |
| --- | --- | --- |
| `GET http://185.193.19.156:8088/api/sensors/alerts` | **404** | `{"detail":"Not Found"}` |
| `GET …/api/sensors/alerts?tenant_id=1&vehicle_number=AP31Z0044` | **404** | `{"detail":"Not Found"}` |
| `POST …/api/chat/message` `{"message":"What is a safety score?"}` | **404** | `{"detail":"Not Found"}` |
| `GET …/health` | **404** | `{"detail":"Not Found"}` |
| `GET …/openapi.json` | 200 | title **"SafeFare - Vehicle Maintenance (local check)"** |

What this means: the server is reachable (uvicorn answers in about 0.2–3 s), but **the expected routes are not
deployed there**. Reachability is not integration. The routes the server actually publishes are:
- `POST`/`GET /api/vehicle-maintenance`
- `GET /api/vehicle-maintenance/{vehicle_number}`
- `PATCH …/expected-date`
- `POST …/complete`
- `GET /dev/whoami`
- `POST /dev/switch-role`
- `POST /dev/run-scheduler`

## 8. Exact HTTP status codes through the local Next.js server (real)

| Request to `http://localhost:3000` | Status | Body | Meaning |
| --- | --- | --- | --- |
| `GET /api/iris/health` (same-origin, before Iris auth was added) | **404** | `{"error":"upstream"}` | Next.js forwarded to `PYTHON_API_URL/health`; Python answered 404 |
| `GET /api/iris/health` (no token, after the fix) | 401 | `{"error":"unauthenticated"}` | auth enforced |
| `POST /api/iris/chat` "What is a safety score?" (no token) | 401 | `{"error":"unauthenticated"}` | auth enforced |
| `GET /api/sensors/alerts?tenant_id=1&vehicle_number=AP31Z0044` (no token) | 401 | `{"error":"unauthenticated"}` | auth enforced |
| `GET /api/sensors/alerts` with `Bearer not.a.real.token` | 401 | `{"error":"unauthenticated"}` | **real BFF** rejected the token |
| `GET /api/sensors/alerts` with `Sec-Fetch-Site: cross-site` | 403 | `{"error":"cross_site"}` | relay protection |

**Not performed:** the signed-in browser sequence (open Sensors → tenant → vehicle → Sensor Alerts; open Iris → ask).
The Claude-in-Chrome extension wasn't connected, and signing in would mean entering a password, which was not done.
With the current deployment, both sequences would end in the 404 path. The UI would show:
- Sensors: "The sensor alerts service wasn't found. It may not be deployed yet."
- Iris: "The Iris service wasn't found."

To confirm the signed-in sequence yourself once the correct service is deployed:
1. Sign in at `http://localhost:3000`.
2. Open DevTools → Network.
3. Open Sensors (the request should go to `/api/sensors/alerts`, never `:8088`), then Iris (`/api/iris/chat`).

## 9. Backend deployment issues (for the Python team)

1. **Wrong application on port 8088.** Deploy the Python service that exposes `POST /api/chat/message`,
   `GET /api/sensors/alerts` and (optionally) `GET /health` at `PYTHON_API_URL`, and confirm these routes belong to
   the intended application. If the services must live on different hosts, that conflicts with the single shared
   base URL and needs a decision.
2. **Contract confirmations still open:**
   - what `is_alert:false` means;
   - ULT readings other than `no_echo`;
   - time window and paging for alerts;
   - the full list of `iot_kit_id` codes.

## 10. Public development endpoint risks

`/dev/whoami`, `/dev/switch-role` and `/dev/run-scheduler` are listed publicly in `openapi.json` on a
public IP. They were **not** called during this verification (only `GET /openapi.json` was read). By their names,
`switch-role` may change the active role or identity and `run-scheduler` may trigger background jobs. Unauthenticated,
publicly reachable endpoints of that kind are a serious risk. They must be disabled outside development, or restricted
to authorised administrators on an internal network. The interactive `/docs` and `/openapi.json` should not be public
in production either. Nothing was changed on the backend from the frontend.

## 11. Required backend security changes

The Next.js proxy only protects requests that **go through Safe-Fare**. It cannot stop anyone from calling a publicly
reachable Python endpoint directly, and today the Python service has no authentication. Until the following are
**applied and verified**, the service is **not secured**:

1. Restrict port 8088 by firewall or security group to the Next.js server's address and a private network or VPN.
   Allow approved development machines only via VPN.
2. Close public access to tenant-sensitive endpoints (`/api/sensors/alerts`, chat).
3. Disable `/dev/*`, `/docs` and `/openapi.json` in production.
4. Add service-to-service authentication (for example a shared secret or mTLS between Next.js and Python). The proxy
   has a single place to attach it later (`callUpstream` / `forwardSensorAlerts`).
5. Enforce tenant filtering inside Python as defence in depth (never trust `tenant_id` alone).
6. Use HTTPS or private-network transport in production.

## 12. Automated test results

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass (0 problems) |
| `npm run build` | Pass. `/api/iris/chat`, `/api/iris/health`, `/api/sensors/alerts` are dynamic routes |
| Bundle scan (`.next/static`) | No `PYTHON_API_URL`, no `185.193.19.156:8088`, no `:8088` |
| `npm test` | **944 tests: 940 pass, 2 fail, 2 todo** |
| Proxy integration tests | `python-api-config` (9), `iris-chat` (39), `sensor-alerts` (34): **all pass** |

The 2 failures (`access-policy` #7, `access-v10` #36) expect no `assistant` capability. That comes from the
uncommitted Iris assistant work already in the tree; it is unrelated to this change and failed before it.

Coverage added or updated in this step:
- **Shared URL:** missing and invalid configuration (including `javascript:`, `file:`, credentials, query, fragment),
  trailing slashes, no `/api/api`.
- **Allowlist:** only allowlisted paths (`/dev/switch-role`, `//evil.test`, `..`, queries all rejected); no
  hardcoded URLs in either proxy.
- **Forwarding:** Sensor Alerts query forwarding; tenant enforcement; cross-tenant rejection; admin tenant selection
  and omission; Iris message forwarding with the documented fields only.
- **Authentication:** no Safe-Fare token to Python (both integrations); Iris requires a verified user with
  `assistant` (chat and health), and rejects missing, malformed and BFF-rejected tokens.
- **Upstream failures** for both proxies: 404, 500, timeout, connection refused.
- **Centralized resolver** used by both proxies.

## 13. Real versus mocked verification

| Claim | How verified |
| --- | --- |
| Proxy logic, tenant isolation, permissions, token isolation, error mapping | **Mocked**: stub fetch for the BFF and Python |
| Next.js forwards to the configured Python host | **Real**: `GET /api/iris/health` via the running server → Python 404, reported as `404 upstream` |
| Proxies require authentication; the BFF rejects bad tokens | **Real**: requests to the running server (401 / 403) |
| Python routes exist and answer | **Real: they don't.** All four checks → 404 on the Vehicle Maintenance app |
| Successful Sensor Alerts or Iris response from Python | **Not observed.** No live success is claimed |
| Signed-in browser flow | **Not performed** (no browser automation available, no sign-in) |

## Files changed in this step

| File | Change |
| --- | --- |
| `src/features/drive-vision/api/python-api.ts` | `PYTHON_API_PATHS` allowlist; typed and runtime-checked `pythonApiUrl` |
| `src/features/drive-vision/api/safefare-caller.ts` | **New.** Shared caller verification with the BFF and `computeAccess` |
| `src/features/drive-vision/api/same-origin-auth.ts` | **New.** Browser helper: session token to our routes, one refresh on 401 |
| `src/features/drive-vision/api/iris-chat-proxy.ts` | Requires a verified caller with `assistant` (chat and health); allowlisted paths |
| `src/features/drive-vision/api/iris-chat-service.ts` | Sends the session token to the same-origin route (never to Python) |
| `src/features/drive-vision/api/sensor-alerts-proxy.ts` | Uses `safefare-caller`, the Sensors screen from the resolver, allowlisted path |
| `src/features/drive-vision/api/sensor-alerts-service.ts` | Uses the shared `same-origin-auth` helper (behaviour unchanged) |
| `src/features/drive-vision/api/sensor-alerts.ts` | Removed the duplicate upstream path constant |
| `tests/python-api-config.test.cjs`, `tests/iris-chat.test.cjs`, `tests/sensor-alerts.test.cjs` | Updated and new tests listed in §12 |

There were no backend changes, no changes to the BFF or GPSTrackTech configuration, and no changes to the Sensors or
Iris UI or formatting.
