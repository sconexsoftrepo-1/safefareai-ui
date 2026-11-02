# Phase 5 — Tenant context, tenant switching and tenant-scoped writes

Date: 2026-11-02 · Branch `new-features/Prakash` @ `eccc41e` (no commits, resets or pushes; backend untouched; Phase 6 not started). Plan written first: [`phase5-tenant-implementation-plan.md`](phase5-tenant-implementation-plan.md).

## Verification levels

| Level | In this phase |
|---|---|
| **LIVE VERIFIED** | **Nothing.** No real credentials entered (HTTP BFF), no writes sent, no live tenant switching or isolation tested. |
| **BROWSER (MOCKED)** | Production build in headless Edge. Every `/api/v1/*` call was answered locally with synthetic data, so nothing reached the BFF. The mock returned different data per `X-Tenant-Id`, so leaked data would have been visible. |
| **CODE-LEVEL** | Real client, tenant store and policy run against a stub `fetch`; mutation checks; typecheck; build |
| **STATIC CONTRACT** | Checked against `api-docs-v10.json` |
| **BLOCKED** | §15 |

## 1. Initial audit (summary; full detail in the plan)

- **Before this phase:**
  - No tenant header was sent anywhere; a Phase 4 static test enforced that.
  - `useApiQuery` deduplicated in-flight requests only, with keys that didn't include a tenant.
  - `Access.tenantId` came from `identity.tenantId`.
  - The `tenantWrite` / `needsTenantSelection` helpers existed but weren't applied.
- **V10 tenant contract:**
  - The tenant can only be sent as the `X-Tenant-Id` header or the `?tenantId` query. **No write body has a `tenantId`.**
  - Only the dispatch `Row` DTO carries a `tenantId`, so for 25 of the 26 writes the frontend can't know a record's tenant.
- **Tenant users** get their tenant from the token; another tenant's id answers 403 `TENANT_ACCESS_DENIED`.
- **Safe-Fare Admin:**
  - Reads without a tenant cover all tenants.
  - Creates without one answer `TENANT_REQUIRED`.
  - Existing-record writes: the spec says `TENANT_REQUIRED`; the clarification says "record's tenant **where supported**", with no operations named.

## 2. Tenant context — CODE-LEVEL + BROWSER (MOCKED)

- **Store:** `api/tenant-context.ts` (pure) holds `{tenantId, code, name, header}` or `null`. It validates the id (positive safe integer) and the header name (`^X-[A-Za-z0-9-]{1,64}$`, case-insensitive). It never accepts `Authorization`, `Cookie` or `X-Request-Id`.
- **Hook:** `useTenantContext()` exposes `selectedTenantId`, `selectedTenantName`, `selectedTenantCode`, `isPlatformUser`, `canSelectTenant`, `isTenantSelected`, `pendingTenantId`, `error`, `selectTenant()` and `clearTenantSelection()`. It's built on the existing auth store and resolver; there is **no second auth or permission context**.
- **Safe-Fare Admin:** starts with no tenant. The selection lives in memory only, so a reload or new tab returns to platform-wide mode and a deactivated tenant can't be restored from storage.
- **Tenant users:**
  - Their tenant is always `identity.tenantId`.
  - A selection is ignored by `computeAccess` (tested with selection `999`).
  - They can't create one, because `selectTenant` requires `platform === true` + `tenant.all`.
  - The selection is also cleared on every session load and whenever a refreshed identity isn't platform.

## 3. Tenant switching — CODE-LEVEL + BROWSER (MOCKED)

`POST /api/v1/platform/switch-tenant`, body `{"tenantId": n}`, response `{tenantId, code, name, header}` (schemas checked in V10).

