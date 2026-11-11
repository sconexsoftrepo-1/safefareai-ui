# Sensors & Safety Monitoring: Sensor Alerts integration and Python API consolidation

Date: 2026-11-09 · Branch `new-features/Prakash` · Next.js 16.4.2 · Supersedes the first Sensor Alerts report of the same day.

**In short:** the Sensors screen now opens on **Sensor Alerts**, its first and default tab, laid out as a fleet
safety dashboard. Both Python integrations (Iris chat and Sensor Alerts) now read one server-only base URL,
`PYTHON_API_URL`.

> **Verification status.** All functional verification is **mocked** (stub fetch, the supplied sample response, and
> synthetic records). The live check against `185.193.19.156:8088` found **a different application on that port**:
> FastAPI "SafeFare - Vehicle Maintenance (local check)". Its route list has neither `/api/sensors/alerts` nor
> `/api/chat/message`, and both answer `404 {"detail":"Not Found"}`. **No live Sensor Alerts or Iris response has
> been observed.** See §18.

---

## 1. Previous Python base URL configuration

| Variable | Used by | Where |
| --- | --- | --- |
| `IRIS_CHAT_API_URL` | Iris chat proxy (`/api/iris/chat`, `/api/iris/health`) | `iris-chat-proxy.ts`, `.env.example`, `.env.local` |
| `SENSOR_ALERTS_API_URL` | Sensor Alerts proxy (`/api/sensors/alerts`) | `sensor-alerts-proxy.ts`, `.env.example` (never set in `.env.local`) |

Both pointed at `http://185.193.19.156:8088`. Each proxy had its own copy of the "normalise base URL" logic.
`.env.local` also contains a commented-out `# NEXT_PUBLIC_PYTHON_API_BASE_URL=…` line, which is unused and was left
untouched.

## 2. New `PYTHON_API_URL`

```env
PYTHON_API_URL=http://185.193.19.156:8088
```

`src/features/drive-vision/api/python-api.ts` is the single place that reads it:

- `pythonApiUrl(path, env = process.env)` returns `${PYTHON_API_URL}${path}`, or `null` when the variable is
  missing or invalid. Callers then answer `503 not_configured`, and a one-time server warning names the variable.
- **Validation:** it must be an absolute `http`/`https` URL with no query, fragment or credentials.
- **Slashes:** trailing slashes on the base and leading slashes on the path are normalised to exactly one.
- **No `/api/api`:** a base that already ends in `/api` is not doubled.
- **Server-only:** it has no `NEXT_PUBLIC_` prefix and isn't imported by any client module. The production bundle
  (`.next/static`) contains neither the variable name nor the host (scanned after build).

| Feature | Upstream URL |
| --- | --- |
| Iris chat | `${PYTHON_API_URL}/api/chat/message` |
| Iris health | `${PYTHON_API_URL}/health` |
| Sensor Alerts | `${PYTHON_API_URL}/api/sensors/alerts` |

**Config files:**
- **`.env.example`:** the two old blocks were replaced by one `PYTHON_API_URL` block.
- **`.env.local`:** only the key name changed (`IRIS_CHAT_API_URL=` → `PYTHON_API_URL=`, same value), so Iris keeps
  its configuration and Sensor Alerts is now configured too. No other line was touched or read.

## 3. Iris API migration

`iris-chat-proxy.ts` now calls `pythonApiUrl(path, env)`. Its contract, request validation, error codes, same-origin
routes (`/api/iris/chat`, `/api/iris/health`) and browser code are unchanged. All Iris tests pass with the new
variable (`tests/iris-chat.test.cjs`, env fixtures renamed).

## 4. Sensor Alerts API migration

