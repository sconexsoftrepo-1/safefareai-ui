# SafeFare AI — V10 implementation status

Updated 2026-11-02 after Phase 8 (Driver Management & driver–device assignments). Per-operation detail: [`v10-api-frontend-mapping.md`](v10-api-frontend-mapping.md). Phase reports: [`project-audit.md`](project-audit.md) (0), [`v10-compatibility-report.md`](v10-compatibility-report.md) (1), [`phase2-3-auth-permission-report.md`](phase2-3-auth-permission-report.md) (2–3), [`phase3-5-validation-report.md`](phase3-5-validation-report.md) (3.5), [`phase4-platform-dashboard-report.md`](phase4-platform-dashboard-report.md) (4), [`phase5-tenant-context-report.md`](phase5-tenant-context-report.md) (5), [`phase6-tenant-management-report.md`](phase6-tenant-management-report.md) (6), [`phase7-role-permission-report.md`](phase7-role-permission-report.md) (7), [`phase8-driver-management-report.md`](phase8-driver-management-report.md) (8).

Verification levels used below:
- **Code** — unit / contract tests with mocked fetch, typecheck, build.
- **Live (pre-V10)** — observed against the dev BFF before V10, per `feature-status.md`.
- **Live (V10)** — observed against the V10 BFF. **Only Safe-Fare Admin login** (user browser test after Phase 2).
- **Browser (mocked)** — real browser (headless Edge) with every `/api/v1/*` request answered locally; proves UI behaviour and request construction, not backend behaviour.

## Baseline

| Check | Result |
|---|---|
| `npm test` | 452 / 452 (incl. 10 device-edit tests, 12 tenant-create tests) |
| `npm run typecheck` | pass |
| `npm run lint` | pass, 0 warnings |
| `npm run build` | pass, 33 routes (+ `/drive-vision/platform/roles`, `/drive-vision/platform/permissions`) |
| Static V10 contract (134 call sites) | 0 errors; 1 documented type-level warning (`PUT /me/preferences`) |

## V10 operations

| Status | Count |
|---|---|
| INTEGRATED | 138 (+ 9 role / permission operations, Phase 7) |
| PARTIALLY_INTEGRATED | 0 |
| NOT_INTEGRATED | 67 |
| BACKEND_BLOCKED | 15 |
| **Total** | **220** |

## Features