1. **Pre-checks:** platform access, valid id, status ACTIVE. Failing any of them means no request.
2. **Request:** sent with **no tenant header** (PLATFORM_WIDE + `tenant: "none"`).
3. **Response:** `tenantId` must equal the requested id, and `header` must be a safe header name (it is the header **name**; missing → V10's `X-Tenant-Id`).
4. **Commit:** then the context changes, cache keys change, page content remounts, nested detail routes go to the screen root, and a toast confirms.
5. **Failure** (`INVALID_TENANT`, 403, 404, 409, 5xx, network, mismatch, unsafe header): the **previous selection is kept** and a specific message is shown.
6. **Concurrency:** the latest switch wins, a late earlier response is dropped, duplicate clicks send nothing, and a clear cancels a pending switch.
7. **No** new token, logout, re-authentication or `/auth/*` call (verified in the browser: 0 auth calls). `/me/permissions` is not re-read, because the backend says switching changes no server state.
8. **Clear** ("All tenants" / "Return to all tenants"): no `switch-tenant` call with `null` (the schema requires `tenantId`). The header stops at once and the data reloads unscoped.

## 4. Tenant Management — `/drive-vision/tenants`

Platform-only (`platformOnly` + `tenant.all`, spec-checked for both operations).
- **Fields:** ID, code, name, status, timezone, users, devices, drivers, and the current-selection marker (from the frontend context; the server's `current` flag isn't relied on because the selection isn't persisted server-side).
- **Search** by name, code or id. **Status filter** built only from values the server returned, plus "No status"; no values invented.
- **Selection:** ACTIVE only; others show "Not selectable".
- **States:** loading, empty ("No tenants returned"), no matches, error with retry, an incomplete-list warning (`total ≠ rows`), and missing counts shown as "—".
- **Layout:** cards below a 48 rem container, table above.

## 5. Top-bar switcher

- **Who sees it:** Safe-Fare Admin with `tenant.all` only. For everyone else it renders nothing; the tenant ADMIN browser run found no switcher.
- **Shows:** "All tenants" or the tenant name; on phones, an icon plus the tenant code.
- **Popover:** search; "All tenants" option; tenants loaded from the API when opened; inactive tenants disabled; spinner while switching; errors inline; "Manage tenants" link.
- **Phones:** 40 px trigger and ≥ 44 px rows. At < 640 px the Safe-Fare Admin's brand wordmark collapses to the glyph. This fix was found in this phase, because the 390 px header overflowed.

## 6. API header behaviour — CODE-LEVEL + BROWSER (MOCKED)

| Request class | Paths | Header without selection | Header with selection |
|---|---|---|---|
| PLATFORM_WIDE | `/platform/*` | none | **none** (browser: 4 tenant-list calls under Acme, all unscoped) |
| SELF | `/auth/*`, `/me`, `/me/*`, `/notifications*`, `/driver/*` | none | none |
| TENANT_SCOPED | everything else (fleet reads, tenant writes, existing-record operations) | **none** (not empty, not null) | `<name from switch response>: <id>` |

- **Never sent:** `?tenantId` in any request, so the header and query can't disagree (`INVALID_TENANT`). Also nothing on `auth: false` requests or on the refresh call.
- **401 retry:** the header is resolved once per request, so the retry carries the same tenant with the refreshed token. Tested.
- **Unchanged:** the bearer token, proactive refresh, cross-tab refresh lock, single retry and no-secrets logging.
- **Server rejection:** a scoped request answered with `INVALID_TENANT` / `TENANT_ACCESS_DENIED` clears the selection and tells the user. The UI never keeps showing a rejected tenant.

## 7. The 26 tenant-scoped writes

All 26 accept the tenant **only** as `X-Tenant-Id` / `?tenantId`; there is no body field. The frontend uses the header only.

| # | Operation | Action | Class | Tenant value sent |
|---|---|---|---|---|
| 1 | POST `/drivers` | drivers.create | A CREATE_REQUIRES_SELECTED_TENANT | `X-Tenant-Id` (SFA) · none (tenant user) |
| 2 | POST `/dispatches` | dispatch.create | A | same |
| 3 | POST `/users` | users.create | A | same |
| 4 | POST `/leave-requests` | leave.create | A | same |
| 5 | POST `/video/exports` | video.export | A | same |
| 6–8 | PUT `/drivers/{id}`, POST `/drivers/{id}/assignments`, POST `/drivers/{id}/assignments/{assignmentId}/end` | drivers.update | B EXISTING_RECORD_UPDATE | same |
| 9–11 | PUT `/dispatches/{id}`, POST `/dispatches/{id}/cancel`, POST `/dispatches/{id}/swap-requests` | dispatch.update | B | same |
| 12–13 | POST `/swap-requests/{id}/approve`, `/reject` | swaps.decide | B | same |
| 14–15 | POST `/leave-requests/{id}/approve`, `/reject` | leave.decide | B | same |
| 16–20 | POST `/alerts/{id}/acknowledge`, `/comments`, `/resolve`, `/dismiss`, `/reopen` | alerts.handle | B | same |
| 21–24 | PUT `/users/{id}`, PATCH `/users/{id}/status`, POST `/users/{id}/unlock`, POST `/users/{id}/password` | users.update | B | same |
| 25 | DELETE `/drivers/{id}` | drivers.delete | C EXISTING_RECORD_DELETE | same |
| 26 | DELETE `/geofences/{id}` | geofences.delete | C | same |

A = 5, B = 19, C = 2 (asserted in tests). D PLATFORM_OPERATION = `switch-tenant` (not among the 26). E TENANT_USER_OPERATION = `/driver/**`, own password, preferences and notifications (not among the 26; never carry a tenant).

## 8. Create / update / delete behaviour

| | Safe-Fare Admin, no tenant | Safe-Fare Admin, tenant selected | Tenant user |
|---|---|---|---|
| A create | **Disabled** button with the reason; no request | Enabled; header sent | Unchanged |
| B update / C delete | **Hidden**, plus a screen notice "Viewing all tenants. Select a tenant to create or change records on this page", with a link; no request | Enabled; header sent | Unchanged |

- **Why B/C are blocked too:** the spec documents `TENANT_REQUIRED`; the clarification's "where supported" names no operation; and the record DTOs lack a tenant (except dispatch `Row`). `RECORD_TENANT_RESOLUTION_CONFIRMED` (currently empty) enables an operation per action once the backend confirms it. A record can't be retargeted, because its tenant is never taken from editable request data.
- **With a selection,** records on screen were loaded with the same header, so they belong to the selected tenant.
- **Unchanged:** existing confirmation dialogs. No destructive operation was added.
- **Browser (mocked):** Drivers in all-tenants mode showed "New driver (disabled)" and the notice. Under Acme, "New driver" was enabled and there was no notice. After clearing, it was disabled again. No write was sent at any point.

## 9. Cache and state isolation

- **Query keys:** every `useApiQuery` key is `<scope>|<key>` (`all` / `t:<id>`). A switch changes every key, so old data disappears at once, the new tenant is fetched, and a late response for the old key is ignored (existing key check).
- **Page state:** page content under the shell is keyed by the scope, so filters, pagination, open drawers and selected records reset. Nested detail routes go to the screen root.
- **Platform-wide data:** cached under `all`, separate from every tenant.
- **Browser (mocked):**
  - All-tenants vehicles 155 → Acme 120, with no 155 left in the fleet widgets.
  - The drivers list showed "Acme Driver" and never "All-tenant Driver" under Acme.
  - After clearing, no Acme data remained.
- **Rapid and failed switching:** CODE-LEVEL (stub fetch with controlled ordering).

## 10. Platform dashboard regression (BROWSER (MOCKED) + CODE)

- **No tenant:** "Platform · all tenants", no `X-Tenant-Id` on any request, and the all-tenant figures.
- **Acme selected:**
  - The badge reads "Tenant · Acme Logistics", and widget descriptions name the tenant.
  - `/dashboard/overview` sent `X-Tenant-Id: 1`.
  - The tenant KPIs and tenant table stay platform-wide (`/platform/tenants` unscoped).
- **Fleet Overview:** shows "All tenants" or "Tenant · <name>" for the Safe-Fare Admin.

## 11. Tenant ADMIN regression (BROWSER (MOCKED) + CODE)

- Lands on Overview with no scope badge (unchanged).
- No switcher; `/drive-vision/tenants` and `/platform` denied.
- **0** tenant headers and **0** `/platform/*` calls.
- "New driver" is enabled as before; there is no tenant notice.

Driver: screens unchanged (code). Permission policy: unchanged. No role or permission configuration is exposed to tenant ADMIN (Phase 6 not started).

## 12. Responsive results — BROWSER (MOCKED)

| Viewport | Tenants page | Switcher popover | Drivers page |
|---|---|---|---|
| 320×640 | no overflow / clipping / small targets | inside viewport, no overflow | no overflow |
| 375×812 | ✓ | ✓ | ✓ |
| 390×844 | ✓ (**overflowed before the fix**) | ✓ | ✓ |
| 768×1024 | ✓ | ✓ | ✓ |
| 1024×768 | ✓ | ✓ | ✓ |
| 1440×900 | ✓ | ✓ | ✓ |

Evidence: `docs/evidence/screenshots/phase5/` (18 screenshots, `results.json`, `cdp-phase5.cjs.txt`).

## 13. Tests

| Check | Result |
|---|---|
| `npm test` | **366 / 366** (344 + 21 in `tests/phase5-tenant-context.test.cjs` + 1 contract case) |
| V10 contract | 0 errors; new runtime case `POST /platform/switch-tenant` `{tenantId}` |
| `npm run typecheck` | pass |
| `npm run lint --max-warnings=0` | pass |
| `npm run build` | pass, **31 routes** (+ `/drive-vision/tenants`) |

**New tests** (all synthetic or stub fetch):
- **Context:** initial state, set/clear, invalid ids and header names refused.
- **Classification:** the scope table for representative paths.
- **Headers:** none in platform-wide mode (and no empty or null header); the correct header only on TENANT_SCOPED calls in selected mode; a custom header name honoured; never `?tenantId`; bearer preserved; the 401 retry keeps the tenant; `INVALID_TENANT` clears the selection.
- **Switching:** success, default header name, unsafe header name, mismatched tenant, `INVALID_TENANT` / 403 / 409 / 503 keep the previous selection; inactive tenant, tenant ADMIN and admin without `tenant.all` refused with no request; rapid switching; duplicate clicks; clear while pending; session end.
- **Writes:** the 5 / 19 / 2 classification; every tenant write blocked for the admin without a tenant while own-account actions stay; all permitted with a tenant; tenant users can't be retargeted.
- **Cache:** scoped keys; the hook and shell use them.
- **Regressions:** tenants screen and switcher access; driver and tenant ADMIN.

**Existing tests updated** (behaviour changed by design; none weakened):
- `access-v10`: line 142 explicitly said "still offered (gap documented for Phase 5)" and now asserts the block, plus that the action is offered with a selection. The `tenantId: 42` identity case now uses a selection.
- `phase4-platform-dashboard`:
  - The "tenant set" case now uses a selection, and asserts that the identity's tenantId alone doesn't scope the admin.
  - The static "no `X-Tenant-Id` literal" test is replaced: the literal is allowed only in `api/tenant-context.ts`; still no hard-coded tenant ids; plus no `?tenantId` query.
- `access-v10` / `phase3-5`: the `FLEET` helper now excludes `platformOnly` screens. The Phase 3.5 unknown-path list gets a still-unknown path, and `/tenants` is now asserted platform-only.
- `final-audit-fixes` GA-16: accepts `useActionGate(x)` as well as `useCan(x)`; both read the central policy.
- `v10-contract`: the switch-tenant runtime case.

**Mutation check** (each run from a backup, then restored):

| Mutation | Failing |
|---|---|
| Header on every request (no classification) | 2 |
| Header on `auth: false` / `tenant: "none"` | 1 |
| 401 retry drops the tenant | 1 |
| Tenant user's tenant overridable by a selection | 1 |
| No write blocking without a tenant | 1 |
| Late switch result not dropped | 2 |
| Switch response tenant not checked | 1 |
| Duplicate submissions allowed | **0 at first → test strengthened → 1** |
| Query keys not tenant-scoped | 1 |
| Rejected tenant kept | 1 |

**Flakiness note:** in one slow, contended run, the `INVALID_TENANT clears the selection` test failed once. It passed in 25 later runs (20 targeted, 5 full-file), so the cause wasn't found. Recorded here rather than claimed stable.

## 14. Changed files

**New:**
- `src/features/drive-vision/api/tenant-context.ts`, `src/features/drive-vision/api/tenant-scope.ts`
- `src/features/drive-vision/store/tenant-store.ts`
- `src/components/drive-vision/app-shell/tenant-switcher.tsx`
- `src/components/drive-vision/platform/tenant-management.tsx`
- `src/components/drive-vision/shared/tenant-required.tsx`
- `src/app/drive-vision/tenants/page.tsx`
- `tests/phase5-tenant-context.test.cjs`
- `docs/phase5-tenant-implementation-plan.md`, `docs/phase5-tenant-context-report.md`
- `docs/evidence/screenshots/phase5/`

**Modified:**
- **API layer:** `api/client.ts` (per-request tenant header, rejection report), `api/platform-service.ts` (`switchTenant`), `api/types.ts` (`TenantSelectionDto`).
- **Access and state:** `access/access-policy.ts` (`tenants` screen, `tenantClass`, `RECORD_TENANT_RESOLUTION_CONFIRMED`, effective tenant, `tenantBlockedActions`, `actionBlock`, `tenantBlockedScreens`), `access/use-access.ts` (selection-aware `useAccess`, `useActionGate`, `useTenantContext`), `store/auth-store.ts` (clear selection on session load / non-platform identity), `hooks/use-api-query.ts` (scoped keys).
- **Shell and navigation:** `app-shell/app-shell.tsx` (scope key, notice), `app-shell/topbar.tsx` (switcher, compact brand), `navigation/nav-config.ts` (Tenants entry).
- **Dashboards:** `dashboard/platform-dashboard.tsx` and `dashboard/fleet-overview.tsx` (scope labels).
- **Pages with create buttons:** drivers, dispatch, users, workforce.
- **Tests:** listed in §13.
- **Docs:** `docs/current-architecture.md`, `docs/implementation-status.md`, `docs/v10-api-frontend-mapping.md`.

**Documentation fix:** Phase 4 marked the wrong row INTEGRATED in `v10-api-frontend-mapping.md` (`switch-tenant` instead of `GET /platform/tenants`; the totals were right). Corrected. Totals now 128 / 0 / 77 / 15 = 220.

## 15. Backend blockers

1. **Which existing-record writes resolve the tenant from the record** without a selected tenant ("where supported"). This decides whether any B/C operation can be enabled in all-tenants mode.
2. Whether `TENANT_ACCESS_DENIED` or `INVALID_TENANT` is returned when a selected tenant is deactivated mid-session (both are handled).
3. Whether `GET /me/permissions` with `X-Tenant-Id` returns tenant-specific `screens` / `tenantId` (not sent today; identity stays unscoped).
4. Whether reference endpoints (`/reference/*`) are tenant-specific (they are classified TENANT_SCOPED; the header is harmless if ignored).
5. Real Safe-Fare Admin `/me/permissions` payload (carried over).
6. A safe test tenant, test accounts for all roles, and **HTTPS**, before any live switching or write test.

## 16. Live verification status

| Item | Status |
|---|---|
| Safe-Fare Admin login | LIVE VERIFIED (Phase 3.5) |
| Tenant switching against the real BFF | **BLOCKED** (HTTP, no further credentials) |
| Header acceptance and data scoping by the real BFF | **BLOCKED** |
| Tenant isolation | **BLOCKED**, not claimed |
| Any tenant-scoped write | **NOT SENT** (no safe tenant) |
| Everything in §2–§12 | CODE-LEVEL and/or BROWSER (MOCKED) |

**Phase 5 is complete for everything verifiable without backend access.** Phase 6 has not been started and is waiting for approval.
