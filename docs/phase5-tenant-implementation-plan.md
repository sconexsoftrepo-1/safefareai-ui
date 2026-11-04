# Phase 5 — Tenant context: audit and implementation plan

Date: 2026-11-02 · Written **before** any Phase 5 code change. Starting `git status`: 53 entries (Phases 0–4), all preserved.

Sources: `docs/openapi/api-docs-v10.json` (V10), the backend clarification of 2026-11-02 (in the Phase 5 brief), `docs/v10-api-frontend-mapping.md`.

## 1. Current behaviour (audit)

| Area | Today |
|---|---|
| Identity | `auth-store` holds `identity` from `GET /me/permissions` (`platform`, `homeTenantId`, `tenantId`, …). `computeAccess(identity)` → `Access.tenantId = identity.tenantId`. |
| API client | `client.ts` `apiRequest` → `send`. It builds `Accept`, `Content-Type` and `Authorization`. One retry after 401 re-runs `send` with the same options. There is **no tenant header anywhere**: a Phase 4 static test forbids the `"X-Tenant-Id"` literal in `src/`, and the contract test asserts no `X-Tenant-Id` on every runtime case. |
| Services | No service sends `tenantId` (query or body). V10 has **no `tenantId` in any write body**. Every operation lists `X-Tenant-Id` (header) and `tenantId` (query) as optional parameters. |
| Caching | `useApiQuery`: no persistent cache, only in-flight dedupe keyed by `key#nonce`. Responses for a superseded key are dropped (`active` flag and key comparison). Keys don't include a tenant. |
| Page state | Filters, pagination, selected records and drawers are local component state, some mirrored in the URL (Alerts view). Nothing resets on a tenant change, because no tenant change exists yet. |
| Route guard / nav | Central resolver. `platform` screen = `platformOnly` + `tenant.all`. |
| Platform dashboard | Phase 4. All reads unscoped, so they cover all tenants for the Safe-Fare Admin. Labels say "all tenants". |
| Tenant helpers | `hasTenantContext`, `needsTenantSelection(access, action)` and `ACTIONS[*].tenantWrite` exist but aren't applied to buttons. `dataScope(access)` drives the badges. |

### Where the tenant comes from

| Case | Source |
|---|---|
| Tenant users (incl. tenant ADMIN, drivers) | **The access token** (backend). The frontend must never send another tenant; V10 answers 403 `TENANT_ACCESS_DENIED`. Optional for them, so the frontend sends nothing. |
| Safe-Fare Admin, reads | Optional. Without it, reads cover every tenant. With it, reads cover that tenant. |
| Safe-Fare Admin, creates | **Required** (`400 TENANT_REQUIRED` without it), via header or query |
| Safe-Fare Admin, existing-record writes | Spec: required for "create/update/delete" (`TENANT_REQUIRED`). Clarification: "updates to existing records use the record's tenant **where supported**"; deletes and other record operations "follow their actual backend contracts". **Which operations support record-tenant resolution is not stated.** |
| Record DTOs carrying their tenant | Only the dispatch `Row` (`tenantId`). Driver, user, alert, leave, swap and geofence DTOs don't, so the frontend usually can't know a record's tenant. |
| Platform operations | `GET /platform/tenants` (list, unscoped), `POST /platform/switch-tenant` (`{tenantId}` → `{tenantId, code, name, header}`; validation only, not persisted) |

## 2. The 26 tenant-scoped writes — classification

V10 accepts the tenant for all 26 **only** as the `X-Tenant-Id` header or the `?tenantId` query (never the body). The frontend will use **the header only**, never both, to avoid `400 INVALID_TENANT`.

| # | Operation | Action key | Class |
|---|---|---|---|
| 1 | POST `/drivers` | `drivers.create` | **A** CREATE_REQUIRES_SELECTED_TENANT |
| 2 | POST `/dispatches` | `dispatch.create` | **A** |
| 3 | POST `/users` | `users.create` | **A** |
| 4 | POST `/leave-requests` | `leave.create` | **A** |
| 5 | POST `/video/exports` | `video.export` | **A** |
| 6 | PUT `/drivers/{id}` | `drivers.update` | **B** EXISTING_RECORD_UPDATE |
| 7 | POST `/drivers/{id}/assignments` | `drivers.update` | **B** (child of an existing driver) |
| 8 | POST `/drivers/{id}/assignments/{assignmentId}/end` | `drivers.update` | **B** |
| 9 | PUT `/dispatches/{id}` | `dispatch.update` | **B** |
| 10 | POST `/dispatches/{id}/cancel` | `dispatch.update` | **B** |
| 11 | POST `/dispatches/{id}/swap-requests` | `dispatch.update` | **B** (child of an existing dispatch) |
| 12 | POST `/swap-requests/{id}/approve` | `swaps.decide` | **B** |
| 13 | POST `/swap-requests/{id}/reject` | `swaps.decide` | **B** |
| 14 | POST `/leave-requests/{id}/approve` | `leave.decide` | **B** |
| 15 | POST `/leave-requests/{id}/reject` | `leave.decide` | **B** |
| 16–20 | POST `/alerts/{id}/acknowledge`, `/comments`, `/resolve`, `/dismiss`, `/reopen` | `alerts.handle` | **B** |
| 21 | PUT `/users/{id}` | `users.update` | **B** |
| 22 | PATCH `/users/{id}/status` | `users.update` | **B** |
| 23 | POST `/users/{id}/unlock` | `users.update` | **B** |
| 24 | POST `/users/{id}/password` | `users.update` | **B** |
| 25 | DELETE `/drivers/{id}` | `drivers.delete` | **C** EXISTING_RECORD_DELETE |
| 26 | DELETE `/geofences/{id}` | `geofences.delete` | **C** |