`sensor-alerts-proxy.ts` now calls `pythonApiUrl("/api/sensors/alerts", env)`. Everything else is preserved:
- the identity check against the BFF (`GET /api/v1/me/permissions` with the caller's own token);
- the server-side tenant decision;
- forwarding only `tenant_id` and `vehicle_number`;
- never forwarding the Safe-Fare token or cookies to Python;
- fixed error codes.

## 5. Services deliberately kept separate

| Service | Configuration | Changed? |
| --- | --- | --- |
| Safe-Fare Java BFF | `NEXT_PUBLIC_API_BASE_URL=http://185.193.19.156:9096` (`api/config.ts`) | No. The Sensor Alerts proxy still verifies callers against it |
| GPSTrackTech video | `y.gpstracktech.com` in `monitoring/gps-video.ts`, `NEXT_PUBLIC_GPS_VIDEO_API_TOKEN` | No |

Both are covered by `tests/python-api-config.test.cjs`.

## 6. Sensor Alerts tab redesign

The **same** Sensors screen and route (`/drive-vision/sensors`) was redesigned; there is no new page.

**Page title.** The app shell shows the h1 and subtitle from `nav-config.ts`. An optional `title` field was added to
`NavItem`, so the heading reads **Sensors & Safety Monitoring** while the sidebar entry stays "Sensors". Subtitle:
"Monitor vehicle sensor activity, passenger counts, BMS reconciliation and safety alerts."

**Toolbar.** Refresh, plus Recalculate and Add reading on the reconciliation tabs only (§15).

**Vehicle panel:**
- The existing dropdown, now labelled **Vehicle**.
- On Sensor Alerts, a powder-blue note says the time window doesn't apply to alerts. On the four reconciliation tabs,
  the existing time-window selector shows instead. Sensor Alerts never implies time filtering.

**Main navigation.** `SensorsTabs`, a WAI-ARIA `tablist` (arrow keys, Home/End, roving tabindex):
- Tab order: **Sensor Alerts** · Sensor vs BMS · Stops · BMS records · Sensor readings.
- The active tab is coral `#F16A45` with navy `#24344D` semibold text, about 4.1:1. White on this coral would be
  about 3.0:1, so navy gives more contrast. It meets WCAG AA for large text and UI components, but not the 4.5:1
  small-text level.
- Inactive tabs turn powder blue on hover.
- The Sensor Alerts tab shows a count of active alerts.
- The bar wraps on narrow screens rather than hiding tabs behind horizontal scrolling.

**Sensor Alerts content, in order:**
1. Heading "Sensor alerts" with a scope chip (registration or "All vehicles") and "Loaded HH:MM:SS PM IST".
2. Five summary cards (§14). **Active alerts** is coral-tinted and featured; on mobile it leads at full width.
3. **Latest critical sensor event:** a large card with a coloured edge. It shows only an actual alert (§9 of the
   brief), or a "No active sensor alerts" state when there is none.
4. Filters:
   - Sensor: All, Ultrasonic, Smoke, Alcohol, Unknown, each with a count.
   - Status: All, Active alerts, Normal events, Unknown status.
   - Registration search (All vehicles only).
   - Clear filters.
5. **Recent sensor alerts:** the history, as event groups (§11) of cards, 20 events per page with "Show more".

**Palette and type:** coral, powder `#DCEEFF`, navy, `#F7F8FC` canvas, `#718096` muted text, `#E7EBF2` borders, Plus
Jakarta Sans, all from existing theme tokens. Nothing was redefined.

## 7. Default selected tab

**Sensor Alerts on every fresh entry.** The app has no per-screen tab-persistence pattern, so none was added.
Switching tabs keeps each tab's loaded data in memory (`useApiQuery`), so returning to a tab doesn't blank it.

## 8. Vehicle dropdown reuse

There is still one dropdown, with the same data source (`GET /devices`) and the same device-to-registration mapping.
The mapping was kept because nothing showed it to be wrong:
1. Use `DeviceDto.vehicleId` → `GET /vehicles/{id}` → `vehicleNumber`.
2. If `vehicleId` is absent, search `GET /vehicles?assigned=true` for the vehicle fitted with this device.
3. If `vehicleId` is `null`, the bus isn't fitted to a vehicle. The tab shows "No registration number for this bus"
   and sends **no** request. The terminal number is never sent and no registration is invented.

The device id, terminal number and `iot_kit` are never sent as `vehicle_number` (tested). The screen still opens on
the first bus, as before. "All vehicles" is the first option in the list.

## 9. All Vehicles behaviour

- **All vehicles:** the request omits `vehicle_number`, and alerts show for every permitted vehicle, with no
  "Choose a bus" anywhere on the Sensor Alerts tab.
- **No bus to choose** (no `device.read`, the device list failed, or there are no devices): Sensor Alerts
  automatically covers all permitted vehicles. Previously the whole screen showed "Choose a bus".
- **Reconciliation tabs:** they still need one bus, so with All vehicles they show a short "Choose a bus" prompt that
  points back to the Vehicle list. They send no per-bus requests.

## 10. Tenant handling

Unchanged, and enforced on the server:

- **Tenant user:** `tenant_id` is always taken from the verified token. Requesting another tenant gets
  `403 cross_tenant`; a user without a tenant gets `403 no_tenant`.
- **Safe-Fare Admin** (`platform: true` per the BFF): the selected tenant's id, or omitted in All Tenants mode. Only
  a verified platform identity can omit it; for a tenant user, an omitted `tenant_id` is filled in with their own.
- **No `sensor.read`:** `403`. Invalid token: `401`.
- **Tenant switch:** query keys are tenant-scoped, so the previous tenant's alerts disappear at once and late
  responses are discarded (tested).

## 11. Sensor interpretation

| Code | Name | `is_alert === true` | Notes |
| --- | --- | --- | --- |
| `ULT` | Ultrasonic Sensor | **Vehicle approaching very close** (only with reading `no_echo`) + **N meters** | Distance from `distance:N`; missing or invalid → "Distance unavailable". Another or missing reading → "Ultrasonic sensor alert" (no inferred proximity) |
| `SMK` | Smoke Sensor | **Smoking detected** | `value:N` / `reading:alert` never read or shown |
| `ALC` | Alcohol Sensor | **Alcohol detected** | same |
| other | none (not invented) | **Sensor event** with the actual code | Kept; "Unknown" filter |

`is_alert`:
- `true` → **Active alert**.
- `false` → **Normal**, titled "Normal reading". No specific meaning such as "no smoke" is claimed, because it isn't
  confirmed.
- `null` or missing → **Unknown status**, "Reading with unknown status".

## 12. Friendly messages

- **Raw payload:** `sensor_data` is never rendered. Tests scan the rendered page for `value:N`, `distance:N`,
  `reading:…`, `no_echo` and `sensor_data`.
- **Errors use fixed plain-language messages:**
  - missing configuration → "Sensor alerts aren't set up on this server yet";
  - refused connection or 502/503 → "can't be reached right now";
  - timeout → "took too long";
  - 400 → "didn't accept this request";
  - 401 → "session is not valid";
  - 403 → "don't have access" (or "only your own organisation");
  - 404 → "wasn't found. It may not be deployed yet";
  - 500 → "ran into a problem";
  - invalid JSON or shape → "couldn't be read";
  - `success:false` → "couldn't return alerts right now".
- **No silent substitution:** mocked data is never substituted when the service is unreachable.

## 13. IST formatting

Timestamps are formatted **from their own digits**, with no `Date` parsing, no `Z`, no offset and no browser time zone:
`2026-11-08T17:45:13` → **08 Nov 2026, 05:45:13 PM IST**. An explicit `+05:30` is accepted. Any other zone, or an
impossible date, shows "Time unavailable" rather than being converted. The only conversion is the panel's own
"Loaded … IST" clock, which is the browser's epoch formatted in `Asia/Kolkata`.

## 14. Summary calculation logic

All five cards are computed in one pass over the **currently filtered** records:

| Card | Rule | Style |
| --- | --- | --- |
| Total records | records shown (sublabel "Service reported N" when `count` ≠ records returned) | navy on powder |
| Active alerts | `is_alert === true` | coral, featured |
| Ultrasonic alerts | ULT and `is_alert === true` | powder blue |
| Smoking alerts | SMK and `is_alert === true` | amber |
| Alcohol alerts | ALC and `is_alert === true` | coral/red |

`false` and `null` are never counted as active. Each record counts once, regardless of grouping. `count` from the
service is kept separately from `alerts.length` (the sample has `count: 21` with 3 records).

## 15. Existing functionality preserved

- **The four reconciliation tabs** (Sensor vs BMS, Stops, BMS records, Sensor readings) call the same BFF endpoints
  with the same windows, columns, paging and filters. No calculation was changed.
- **Per-bus panels:** the Alcohol check card, the six KPI cards (bus capacity, on board BMS/sensor, latest difference,
  match rate, over-capacity stops) and the mismatch badges are unchanged. They now render under the reconciliation
  tabs instead of above the tab bar.
- **Recalculate and Add reading:** same APIs, permissions and dialogs. They're shown on the reconciliation tabs, which
  is where the time window and the chosen bus they act on are visible. Neither calls the Sensor Alerts API (tested).
- **Refresh** reloads the active tab's data only:
  - on Sensor Alerts, the alerts;
  - on the other tabs, the per-bus BFF data, as before.
- No automatic polling.

## 16. Tests and build results

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass (0 problems) |
| `npm run build` (Turbopack) | Pass. `/api/iris/chat`, `/api/iris/health`, `/api/sensors/alerts` are dynamic routes |
| `npm test` | **940 tests: 936 pass, 2 fail, 2 todo** (results in §16a) |
| Contract tests (`v10-contract`) | Pass |
| Bundle scan | No `PYTHON_API_URL` and no Python host in `.next/static` |

**§16a.** The 2 failures are `access-policy.test.cjs` #7 and `access-v10.test.cjs` #36. They expect no `assistant`
capability, which comes from the uncommitted Iris assistant changes already in the working tree. They are not related
to this work and failed before it.

During one run with the build and screenshot capture going at the same time, `operations-api` "driver assignment"
and `v10-contract` "save preferences" also failed once. Both files pass on their own (174/174), and the clean full
run above is the reference, so that was load-related timing.

**New or updated test files:**
- `tests/python-api-config.test.cjs` (new, 6 tests):
  - one base URL for all Python paths;
  - slash and `/api` normalisation;
  - invalid or missing config → `503 not_configured` for both features;
  - old variables removed from `src` and `.env.example`;
  - BFF and GPSTrackTech unchanged;
  - no client import or `NEXT_PUBLIC_` exposure.
- `tests/sensor-alerts.test.cjs` (34 tests): the model, service, proxy, panel and full page in jsdom. Covers:
  - Sensor Alerts is the default first tab; tab keyboard navigation;
  - time window hidden on alerts;
  - registration from the registry; All Vehicles; the no-bus fallback; tenant switch;
  - stale-response race; Refresh per tab;
  - Recalculate isolation; filters, including Unknown;
  - group expand and collapse; summary counts; IST formatting;
  - error states and retry; tenant isolation.
- `tests/iris-chat.test.cjs`: env fixtures renamed to `PYTHON_API_URL`. All Iris tests pass.

## 17. Screenshots

`docs/evidence/screenshots/sensor-alerts/` contains **mocked renders**: the real `SensorsPage` was server-rendered with
the production CSS, using stubbed query data (the supplied sample plus synthetic normal, unknown-status,
missing-distance, unknown-code and other-vehicle records), then captured in headless Edge.

| Scenario | 320 | 375 | 768 | 1024 | 1440 | 1920 |
| --- | --- | --- | --- | --- | --- | --- |
| One vehicle (AP31Z0044) | `page-vehicle-320.png` | `-375` | `-768` | `-1024` | `-1440` | `-1920` |
| All vehicles | `page-all-vehicles-320.png` | `-375` | `-768` | `-1024` | `-1440` | `-1920` |

**Results:**
- No element extends past its container and the page doesn't scroll horizontally at any of the six widths.
- Plus Jakarta Sans Variable is loaded.
- Two layout issues found during this check were fixed: the sensor filter clipping at 320px, and the registration
  search overflowing at 1024px.

**Caveats:**
- The vehicle dropdown is a native `<select>` stand-in in these static renders (Radix needs JavaScript to show its
  value), and the shell's title block is rendered from the real `nav-config` metadata.
- For 320/375 the page container was constrained inside a 520px window, because headless Edge can't size a window
  smaller. The layout uses container queries, so it is the layout those widths get.
- `vehicle-scope-*.png` and `all-vehicles-*.png` in the same folder are from the **earlier, panel-only iteration**.
  They are superseded and kept only for history.

## 18. Mocked versus live verification

| Aspect | Mocked | Live |
| --- | --- | --- |
| Sensor interpretation, UI, filters, grouping, summary | Yes | No |
| Proxy → Python request building (`PYTHON_API_URL`) | Yes (stub) | Partial: host reachable, but `/api/sensors/alerts` → **404** |
| Iris → Python (`/api/chat/message`, `/health`) | Yes (stub) | Partial: both → **404** on the same host |
| Proxy → BFF identity check | Yes (stub) | No (needs a signed-in session) |
| Responsive layout and font | Yes (headless Edge, production CSS) | n/a |

Live probe, read-only GETs only:
- `GET /openapi.json` on `185.193.19.156:8088` describes **"SafeFare - Vehicle Maintenance (local check)"**, with
  `/api/vehicle-maintenance…` and `/dev/whoami`, `/dev/switch-role`, `/dev/run-scheduler`.
- With that service deployed, the Sensors tab would show "The sensor alerts service wasn't found. It may not be
  deployed yet.", and Iris would show as unavailable.

## 19. Backend limitations and dependencies

1. **Deployment.** Port 8088 currently serves the Vehicle Maintenance app, not the Sensor Alerts or Iris endpoints.
   The Python service exposing `/api/sensors/alerts` and `/api/chat/message` needs to be running at `PYTHON_API_URL`.
   Separately, that host exposes `/dev/switch-role` and `/dev/run-scheduler` publicly, which the backend team may want
   to restrict.
2. **Authentication.** The sensor service has none. The proxy enforces tenant isolation, but the service should
   ideally verify the Safe-Fare token (or a service credential) itself.
3. **No time window or paging.** The service can't filter by date or page results, so Sensor Alerts can't follow the
   screen's time window. `count: 21` against 3 records in the sample suggests truncation.
4. **`is_alert: false` semantics.** Not confirmed, so the UI says "Normal reading" rather than "No smoking alert".
5. **ULT readings other than `no_echo`** have no confirmed mapping.
6. **`vehicleId` on `GET /devices`.** Confirm it's on the list response; otherwise the registry search fallback costs
   more requests.
7. **Full list of `iot_kit_id` codes.** Needed so new sensors get names and messages instead of "Sensor event".
