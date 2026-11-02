# Phase 4 — Safe-Fare Admin platform-wide dashboard

Date: 2026-11-02 · Branch `new-features/Prakash` @ `eccc41e` (no commits, resets or pushes; backend untouched; Phase 5 not started).

## Verification levels

| Level | Meaning in this report |
|---|---|
| **LIVE VERIFIED** | Against the real V10 BFF. **Nothing in Phase 4.** |
| **BROWSER (MOCKED)** | Production build in headless Edge. Every `/api/v1/*` request was answered locally with **synthetic** data, so nothing reached the BFF and no credentials were used. |
| **CODE-LEVEL** | Unit tests with stub `fetch` and synthetic identities, mutation checks, typecheck, build |
| **STATIC CONTRACT** | Checked against `docs/openapi/api-docs-v10.json` |
| **BLOCKED** | Needs backend data or accounts (§11) |

> **The platform dashboard is not live verified.** Only the Safe-Fare Admin *login* is live verified (Phase 3.5). The real Safe-Fare Admin `GET /me/permissions` payload and the real all-tenant responses have not been captured. The "Safe-Fare Admin" used in every test here is a synthetic fixture built from the brief's description: `platform: true`, `ADMIN`, `tenantId: null`, every code except `driver.app`.

## Change control

- `git status` was recorded before any edit (44 entries, saved to the session scratchpad). All Phase 0–3.5 modified and untracked files are preserved.
- After Phase 4: the same entries plus the files in §13. No backend code, no commits.

---

## 1. Audit of the existing dashboard (before editing)

| Area | Finding |
|---|---|
| Overview page | `FleetOverview` (`dashboard/fleet-overview.tsx`). Every widget has its own `useApiQuery` with loading, error and retry. Missing values show "—". |
| Services | `insightService.overview / fleetStatus / trends / safetyEvents` (`/dashboard/*`), `fleetService.listGroups / listAllDevices / realtime / listAllAlarms`, `accountService.preferences` |
| Components | `MetricCard`, `Panel`/`PanelHeader`, `FleetStatusCard`, `OperationsSnapshot`, `DailyTrendPanel`, `AlarmTrendChart`, `LiveActivityList`, `RemindersList`, `FleetGroups`, `ApiErrorState`, `UnavailableState`, `EmptyState`, `LoadingSkeleton` |
| Tenant filtering | **None in the client.** No code sends `X-Tenant-Id` or `tenantId`. Scope comes from the token: tenant users get their tenant, and a Safe-Fare Admin with no tenant gets all tenants (V10 Access convention). |
| Permission checks | The page is gated by the `overview` screen (`device.read`); widgets weren't individually gated. |
| Query state | `useApiQuery` deduplicates in-flight requests only; there is no persistent cache, so a stale tenant can't be carried over. |

**V10 platform-wide read support** (spec `info.description`, Access convention): *"The Safe-Fare Admin … has no tenant of its own … reads without it [X-Tenant-Id] cover every tenant."* The per-parameter description also says "Safe-Fare Admin: the tenant to work in (required for tenant data)". I read the global convention as authoritative for reads, and the brief confirms it ("Without X-Tenant-Id: platform-wide reads can cover all tenants"). **Not live verified.**

## 2. Implementation plan (as executed)

1. New screen `platform` (`/drive-vision/platform`): `platformOnly` + `tenant.all`, `staff` audience, in the central registries.
2. Widget requirements in the central policy (`WIDGETS` + `canViewWidget`). Components never read codes.
3. Platform dashboard composed of existing components. Only one new pure model (tenant aggregation) and one new service method.
4. Tenant ADMIN Overview unchanged. Safe-Fare Admin Overview gets an "All tenants" badge (`dataScope`).
5. Post-login landing: Platform Overview for platform admins (`defaultLanding`). An explicit `next` is still honoured.
6. Tests, mutation checks, browser checks, docs.

## 3. Widgets implemented