| Feature | Status | Verified |
|---|---|---|
| Tenant-user login (`tenantCode`) | Done | Code; browser (mocked) request body; live (pre-V10) for the old form; **not live-tested on V10** |
| Safe-Fare Admin login (no `tenantCode`) | Done | **LIVE VERIFIED** (user, browser, after Phase 2); code; browser (mocked) body has no `tenantCode` key |
| Identity from `GET /me/permissions` | Done | Code; live login implies the session loaded (both calls must succeed), payload not captured |
| `platform` / tenant ADMIN distinction | Done | Code only |
| Token refresh, cross-tab, 401 retry | Unchanged | Code; live (pre-V10) |
| Logout + state cleanup (user, identity) | Done | Code |
| Permission-based screens, actions, features | Done | Code only |
| Operation-level buttons (create / update / delete split) | Done: Drivers, Dispatch, Workforce, Users | Code only |
| Server `screens` narrowing (`readOnly`, `allowed: false`) | Done | Code only |
| Dynamic driver navigation from `screens` | Done (routePath-mapped; static fallback) | Code only |
| Dynamic fleet navigation from `screens` | Partial: filtered by permissions; server titles and order not used until D3 | — |
| Platform-only screens | Done: Platform Overview (`platformOnly` + `tenant.all`) | Code; browser (mocked) |
| Tenant context (selected tenant, header on TENANT_SCOPED requests, cache scope) | Done (Phase 5) | Code; browser (mocked). **Not live-verified** |
| Top-bar tenant switcher + Tenants screen | Done (Phase 5) | Code; browser (mocked, 6 viewports) |
| 26 tenant-scoped writes | Done (Phase 5): sent with the selected tenant; not offered to the Safe-Fare Admin without one; tenant users unchanged | Code; browser (mocked, no write sent). **No live write** |
| Safe-Fare Admin platform dashboard | Done (Phase 4): tenants, users / drivers / devices (summed from the complete tenant list), groups, device health, fleet operations, alerts and AI events, daily trend, recent open events, tenant table | Code; browser (mocked, 6 viewports). **Not live-verified**: the real Safe-Fare Admin `/me/permissions` and all-tenant responses not captured |
| Fleet Overview scope badge ("All tenants" for a Safe-Fare Admin with no tenant) | Done (Phase 4) | Code; browser (mocked) |
| Tenant management / switching | Done (Phase 5) — see above. **Switching manually checked in the frontend by the user** | Code; browser (mocked); manual (frontend) |
| Tenant Management screen (Phase 6): summary, search, status filter (+ server status catalogue), client paging, details drawer from list data, missing-value explanations, stale-refresh notice | Done | Code; automated tests; browser (mocked, 6 viewports). Not live-verified |
| Tenant create (POST `/platform/tenants`, backend-supplied contract outside V10): form, review step, server-generated code, permission source fixed at tenant 1, list refresh, no tenant switch | Done (Phase 6 enhancement) | Code; automated; browser (mocked, 6 viewports). **Not live-verified; no real tenant created.** Permission code assumed (`tenant.all`) |
| Tenant edit / activate / deactivate / delete / configuration | **Not available: no endpoints** (documented, not simulated) | — |
| Global Roles (list, create, edit description, delete; global vs tenant roles) | Done (Phase 7) | Code; automated; browser (mocked, 6 viewports). Not live-verified; **no real write sent** |
| Role-permission mapping (checkbox selection with module / Select-all, review, partial-failure handling that keeps unsaved changes) | Done (Phase 7 + checkbox enhancement) | Code; automated; browser (mocked). Not live-verified |
| Permission Catalogue (list, scope, create, edit, delete, frontend-usage warnings) | Done (Phase 7) | Code; automated; browser (mocked). Not live-verified |
| Permission matrix view (`GET /roles/permission-matrix`) | Not built (optional) | — |
| Driver Management (list with ID / email / assignment / tenant columns, search, status, paging, detail, create / edit / delete) | Done (pre-existing, completed in Phase 8) | Code; automated; browser (mocked, 6 viewports). Not live-verified; no real write |
| Driver–device assignments (history, assign with from/to + review + replace acknowledgement, end with optional time, vehicle's current driver) | Done (Phase 8) | Code; automated; browser (mocked). Not live-verified |
| Device edit (PUT `/devices/{id}`): descriptive fields only; model / protocol / cameras / terminal / group / object type locked and resent unchanged; `confirmChargeableChange` never sent. Add / Delete / Transfer still disabled | Done (device-edit task) | Code; automated (mocked fetch). No browser run, not live-verified; no real write. Report: [`device-edit-investigation-and-implementation.md`](device-edit-investigation-and-implementation.md) |
| Historical alarm → driver attribution | **Backend dependency**: UI shows only the server's `AlertRow.driverName`; never derives it | Code; automated (no-fabrication checks) |
| New V10 modules (maintenance, alarm rules, schedules, audit…) | Not started (Phase 7) | — |
| Python client | Not started (Phase 8); session is shareable | — |
| Responsive check of the new login switch | Done (Phase 3.5): 320–1440, no overflow / clipping / overlap | Browser (mocked) |

## Blocked on the backend

D1 test accounts + test tenant · D2 role codes · D3 `menuKey` / `routePath` catalogue · D4 switch-tenant semantics · D5 permission `scope` semantics (values TENANT/PLATFORM known from schemas), `editable`, `fullAccess`, `protectedRole`, `assignable`, global-role = no `tenantId` (Phase 7 dependency) · D6 tenant ADMIN refused on permission writes (frontend hides them regardless) · D7 Python Swagger · D8 TLS · #19 #22 #25 #26 #28 #32 (writes and command detail). Details: `v10-compatibility-report.md` §9.