Totals: A = 5, B = 19, C = 2. Class **D** (PLATFORM_OPERATION): `POST /platform/switch-tenant`, which isn't one of the 26. Class **E** (TENANT_USER_OPERATION): `/driver/**` self-service and own-account actions (`account.password`, `settings.manage`, `notifications.markRead`), which aren't among the 26 and get no tenant header.

### Behaviour per class

| | Safe-Fare Admin, no tenant | Safe-Fare Admin, tenant selected | Tenant user |
|---|---|---|---|
| A | **Disabled** with "Select a tenant first"; no request | Enabled; `X-Tenant-Id: <selected>` | Enabled per permissions; no header (token tenant) |
| B / C | **Disabled** with "Select a tenant first"; no request (see below) | Enabled; `X-Tenant-Id: <selected>`. Records shown were loaded with the same header, so they belong to that tenant. | Enabled per permissions; no header |

**Why B/C are also disabled without a tenant:** the spec says `TENANT_REQUIRED`, and the clarification's "record's tenant where supported" isn't confirmed per operation. The frontend can't supply the record's tenant for 25 of the 26 because the DTOs lack it. A per-action flag (`recordTenantResolution`) makes it a one-line change to enable an operation once the backend confirms it. No operation is enabled on a guess.

## 3. Implementation plan

1. **Tenant context** (`api/tenant-context.ts`, pure, framework-free): `{tenantId, code, name, header}` or `null`; subscribe/get/set/clear. In memory only, so a reload returns to platform-wide mode and tabs are independent. A stale selection can't come back from storage.
   - **Hook** `useTenantContext()` exposes `selectedTenantId`, `selectedTenantName`, `selectedTenantCode`, `isPlatformUser`, `isTenantSelected`, `selectTenant()`, `clearTenantSelection()`, `switching`, `error`.
   - **Switching** (`store/tenant-store.ts`): only when `canAccessPlatform` (platform + `tenant.all`). It calls `POST /platform/switch-tenant`, validates the response (same `tenantId`, safe header name), then commits. Concurrent switches: the latest request wins and earlier results are discarded; duplicate clicks are ignored while one is pending. A failure keeps the previous selection.
   - **Cleanup:** selection is cleared on session end, and when the identity isn't a platform admin.
2. **Request classification** (`api/tenant-scope.ts`, pure): `PLATFORM_WIDE` / `SELF` paths never carry the header (`/auth/*`, `/me`, `/me/*`, `/platform/*`, `/notifications*`, `/driver/*`). Everything else is `TENANT_SCOPED`. A request option `tenant: "none"` can force no header.
   - **Client:** `apiRequest` resolves the header **once per request** (so the 401 retry keeps it). It is attached only when a selection exists and the request is tenant-scoped. Value: a positive safe integer; name from the switch response, validated as `^X-[A-Za-z0-9-]{1,64}$` and never `Authorization` or `Cookie`.
   - **Never sent:** an empty or null header, a `?tenantId` query, or a header from `auth: false` requests.
   - **Rejection:** if a scoped request answers `INVALID_TENANT` (e.g. the tenant was deactivated), the selection is cleared and the user is told.
3. **Access:** `computeAccess(identity, policy, {selectedTenantId})`. For platform identities, `Access.tenantId` = the selection (ignored for tenant users, so they can't override their tenant). Tenant writes without a tenant context move from `actions` to `tenantBlockedActions`, so `useCan()` is false everywhere and no code path can send them. `dataScope` and the Phase 4 badges follow automatically.
4. **Cache isolation:** `useApiQuery` prefixes every key with the tenant scope (`all` / `t:<id>`). A switch makes every key change, hides old data and drops late responses. The page content under the shell is keyed by the scope, which resets local state (filters, pagination, drawers). On a nested detail route, a switch navigates to the screen root.
5. **UI:**
   - **Top-bar tenant switcher**, Safe-Fare Admin with `tenant.all` only: search; inactive tenants shown but not selectable; loading and error states; "All tenants" option; link to Tenant Management.
   - **New screen** `tenants` (`/drive-vision/tenants`, `platformOnly` + `tenant.all`): table with ID, code, name, status, timezone, users, devices, drivers and current marker; search, status filter (only values present in the data), select / return to all tenants.
   - **Disabled actions:** create CTAs render disabled with the reason; record actions are hidden, and a notice on the screen explains and offers the switcher.
   - **Dashboard:** platform dashboard labels follow the scope. The tenant KPIs stay platform-wide (the tenant list is always unscoped).
6. **Errors:** `TENANT_REQUIRED`, `INVALID_TENANT`, `TENANT_ACCESS_DENIED` / 403, 404, 409, 5xx, network → specific messages. A failed switch never changes the selection.
7. **Permission policy:** unchanged (no role or permission configuration UI for tenant ADMIN; Phase 6 is out of scope).
8. **Tests:**
   - New: context, classification, header rules, switching (success, failure, inactive, invalid, rapid), cache keys, write gating, regressions.
   - The Phase 4 static test "no `X-Tenant-Id` literal in src" is **replaced**: it was true for Phase 4 and is superseded by design. The new test allows the literal only in `api/tenant-context.ts` and keeps the "no hard-coded tenant id" check.
   - Existing tests that assumed a Safe-Fare Admin gets tenant writes without a tenant will now assert the block. That's stricter.
9. **Browser checks** (mocked) at 6 viewports; then docs.

## 4. Not done in Phase 5

No backend changes, no persistence of the selection, no `switch-tenant` with `null` (the schema requires `tenantId`), no role or permission editing, no live writes.
