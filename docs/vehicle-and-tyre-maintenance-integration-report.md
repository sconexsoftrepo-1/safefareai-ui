# Vehicle Maintenance, Tyre Maintenance and Maintenance Notifications — Integration Report

Date: 2026-11-10 · Branch `new-features/Prakash` · Next.js 16.4.2 · Nothing committed; existing uncommitted work untouched.

> **Status in one line:** implemented end to end and tested against stubs. **No live Python response was
> observed.** At 10:43 UTC, `185.193.19.156:8088` refused TCP connections. Earlier the same day it accepted
> connections but never answered. So every Python contract here comes from the brief, not from the running service.

---

## 1. Files inspected

- **Python integration pattern:**
  - `src/features/drive-vision/api/python-api.ts` (shared `PYTHON_API_URL`, path allowlist);
  - `safefare-caller.ts` (BFF caller verification);
  - `same-origin-auth.ts`;
  - `sensor-alerts-proxy.ts` / `sensor-alerts-service.ts` / `app/api/sensors/alerts/route.ts`;
  - `iris-chat-proxy.ts` / `app/api/iris/*`.
- **Auth, tenant and access:**
  - `access/access-policy.ts` (`computeAccess`, `Access`, `reachableHref`);
  - `access/identity.ts` (`identityKind`, no confirmed Fleet Owner role code);
  - `api/tenant-context.ts` (Admin's selected tenant, `DEFAULT_TENANT_HEADER`);
  - `hooks/use-api-query.ts` (tenant-scoped keys).
- **Vehicles screen:** `components/drive-vision/vehicle-registry/vehicle-registry-page.tsx`. This is the "Vehicles" page with Register vehicle, Refresh, the All / Without a device tabs, filters, and the existing `VehicleDrawer` slide-over with a `?vehicle=` deep link. Also `vehicle-registry-service.ts` and `docs/contracts/vehicle-api.txt`.
- **Notifications:**
  - `app-shell/notification-center.tsx`;
  - `app-shell/notifications-model.ts`;
  - `alert-service.ts` (poll / list / mark read / read-all);
  - `types-operations.ts` (`NotificationListQuery`).
- **Formatting:** `utils/format.ts` (`formatLocalDateTime`; the existing "vendor time shown as sent" convention for timestamps without a zone).
- **Earlier reports:**
  - `docs/python-api-proxy-security-report.md` (the 8088 host served "SafeFare - Vehicle Maintenance (local check)" with public `/dev/*` routes);
  - `docs/sensor-alerts-api-integration-report.md`;
  - `docs/feature-status.md` (Fleet Owner role code unconfirmed).
- **Tests and harnesses:**
  - `tests/python-api-config.test.cjs`;
  - `tests/notifications-alerts-polling.test.cjs`;
  - `tests/device-vehicle-mapping.test.cjs` (jsdom harness);
  - `tests/helpers/*`.

## 2. Files created and modified

**Created**

| File | Purpose |
| --- | --- |
| `src/features/drive-vision/access/maintenance-access.ts` | Who may use maintenance (Admin / Fleet Owner), which tenant, which actions. Pure; shared by the UI and the proxy |
| `src/features/drive-vision/api/maintenance.ts` | Types for every documented response, tolerant parsers, body and query validators, plain-date and timestamp handling, the unified notification model, the tenant-id walker, upstream error reader |
| `src/features/drive-vision/api/maintenance-proxy.ts` | Server proxy: caller, role and tenant decision, allowlisted Python calls, write guards, error mapping, the notifications feed |
| `src/features/drive-vision/api/maintenance-service.ts` | Browser client for the same-origin routes |
| `src/app/api/maintenance/**/route.ts` (9 files) | Thin route handlers (see §9) |
| `src/components/drive-vision/vehicle-registry/vehicle-maintenance-panels.tsx` | Drawer tabs: Vehicle Maintenance, Tyre Maintenance, Maintenance Alerts |
| `src/components/drive-vision/app-shell/maintenance-notifications.tsx` | Maintenance rows, feed notes and read-state note for the popover |
| `tests/maintenance-proxy.test.cjs` (15 tests), `tests/maintenance-ui.test.cjs` (21 tests) | New tests |

**Modified**

| File | Change |
| --- | --- |
| `api/python-api.ts` | 8 maintenance paths added to the allowlist; `{vehicle_number}` placeholder that only takes a validated, percent-encoded number |
| `api/safefare-caller.ts` | `bffBase` exported (used by the vehicle-membership check) |
| `vehicle-registry/vehicle-registry-page.tsx` | Drawer tabs for Admin / Fleet Owner; `?vehicleNumber=&tab=&alert=` deep link. Table, filters, tabs, Refresh and Register are unchanged |
| `app-shell/notification-center.tsx` | Maintenance tab, maintenance section on All, maintenance pagination; Mark all read guarded |
| `app-shell/notifications-model.ts` | `NotificationTab` adds `MAINTENANCE`; `maintenanceNotificationHref`; `MAINTENANCE_HAS_READ_STATE = false` |
| `tests/python-api-config.test.cjs` | The pinned allowlist and the list of proxy files now include the maintenance paths and proxy. The "must refuse" example `/api/vehicle-maintenance` became the driver-only `…/postpone` |

## 3. Vehicle Maintenance integration

| Endpoint | Used? | Where |
| --- | --- | --- |
| `GET /api/vehicle-maintenance/{vehicle_number}` | Yes | Vehicle Maintenance tab |
| `POST /api/vehicle-maintenance` | Yes | Create schedule (tab) |
| `GET /api/vehicle-maintenance` (list) | Yes | Notifications feed (to find vehicles with schedules); exposed at `/api/maintenance/vehicle` with the documented filters |
| `GET /api/vehicle-maintenance/alerts?vehicle_number=` | Yes | Maintenance Alerts tab; notifications feed (per vehicle) |
| `PATCH …/{vehicle_number}/postpone` | **No** (driver-only) | Not allowlisted, not proxied, not offered |
| `POST …/{vehicle_number}/complete` | **No** (driver-only) | Not allowlisted, not proxied, not offered |

- **Displayed:**
  - status, vehicle number, driver name;
  - previous date, interval (`maintenance_time_window` days), expected date, due date;
  - days remaining (`days_until_due` exactly as sent; never recomputed);
  - reason, updated time;
  - postponement block (date, reason, when, by) when present, plus completion date when present;
  - the full `reminder_schedule` in server order.
- **Create:**
  - sends only `vehicle_number`, `previous_vehicle_maintenance_date` (from `<input type="date">`, a plain date) and an optional trimmed `reason`;
  - the proxy re-validates and drops anything else (an expected date, an interval, a tenant id);
  - the schedule is re-read after success.
- **No schedule:** a service 404 shows the empty state with **Create schedule** (when allowed). A FastAPI "route not found" 404, a 5xx, a timeout or "not configured" each show an **error**, never the empty state.

## 4. Tyre Maintenance integration

| Endpoint | Used? | Where |
| --- | --- | --- |
| `GET /api/v1/tyre-maintenance/vehicle/{vehicle_number}` | Yes | Tyre Maintenance tab |
| `GET /api/v1/tyre-maintenance/alerts` (`vehicle_number?`, `limit` 1–500) | Yes | Tyre tab (latest 5), Alerts tab (50), notifications feed (tenant-wide, `limit=50`) |
| `GET /api/v1/tyre-maintenance` | Proxied (`/api/maintenance/tyre`) and in the service | Not used by a screen yet (no overview was needed) |
| `POST …/vehicle/{n}/register` `{installation_date}` | Yes | Register existing tyres |
| `POST …/vehicle/{n}/complete` `{replacement_date?}` | Yes | Complete tyre replacement |

- **Displayed:**
  - usage progress bar (`usage_percentage`; the bar width is clamped to 0–100, the text shows the exact value);
  - remaining km, limit, current distance, odometer at tyre change;
  - last tyre change, and last limit reminder when present;
  - status badge.
- **Status colours** come from the value only: `NORMAL` is green, values starting with `CRITICAL` (e.g. `CRITICAL_85`) are red, values starting with `WARNING` are amber, and anything else is neutral, shown as sent. No thresholds are computed.
- **Writes:**
  - date and time are entered in the user's local time (`datetime-local`) and sent as an ISO instant with `Z`;
  - registration requires a date; for replacement, an empty date is omitted, so the backend uses its own current UTC time;
  - after success, both the tyre record and the tyre alerts are re-read;
  - alert rows use the backend `message` unchanged.

## 5. Vehicles screen UI changes

- The table, the All / Without a device tabs, search, filters, Refresh and Register vehicle are unchanged.
- Clicking a row still opens the existing drawer.
- **For the Safe-Fare Admin and Fleet Owners only**, the drawer has four tabs: **Overview** (the previous content, unchanged), **Vehicle Maintenance**, **Tyre Maintenance** and **Maintenance Alerts**. Every other role sees the drawer exactly as before.
- **Data loading:** each tab loads its data only when opened, for that vehicle only. Rendering the table makes no maintenance request (tested). Requests use `vehicleNumber`, never the Safe-Fare vehicle id or device id (tested).
- **Admin with no tenant selected:** "Select a tenant", and no request is sent.
- **Deep link:** `?vehicleNumber=AP31Z0044&tab=alerts&alert=<id>` looks the number up in the tenant's registry (`GET /vehicles?keyword=`, exact match), opens the drawer and selects the tab. If the number isn't there, a notice says so and nothing opens. `?vehicle=<id>&tab=` also works.
- The Edit and Delete footer stays as it was.

## 6. Notifications — Maintenance tab

- Tab order: **AI Events | Alarm | Maintenance | All**. Maintenance appears only for the Safe-Fare Admin and Fleet Owners.
- Each row shows:
  - vehicle number, title / status, source label (Vehicle Maintenance / Tyre Maintenance);
  - Reminder chip (when `is_reminder` is true);
  - the backend message, the alert's own time, a severity dot, and "Level n" for tyre alerts.
- Pagination: 20 rows per page.
- Clicking a row closes the popover and opens the Vehicles drawer on that vehicle's **Maintenance Alerts** tab (see §5 for the tenant check).
- **All tab:** on page 1, when Unread only is off, a "Maintenance" section shows the 3 newest maintenance alerts with **View all (n)**, followed by the existing BFF list. Maintenance items aren't interleaved into the BFF's server-paged list: that would break its pagination, and the two sources' timestamps aren't comparable (tyre times have no zone).
- **Kept unchanged:**
  - header and unread count, Mark all read (for AI Events / Alarm / All);
  - tabs, empty states, Unread only, See more, pagination;
  - Open Alerts & Events;
  - the 5-second poll.
- **Read state:** see §12.4. The badge never counts maintenance alerts. Rows have no unread dot and no read toggle. **Mark all read is disabled on the Maintenance tab and refuses to run there** (it would otherwise call `/notifications/read-all` for every type). A note in the tab states the limitation.
- **Errors and partial data:**
  - an error state is shown, never "No maintenance alerts";
  - when one source fails, or the vehicle part is capped, a warning line names it.

## 7. Alert aggregation strategy

**The constraint:** `GET /api/vehicle-maintenance/alerts` **requires `vehicle_number` and returns that vehicle's latest three alerts**. It is not a tenant-wide feed. Tyre alerts do have a tenant-wide endpoint.

**What the server builds:** `/api/maintenance/notifications` produces the feed on the server, per tenant:

1. In parallel:
   - `GET /api/v1/tyre-maintenance/alerts?limit=50`;
   - `GET /api/vehicle-maintenance?page=1&page_size=100`. Only vehicles with a schedule can have maintenance alerts, which is safer and smaller than walking the whole BFF vehicle list.
2. Deduplicate the vehicle numbers and take **at most 25**.
3. Request each vehicle's alerts with **at most 4 requests at a time**. A 404 counts as "no alerts"; other failures are counted and reported.
4. Normalise both sources into `MaintenanceNotification`, deduplicate by id and sort newest first.
5. **Cache per tenant for 60 s.** Concurrent requests share one build, and `refresh=1` is ignored within 10 s of the last build. Errors aren't cached. The build has its own 45 s timeout, so one closed popover can't cancel it for others.

**Limits that apply:** the cache is in-process (per Node instance). `truncated` is reported when more vehicles or schedules exist. The browser makes **one** request per popover view, never one per vehicle.

**Backend change needed:** a tenant-wide `GET /api/vehicle-maintenance/alerts` (vehicle optional, `limit`, newest first), like the tyre endpoint, would replace up to 26 Python calls per build with one, and remove the 25-vehicle cap.

## 8. Tenant isolation and role access

**Who gets in.** `maintenance-access.ts` is used by both the UI and the proxy.

| Identity | Maintenance UI | Proxy |
| --- | --- | --- |
| Safe-Fare Admin (`platform === true`) with a tenant selected | Yes | Yes, in the selected tenant |
| Safe-Fare Admin, platform-wide mode | "Select a tenant" | `400 tenant_required` |
| Fleet Owner | Yes | Yes, always in the tenant from their token |
| Driver, tenant ADMIN, dispatcher, viewer, others | No tabs, no Maintenance tab | `403 forbidden` |

- **Fleet Owner role code:** the V10 spec has no maintenance permission, and the backend has never confirmed the Fleet Owner role code. Access is therefore narrowed by identity: a non-platform, non-driver user whose role code normalises to `FLEET_OWNER` ("FLEET_OWNER", "Fleet Owner", "fleet-owner"). **Add the real code to `FLEET_OWNER_ROLE_CODES` once confirmed.** The tenant ADMIN is excluded, following the brief ("Safe-Fare Admin and Fleet Owner"); widening that is a one-line change.
- **Tenant decision (server only):**
  - The caller's token is verified with the BFF (`GET /me/permissions`) and `computeAccess` runs on the result.
  - A Fleet Owner's tenant is `identity.tenantId`. If the browser names a different tenant in the tenant header, the request is refused with `403 cross_tenant`; it is not silently replaced (tested).
  - The Admin's selected tenant is taken from that header only after the identity is verified as platform. Tenant users can't select a tenant.
  - The tenant goes to Python as `X-Tenant-ID`, on every maintenance call.
- **Defence in depth:**
  - Any `tenant_id` in a Python response that differs from the decided tenant makes the proxy withhold the body (`502 tenant_mismatch`).
  - Writes first confirm through the BFF, with the caller's token, that the vehicle number is registered in the tenant (`404 vehicle_not_found` otherwise; tested). This matters because the Vehicle Maintenance Swagger declares no tenant header.
- **Credentials:** the Safe-Fare token is never sent to Python (tested). The only `Authorization` header the proxy sets is the one on the BFF vehicle lookup.
- **Browser boundary:**
  - The browser only calls `/api/maintenance/**`; no client file references `python-api`, the proxy or the Python host (tested).
  - `PYTHON_API_URL` stays server-only.
  - Python paths come only from the allowlist, and `{vehicle_number}` must match `^[A-Za-z0-9][A-Za-z0-9 -]{0,19}$` (not "alerts") and is percent-encoded. Only documented query parameters and body fields are forwarded.
  - Cross-site requests are refused (`Sec-Fetch-Site`).

## 9. API request/response mapping

| Same-origin route | Python call | Validation |
| --- | --- | --- |
| `GET /api/maintenance/vehicle` | `GET /api/vehicle-maintenance` | `vehicle_number`, `device_id`, `status`, `expected_date_from/to` (plain dates), `page`, `page_size` ≤ 100; others dropped |
| `POST /api/maintenance/vehicle` | `POST /api/vehicle-maintenance` | 3 documented fields; vehicle must be in the tenant |
| `GET /api/maintenance/vehicle/{n}` | `GET /api/vehicle-maintenance/{n}` | number |
| `GET /api/maintenance/vehicle/alerts?vehicle_number=` | `GET /api/vehicle-maintenance/alerts` | `vehicle_number` required |
| `GET /api/maintenance/tyre` | `GET /api/v1/tyre-maintenance` | — |
| `GET /api/maintenance/tyre/alerts` | `GET /api/v1/tyre-maintenance/alerts` | `vehicle_number?`, `limit` 1–500 |
| `GET /api/maintenance/tyre/{n}` | `GET /api/v1/tyre-maintenance/vehicle/{n}` | number |
| `POST /api/maintenance/tyre/{n}/register` | `POST …/vehicle/{n}/register` | `installation_date` (ISO with zone); vehicle in tenant |
| `POST /api/maintenance/tyre/{n}/complete` | `POST …/vehicle/{n}/complete` | `replacement_date?` (ISO with zone); vehicle in tenant |
| `GET /api/maintenance/notifications` | see §7 | — |

**Error mapping.** The upstream status is kept. The body becomes `{error, message?, fields?}`, where `message` comes from FastAPI `detail` (a string, or a 422 list turned into `fields`) or the envelope's `message`, with control characters removed and a 300-character cap.

| Situation | Status and code |
| --- | --- |
| Route not deployed (`{"detail":"Not Found"}`) | `404 upstream_route_missing` |
| Record not found | `404 not_found` |
| Not JSON | `502 upstream_invalid` |
| Connection refused | `502 unreachable` |
| Timeout (20 s) | `504 timeout` |
| `PYTHON_API_URL` missing | `503 not_configured` |

The browser shows the server's message when there is one, otherwise a fixed plain message.

**Response types** (`maintenance.ts`):
- `VehicleMaintenanceSchedule`, `ReminderScheduleItem`, `VehicleMaintenanceEnvelope`;
- `TyreMaintenanceRecord`, `TyreMaintenanceAlert`, `TyreAlertsResponse`;
- `MaintenanceNotification`, `MaintenanceFeed`.

**Shapes not supplied in the brief, read defensively (to confirm live):**

| Endpoint | Accepted shapes |
| --- | --- |
| Vehicle-maintenance **list** | `data` is an array, or `data.items`. Pagination fields are kept only if present |
| Vehicle-maintenance **alerts** | `data`, `data.alerts` or `data.items`. Fields read only when present: `id`, `vehicle_number`, `message`, `alert_type`/`type`, `status`, `created_at`/`sent_at`, `is_reminder` |
| Tyre **list** | A bare array, or `{items}` |

Any other shape is reported as an error, never as empty.

**Dates:**
- Schedule dates (`YYYY-MM-DD`) are formatted from their own digits ("10 Dec 2026"), with no `Date` or time-zone step, so they can't shift a day (tested).
- Timestamps with a zone use the existing `formatLocalDateTime`.
- Tyre timestamps without a zone ("2026-11-09T22:36:42.315000") are shown as sent ("09 Nov 2026, 22:36"), with a tooltip saying no zone was given. They are **not** assumed to be UTC. This follows the existing vendor-time convention.

## 10. Tests and results

| Check | Result |
| --- | --- |
| `node --test tests/maintenance-proxy.test.cjs` | 15 / 15 pass |
| `node --test tests/maintenance-ui.test.cjs` | 21 / 21 pass |
| Full suite `npm test` | **1006 tests, 1002 pass, 2 fail.** Both failures were already failing before this work (`access-policy` "only unrecognised codes…", `access-v10` "Driver (live fixture)…", both about the `assistant` feature) |
| `tsc --noEmit` | Pass |
| `eslint .` | 0 errors. 2 warnings, both already in `login-screen.tsx` (your uncommitted work; not touched) |
| `next build` | Pass; all 9 `/api/maintenance/**` routes built |

Three existing tests needed changes because of this work:
- `python-api-config` pins the allowlist and the list of proxy files. Both were updated to include the new paths and proxy.
- `notifications-alerts-polling` guards one source expression. I reverted my unnecessary edit to it instead of changing the test.
- `phase4-platform-dashboard` requires the tenant header name to come only from `tenant-context`. The proxy and service now use `DEFAULT_TENANT_HEADER` (header names are case-insensitive, so it serves as Python's `X-Tenant-ID`).

**What the new tests cover** (mapped to the brief):

**Vehicle Maintenance**
- fetching a schedule and displaying every field;
- reminder schedule rendering, postponement and completion;
- the no-schedule empty state versus error states;
- Create request and exact body, local validation, Admin 403 shown as sent;
- role restrictions; date-only handling.

**Tyre Maintenance**
- fetching the vehicle record; usage %, remaining km and status tone;
- tenant-wide and per-vehicle alerts, the `limit` bounds;
- register and complete bodies, including the omitted replacement date;
- tenant header injection; refresh after a successful write; the no-record state.

**Notifications**
- tab order; the feed loads only when shown;
- normalisation keeps source and original ids; newest-first sort;
- clicking a row opens the vehicle's Maintenance Alerts tab;
- All includes maintenance; empty and error states;
- no fabricated read state (badge unchanged, Mark all read never called);
- AI / Alarm behaviour kept; no tab for driver, viewer, dispatcher or tenant ADMIN.

**Security**
- Fleet Owner pinned to their tenant, cross-tenant header refused;
- Admin uses the selected tenant and must select one;
- `tenant_mismatch` withholding;
- vehicle-membership guard on writes;
- the allowlist, including the driver-only paths being unbuildable;
- no token to Python; no browser-to-Python path;
- feed bounds: 25 vehicles, ≤ 4 concurrent, per-tenant cache, shared builds, partial failures.

All of these are **mocked**. None of them proves how the live service behaves.

## 11. Live backend verification results

| Check (2026-11-10, read-only, no credentials) | Result |
| --- | --- |
| `GET http://185.193.19.156:8088/openapi.json`, 3 tries with a 90 s timeout (~09:30 UTC) | TCP accepted, **no response** |
| `GET …/health` (20 s) | TCP accepted, no response |
| `GET …/openapi.json`, `GET …/api/v1/tyre-maintenance/alerts` (10:43 UTC) | **TCP connection refused** (`Test-NetConnection` failed) |
| Local production server (`next start`) → `GET /api/maintenance/notifications` (no token) | `401 {"error":"unauthenticated"}` |
| → `GET /api/maintenance/tyre/alerts` with `Bearer not.a.real.token` | `401`. The **real BFF** rejected the token |
| → `GET /api/maintenance/tyre/alerts?limit=999` | `400 invalid_request` |
| → `GET /api/maintenance/vehicle/alerts` (no `vehicle_number`) | `400 invalid_request` |
| → `GET /api/maintenance/vehicle/AP31Z0044` with `Sec-Fetch-Site: cross-site` | `403 cross_site` |
| → `POST /api/maintenance/vehicle` with an incomplete body | `400 invalid_request` |

**Not verified live:**
- any Python response shape;
- whether Python honours `X-Tenant-ID` on Vehicle Maintenance;
- the Admin 403 on create;
- the vehicle-alerts and list shapes;
- the signed-in browser flow.

No maintenance schedule was created, and no tyre registration or replacement was performed. Yesterday's report recorded public `/dev/whoami`, `/dev/switch-role` and `/dev/run-scheduler` routes on this host. They were not called.

**To verify once the service is up:**
1. Sign in as a Fleet Owner.
2. Open Vehicles, open a vehicle, and open each maintenance tab, watching DevTools → Network. Requests should go only to `/api/maintenance/**`.
3. Open the bell → Maintenance.
4. Then repeat as the Safe-Fare Admin with a tenant selected.
5. Confirm the shapes listed in §9, then remove the tolerant branches that turn out to be unneeded.

## 12. Outstanding API limitations

1. **Vehicle Maintenance alerts are vehicle-specific, not tenant-wide.** The feed works around this with the bounded per-vehicle strategy in §7. A tenant-wide alerts endpoint is needed for a complete, efficient feed.
2. **Admin tenant selection on Vehicle Maintenance is unconfirmed.** The Swagger declares no tenant header and says the tenant "comes from the logged-in user". Python receives no Safe-Fare identity (the token isn't forwarded, by design), so it can't know the logged-in user. The proxy sends `X-Tenant-ID` and withholds any answer whose `tenant_id` differs, which keeps tenants isolated whatever Python does. But **if Python ignores the header, Admin and Fleet Owner reads will fail with `tenant_mismatch`** rather than show data, and a create could be recorded under the tenant Python resolves itself (the vehicle-membership check limits this to vehicles of the caller's tenant). The backend must document how it resolves the tenant: a tenant header, or a signed service-to-service identity.
3. **Schedule creation for the Admin:** the Swagger says Fleet Owner only. The Admin is offered the action and sees Python's 403 if it refuses. Nothing is bypassed.
4. **No read / unread state for maintenance alerts.** None of the Python endpoints offers read state or mark-as-read, and the Safe-Fare notification service stores read state only for its own notifications. Maintenance alerts therefore never add to the unread count and can't be marked read; no read state is invented, and nothing is hidden to imitate one. A persistent read state would need either Python read endpoints (e.g. `POST …/alerts/{id}/read`, per user) or the BFF ingesting these alerts as Safe-Fare notifications.
5. **Response shapes not in the brief:** vehicle-maintenance list and alerts, tyre list (§9). They are parsed defensively and need confirming.
6. **Tyre timestamps have no time zone.** They are shown as sent; the backend should document the zone or send ISO with an offset.
7. **Fleet Owner role code** is still unconfirmed (§8).
8. **Service availability and security:** the host was unreachable today. Yesterday it was publicly reachable with unauthenticated `/dev/*` routes. Firewalling and authentication for the Python service remain open (see `docs/python-api-proxy-security-report.md` §11).