| Section | Widget | Source | Rule |
|---|---|---|---|
| A | Tenants (total) | `GET /platform/tenants` → server `total` | — |
| A | Active / inactive tenants | `TenantDto.status` | Counts only `"ACTIVE"` / `"INACTIVE"` (values undocumented); anything else is shown as "other status". **Null if the list is incomplete.** |
| A | Users, Drivers, Devices | Sum of `TenantDto.users / drivers / devices` | Summed **only** when `items.length === total` (the list isn't paged) **and** every tenant has a valid count; otherwise "—" with the reason. Never a partial sum. |
| A | Device groups | `GET /groups` → server `total` | A server count, not a sum of pages |
| B | Vehicle status distribution | `GET /dashboard/fleet-status` (slices) | Falls back to `overview.vehicles` online/offline |
| B | Device health issues | `GET /dashboard/overview` → `health` | Stale > 24 h, low battery, never online, service expired (server counts and thresholds) |
| C | Vehicles / Driving / Idling / Parked | `overview.vehicles` | V10 doesn't define "active vehicles", so the server's driving / idling / parked counts are shown instead of inventing one |
| C | Trips in progress, trips today, dispatches, pending workforce items | `overview.trips`, `overview.operations` (`OperationsSnapshot`) | — |
| D | Alarms (range), AI / routine split, open, severe | `GET /dashboard/safety-events {from,to}` | — |
| D | Event categories | `safety.bySeverity` | Severity keys shown as-is (the scale is undocumented) |
| D/E | Daily trend (trips, distance, alarms) | `GET /dashboard/trends {from,to}` (`DailyTrendPanel`) | Server daily rows; missing values shown as "—" |
| E | Recent open events | `safety.latestOpen` | `kind` / `severity` shown raw (undocumented values) |
| — | Tenant table | `GET /platform/tenants` | Scrolls horizontally inside its panel on narrow screens |
| — | Quick links | — | Each shown only if `canAccessScreen` allows it |

**Not shown, because no V10 aggregate supports them:** "active vehicles" as a single figure, AI-event trends split by category over time (only the total `alarms` per day exists), a platform map, platform-wide user totals independent of tenants (users without a tenant, such as the Safe-Fare Admin, aren't in the tenant counts), and per-tenant alarm figures.

## 4. APIs used

| Operation | Permission (V10) | Params sent | Tenant behaviour (V10) | Response | Service |
|---|---|---|---|---|---|
| `GET /api/v1/platform/tenants` | `tenant.all` | none | Platform-only | `ApiResponseListTenantDto` (`TenantDto[]`, `total`) | **new** `platformService.tenants()` |
| `GET /api/v1/groups` | `group.read` | none | All tenants without a selector | `GroupDto[]`, `total` | existing `fleetService.listGroups` |
| `GET /api/v1/dashboard/overview` | `device.read` | none | same | `OverviewDto` | existing |
| `GET /api/v1/dashboard/fleet-status` | `device.read` | none | same | `StatusSlice[]` | existing |
| `GET /api/v1/dashboard/trends` | `device.read` | `from`, `to` | same | `TrendDay[]` | existing |
| `GET /api/v1/dashboard/safety-events` | `alarm.read` | `from`, `to` | same | `SafetySummary` | existing |

All go through the shared client (bearer, refresh, single 401 retry). No new endpoints, no backend changes, and no second auth path. **No `X-Tenant-Id` header and no `tenantId` query** (asserted in tests and in the browser run). Mapping updated: `GET /platform/tenants` is now INTEGRATED (101 / 26 / 78 / 15).

## 5. Data scope: Safe-Fare Admin vs tenant ADMIN

| | Safe-Fare Admin (`platform: true`, `tenantId: null`) | Tenant ADMIN (`platform: false`) |
|---|---|---|
| Platform Overview | ✅ (with `tenant.all`) | ❌ Route denied, hidden from nav, **0** `/platform/*` requests (browser, mocked) |
| Fleet Overview | ✅ with an **"All tenants"** badge | ✅ own tenant, no badge |
| Scope source | V10: reads without a selector cover every tenant | Tenant from the access token (backend-enforced) |
| Driver app | ❌ | ❌ |
| Decided by | `platform === true` + `tenant.all` | Never by `roleCode` |

The frontend does **not** filter tenant data, and isolation is not claimed as a frontend guarantee. The backend scopes each request; the UI only decides which screens and widgets exist.

## 6. Permission requirements

- Screen `platform`: `platformOnly` + `tenant.all` (mirrors `GET /platform/tenants`). Spec-checked in tests.
- Widgets: `platform.tenants` = `tenant.all` **and** platform access; `dashboard.fleet` = `device.read`; `dashboard.safety` = `alarm.read`; `dashboard.groups` = `group.read`. Every widget's operations are checked against the spec's "Required permission".
- A widget without its permission shows "No permission for this widget — Needs X" and **its request is never sent** (`useApiQuery(null)`).
- A static test fails if the page reads `permissions.has`, `.platform ===` or `roleCode` itself.

## 7. Loading, empty and error behaviour

| State | Behaviour | Verified |
|---|---|---|
| Loading | Skeleton per widget | BROWSER (MOCKED) |
| Success | Server values | BROWSER (MOCKED) |
| Empty | Real server zeros show as 0 (e.g. 0 tenants from a complete empty list); missing fields show as "—"; empty lists get a named empty state ("No tenants returned", "No open events", "No days returned", "No status breakdown") | BROWSER (MOCKED) + CODE |
| Partial failure | Only the failing widget shows `ApiErrorState` with retry; the rest render. Mocked groups 403 + safety 503: tenants, device health, operations, trend and tenant table still shown | BROWSER (MOCKED) |
| Refresh failure with old data | Old data kept, plus a "Refresh failed — showing data from HH:MM · Retry" notice | Code path (not exercised in the browser) |
| 401 | Handled once, centrally: refresh → single retry → session end → login | CODE (existing client tests) |
| 403 | "You don't have access to this", no retry button | BROWSER (MOCKED) + CODE |
| Network / 5xx | Server message, error code, request id; retry | BROWSER (MOCKED, 503) + CODE (network) |
| Secrets | Error text and metadata contain no tokens (test) | CODE |

Errors are never converted to zero: a failed tenant list gives "—" with "Unavailable — tenant list failed".

## 8. Responsive results — BROWSER (MOCKED)

Platform Overview, synthetic Safe-Fare Admin, production build:

| Viewport | Horizontal overflow | Clipped content | Overlapping panels | Targets < 24 px |
|---|---|---|---|---|
| 320×640 | none | none | none | none |
| 375×812 | none | none | none | none |
| 390×844 | none | none | none | none |
| 768×1024 | none | none | none | none |
| 1024×768 | none | none | none | none |
| 1440×900 | none | none | none | none |

- **KPI cards** stack into one column below a 24 rem container. That fix was made during this phase: notes were truncated at 320 px before it. They use 2, 3 or 5 columns above that.
- **Charts and tables:** the trend chart stays readable at 320 px, and the tenant table scrolls inside its panel.
- **Partial-failure layout:** checked at 1440 and 375, no overflow.
- **Driver mobile (375×812):** lands on My Work, no overflow, `/drive-vision/platform` denied.
- **Pre-existing (not changed):** at ≤ 390 px, the chips inside the shared `FleetStatusCard` and `OperationsSnapshot` truncate their labels ("Stale >…", "Pending…"). The tenant Overview uses the same components, so I left them alone.
- Evidence: `docs/evidence/screenshots/phase4/` (12 screenshots, `results.json`, `cdp-phase4.cjs.txt`).

## 9. Tests

| Check | Result |
|---|---|
| `npm test` | **344 / 344** (325 + 18 in `tests/phase4-platform-dashboard.test.cjs` + 1 contract case) |
| V10 contract | pass, 0 errors; new runtime case `GET /platform/tenants` (asserts no `X-Tenant-Id`) |
| `npm run typecheck` | pass |
| `npm run lint --max-warnings=0` | pass |
| `npm run build` | pass, **30 routes** (+ `/drive-vision/platform`) |

New tests (all synthetic or mocked): the platform=true ± `tenant.all` / platform=false ADMIN / missing, null or `"true"` platform / missing permissions matrix; widget gating; `dataScope`; landing; driver exclusion; platform screen and widget registry ↔ spec; tenant aggregation (complete, empty, incomplete, malformed counts, statuses); endpoints and query parameters; no `X-Tenant-Id` / `tenantId` on any dashboard read; a static check for tenant selectors or hard-coded tenant ids; 403 / 503 / network errors surfacing; separate query keys; no inline permission logic.

Existing tests changed (the expectations moved because a new screen exists; none were weakened):
- `access-v10` and `phase3-5-validation`: the `FLEET` helper list now excludes `platform`, since it isn't a fleet screen.
- `access-v10` Safe-Fare Admin case: now *also* expects `platform`. This is stricter.
- `v10-contract`: added the platform service to the realm, plus one runtime case.

**Mutation check** (each change made from a backup, then restored):

| Mutation | New tests failing |
|---|---|
| `platformOnly` removed from the platform screen | 3 |
| `canViewWidget` platform check removed | 2 |
| `dataScope` ignores `tenantId` | 1 |
| Landing ignores the platform screen | 1 |
| Partial sums allowed for an incomplete list | 1 |
| Malformed per-tenant counts skipped instead of making the total unavailable | 1 |
| Service sends an invented `tenantId` | 2 |

## 10. Live vs mocked

| Item | Status |
|---|---|
| Safe-Fare Admin login | LIVE VERIFIED (Phase 3.5) |
| Real `/me/permissions` for the Safe-Fare Admin (`platform`, `tenantId`, `tenant.all`) | **BLOCKED** (not captured) |
| Platform Overview against real data | **NOT TESTED / BLOCKED** |
| That reads without `X-Tenant-Id` really span all tenants | STATIC CONTRACT only |
| `TenantDto.status` values, whether per-tenant counts are complete | BLOCKED |
| Everything in §3–§8 | CODE-LEVEL and/or BROWSER (MOCKED) |

## 11. Backend dependencies

1. **The real Safe-Fare Admin `GET /me/permissions` response** (with tokens removed). This confirms `platform: true`, `tenantId: null`, `homeTenantId: null`, and that `tenant.all`, `device.read`, `alarm.read` and `group.read` are present.
2. Confirmation that `/dashboard/*` and `/groups` without `X-Tenant-Id` return **all-tenant** aggregates for the Safe-Fare Admin. The spec's per-parameter text ("required for tenant data") is ambiguous next to the global convention.
3. `TenantDto.status` value set (only `ACTIVE` / `INACTIVE` are assumed).
4. Whether `TenantDto.users / devices / drivers` are always populated, and whether `users` includes disabled users.
5. A platform aggregate for users without a tenant, if a "total platform users" figure is wanted.
6. Severity scale for `bySeverity` and `AlertRow.severity`; `AlertRow.kind` values.
7. HTTPS for the BFF, before any further real-credential testing.
8. Carried over: test accounts for all six roles, a safe-write tenant, switch-tenant semantics (Phase 5), Python Swagger.

## 12. Security observations

- Platform access needs `platform === true` **and** `tenant.all`, decided in one place. A tenant ADMIN can't reach the route, the nav entry or the platform requests (tested and browser-verified, mocked).
- The UI never sends a tenant selector, so a stale or fabricated tenant id can't be sent; a static test guards this. Tenant isolation remains the backend's job.
- No new token or auth logic. Errors show server message, code and request id only.
- The plain-HTTP BFF remains the top risk (carried over).

## 13. Issues found and fixes

| Issue | Fix |
|---|---|
| **Lint failure carried over from Phase 3.5:** the browser-driver script I copied to `docs/evidence/screenshots/phase3-5/cdp-validate.cjs` was linted as source (2 errors, 3 warnings). Phase 3.5 ran lint *before* that copy, so its "lint passed" result was true when run, but the tree it left did not pass. | Renamed to `cdp-validate.cjs.txt` and updated the reference in `phase3-5-validation-report.md`. Phase 4 evidence uses `.txt` from the start. |
| KPI notes truncated at 320 px | Single-column KPI grid on narrow containers |
| Generic empty message for the tenant table | "No tenants returned" |
| My Phase 3.5 test server (port 3107) had been left running | Stopped. All Phase 4 test servers and browsers stopped. |

**Files added:** `src/app/drive-vision/platform/page.tsx`, `src/components/drive-vision/dashboard/platform-dashboard.tsx`, `src/components/drive-vision/dashboard/platform-dashboard-model.ts`, `src/features/drive-vision/api/platform-service.ts`, `tests/phase4-platform-dashboard.test.cjs`, `docs/phase4-platform-dashboard-report.md`, `docs/evidence/screenshots/phase4/`.

**Files modified:** `access-policy.ts` (platform screen, `WIDGETS`, `canViewWidget`, `dataScope`, `defaultLanding`), `api/types.ts` (`TenantDto`), `navigation/nav-config.ts` (Platform group), `auth/login-screen.tsx` (identity-based default landing), `dashboard/fleet-overview.tsx` (scope badge only), the tests listed in §9, `docs/implementation-status.md`, `docs/current-architecture.md`, `docs/v10-api-frontend-mapping.md`, `docs/phase3-5-validation-report.md` (evidence filename).

## 14. Remaining risks

- If the real Safe-Fare Admin lacks `device.read`, `alarm.read` or `group.read`, those widgets show "no permission". If it lacks `tenant.all`, the whole dashboard is hidden and it lands on Overview.
- If the backend scopes Safe-Fare Admin reads differently from the spec's convention, the figures would be wrong while the UI still says "all tenants". Live confirmation (§11 item 2) is required.
- Device totals come from two sources (tenant-record sum vs `/dashboard/overview` vehicles) and can legitimately differ. Labels state each source.
- The Safe-Fare Admin is still offered tenant-scoped writes on fleet screens (`TENANT_REQUIRED`) until Phase 5.

## Acceptance

| Criterion | Result |
|---|---|
| Platform dashboard with real-API-backed widgets only, no invented metrics | ✅ CODE + BROWSER (MOCKED) |
| Access = `platform === true` + `tenant.all`, central resolver | ✅ |
| Tenant ADMIN keeps own-tenant Overview, no platform access | ✅ |
| Existing components reused; no duplicate app | ✅ |
| Per-widget loading / empty / partial-failure / 403 / network states | ✅ |
| No `X-Tenant-Id`, no invented tenant ids, no tenant switching | ✅ |
| Responsive at 6 viewports; driver mobile preserved | ✅ BROWSER (MOCKED) |
| Tests, typecheck, lint, build | ✅ 344/344 · pass · 0 warnings · 30 routes |
| Live verification of the dashboard | ❌ BLOCKED (§11) |

**Phase 4 is complete for everything verifiable without backend access.** Live verification stays blocked. Phase 5 has not been started and is waiting for approval.
