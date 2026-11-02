# Phase 6 — Tenant Management

Date: 2026-11-02 · Branch `new-features/Prakash` @ `eccc41e` (no commits, resets or pushes; backend untouched; Phase 7 not started). Starting `git status`: 67 entries, all preserved.

## Verification levels used

| Level | Meaning |
|---|---|
| **Code verified** | Reviewed against V10 and typechecked |
| **Automated test verified** | Unit / contract tests (stub fetch, synthetic data); mutation-checked |
| **Mocked-browser verified** | Production build in headless Edge; every `/api/v1/*` call answered locally with **synthetic** data; nothing reached the BFF |
| **Manually checked in the frontend** | Reported by the user (tenant switching, after Phase 5) |
| **Live backend verified** | **Nothing in Phase 6** |
| **Not verified** | Listed in §12 |

---

## 1. Initial audit findings

- **V10 has exactly two tenant operations:** `GET /api/v1/platform/tenants` and `POST /api/v1/platform/switch-tenant`.
  - There is **no** tenant detail, create, update, activate, deactivate, delete or configuration endpoint, and no tenant paging parameter.
  - `tenant.all` is the only tenant permission code. The test `P6 contract` asserts all three facts from the spec.
- **Phase 5 already provided** the list page, search, a status filter from returned values, ACTIVE-only selection, switching, the shared tenant context and cache isolation.
- **Gaps addressed in Phase 6:**
  - No details view.
  - No summary.
  - Missing counts shown as "—" without an explanation.
  - A failed refresh silently kept old data.
  - No paging for large lists.
  - The page didn't say which management actions don't exist.
  - The search function was duplicated in the switcher.
- **Error format:** V10 errors use `{code, msg, data, total, extend: {errorCode, fieldErrors[], requestId}}`, which the existing client already parses (`msg`, not `message`).
- **Status catalogue:** `GET /reference/statuses` (any signed-in user, previously unused) returns a catalogue of valid status values per entity (`statusSets[{name, field, values, terminal, transitions, notes}]`). Whether it contains a tenant set is unknown, so it's used **only if present**.

## 2. Tenant-related Swagger API inventory

| Method + path | Purpose | Params / body | Response | Permission | Scope | Integrated | Safe to implement |
|---|---|---|---|---|---|---|---|
| GET `/api/v1/platform/tenants` | List all tenants with counts | Only the generic optional `X-Tenant-Id` / `tenantId` (not sent); **no paging** | `ApiResponseListTenantDto`: `TenantDto[]` {id, code, name, status, timezone, users, devices, drivers, current}, `total` | `tenant.all` | Platform-wide | Yes (Phase 4/5) | Yes — read |
| POST `/api/v1/platform/switch-tenant` | Validate and select a tenant (no new token, not persisted) | Body `SwitchTenantRequest` {tenantId*} | `TenantSelectionDto` {tenantId, code, name, header} | `tenant.all` | Platform-wide | Yes (Phase 5) | Yes — no data change |
| GET `/api/v1/reference/statuses` | Status value sets, transitions, conventions | — | `CatalogDto` {statusSets[], conventions} | none (signed in) | Reference (TENANT_SCOPED by the Phase 5 classification; harmless) | **Yes (Phase 6)**, tenant set only | Yes — read |
| Tenant detail / create / update / status / delete / configuration | — | — | — | — | — | **Do not exist in V10** | **No** — not simulated |

Only the read operations and the switch are used; no tenant writes exist to implement.

## 3. Phase 5 functionality reused (unchanged)

- **Tenant context:** `useTenantContext()` / `tenant-store`. Selecting from the page, the details drawer or the top bar all go through `ctx.selectTenant`; there is no second selection state (asserted by a static test).
- **Switching:** `POST /platform/switch-tenant`, validated before commit. A failure keeps the previous selection; only ACTIVE tenants can be selected; "Return to all tenants" makes no backend call.
- **Request scope:** the tenant list stays PLATFORM_WIDE, so no `X-Tenant-Id` is sent even with a tenant selected.
- **Cache isolation:** query keys are scoped by tenant, page content remounts on a switch, and nested routes go to the screen root.
- **Access:** the `tenants` screen requires `platformOnly` + `tenant.all`.

## 4. New functionality (Phase 6)

| Feature | Detail | Verification |
|---|---|---|
| Summary strip | Tenants (server `total`), active, inactive, other/no status. Status totals show "—" when the list is incomplete (`total ≠ rows`). | Automated + mocked browser |
| Search | Name, code, id; case-insensitive; resets to page 1 | Automated + mocked browser |
| Status filter | Statuses present in the list, plus documented catalogue values (count 0, tooltip "Listed in the server's status catalogue"), plus "No status" when a tenant has none. Nothing invented. | Automated + mocked browser |
| Missing data | Counts: "—" with "Not reported by the server" (tooltip and screen-reader text). Status and timezone "—". Real zeros stay 0. | Automated + mocked browser |
| Paging | **Client-side** (25 per page), because the API returns the whole list and has no paging contract | Automated + mocked browser |
| Details drawer | Every `TenantDto` field, built from the list row (no detail endpoint — stated in the drawer), the server `current` flag, "your selection", the catalogue note, and why a tenant isn't selectable. Viewing never selects. "Select" in the drawer uses the shared context. | Automated (static) + mocked browser |
| Errors | First-load failure → error panel with server `msg`, `errorCode`, request id and retry (**never** the empty state). Refresh failure with data → rows kept, plus "Refresh failed — showing the list from HH:MM · Retry". | Automated + mocked browser |
| Unsupported actions | A note on the page: creating, editing, activating, deactivating or deleting tenants isn't available because V10 has no such operations | Mocked browser + static test |
| Refactor | `matchTenant` moved into the model; the switcher re-exports it (one implementation) | Automated |

**Not implemented, by design:** tenant create, edit, status change, delete and configuration. There are no endpoints, so nothing is simulated with frontend state.

## 5. Files

**Created:**
- `src/components/drive-vision/platform/tenant-management-model.ts`
- `tests/phase6-tenant-management.test.cjs`
- `docs/phase6-tenant-management-report.md`
- `docs/evidence/screenshots/phase6/` (15 screenshots, `results.json`, `cdp-phase6.cjs.txt`)

**Modified:**
- `src/components/drive-vision/platform/tenant-management.tsx` (rewritten on the model)
- `src/components/drive-vision/app-shell/tenant-switcher.tsx` (uses the model's `matchTenant`)
- `src/features/drive-vision/api/fleet-service.ts` (`statusCatalog()`)
- `src/features/drive-vision/api/types.ts` (`StatusSetDto`, `StatusCatalogDto`)
- `tests/v10-contract.test.cjs` (runtime case `GET /reference/statuses`)
- `docs/implementation-status.md`, `docs/v10-api-frontend-mapping.md`, `docs/current-architecture.md`

## 6. API integration details

- **`platformService.tenants()`:** `GET /platform/tenants`, with no query, body or tenant header (PLATFORM_WIDE), even when a tenant is selected (tested; browser: header `null`).
- **`fleetService.statusCatalog()`:** `GET /reference/statuses` returns `data` or `{}`. Its failure only hides documented-but-unused statuses; it never blocks the list.
- **`switchTenant`:** unchanged from Phase 5.
- **Browser (mocked) request log:** only `GET /platform/tenants`, `GET /reference/statuses`, `POST /platform/switch-tenant` and the existing shell reads. No other write was sent; `?tenantId` never appeared.
- **Contract checks:** 0 errors. A test asserts that the API layer references only `/platform/tenants` and `/platform/switch-tenant` under `/platform` or `/tenants`.

## 7. Access control

| Identity | Tenant Management | Switcher | Verified |
|---|---|---|---|
| Safe-Fare Admin (`platform: true` + `tenant.all`) | ✅ | ✅ | Automated + mocked browser |
| Safe-Fare Admin without `tenant.all` | ❌ | ❌ | Automated |
| `platform: "true"` (string) | ❌ | ❌ | Automated |
| Tenant ADMIN (incl. holding `tenant.all`) | ❌ route, ❌ nav | ❌ | Automated + mocked browser (0 `/platform` calls, 0 tenant headers) |
| Fleet Owner, Dispatcher, Viewer (synthetic codes) | ❌ | ❌ | Automated |
| Driver | ❌ | ❌ | Automated + mocked browser |

- **Tenant users:** they can't switch, and a tenant id from them is never used (Phase 5 resolver ignores a selection; tested again).
- **Logging:** no tokens or credentials in logs (unchanged client).
- **Permission configuration:** the product rule that only the Safe-Fare Admin configures permissions is unchanged; no permission UI was added.

## 8. Test results

| Check | Result |
|---|---|
| `npm test` | **378 / 378** (366 + 11 Phase 6 + 1 contract case) |
| `npm run typecheck` | pass |
| `npm run lint --max-warnings=0` | pass |
| `npm run build` | pass, 31 routes (no new route) |
| V10 contract | 0 errors |

**Phase 6 tests:** search; status filter (returned values only, "No status", combined with search); catalogue matching and ignoring; missing fields and counts (no fabricated 0); client paging and the absence of API paging params; selectability matching the tenant store; access for 9 identity variants; API calls and no tenant header on the platform list; errors 400/403/404/409/500/503, a body without `msg`, and network (all reject; never an empty list); exactly two V10 tenant operations and no invented paths; shared selection state; viewing details doesn't select.

**Mutation check** (each run from a backup, then restored; all caught):

| Mutation | Failing |
|---|---|
| Invented `ACTIVE` filter option | 1 |
| Missing count shown as `0` | 1 |
| Page number not clamped | 1 |
| Any catalogue set treated as the tenant set | 1 |
| Search ignores id | 1 |
| Inactive tenant selectable on the page | 1 |
| Tenant list scoped to the selected tenant | 1 |

Phase 5's switching, cache and isolation tests (21) still pass unchanged.

## 9. Browser viewport results (mocked, synthetic data)

| Viewport | List | Details drawer | Switcher popover |
|---|---|---|---|
| 320×568 | no overflow / clipping / targets < 24 px | full width, in view | in view |
| 390×844 | ✓ | ✓ | ✓ |
| 768×1024 | ✓ | ✓ (right panel) | ✓ |
| 1024×768 | ✓ | ✓ | ✓ |
| 1366×768 | ✓ | ✓ | ✓ |
| 1920×1080 | ✓ | ✓ | ✓ |

**Functional (1366×768, synthetic list of 30 tenants):**
- **Summary:** 30 / 24 / 4 / 2. Filters: All 30, ACTIVE 24, ARCHIVED 0 (catalogue only), INACTIVE 4, SUSPENDED 1, No status 1.
- **Paging:** 1–25, then 26–30.
- **Search:** "blue" returns 1 row; "miss" returns 1 row. INACTIVE gives 4 rows, all "Not selectable"; ARCHIVED shows the "No matching tenants" empty state.
- **Missing fields:** status, timezone, users and devices showed "—" with the reason.
- **Selection from the page:**
  - Selecting from the details drawer called `switch-tenant` `{tenantId: 1}` with no header, and the top-bar switcher then showed Acme (shared state).
  - The drawer closed, because page content remounts on a tenant change by design.
- **Selection via the top bar** (Blue): the page marked Blue "Selected". Drivers (in-app navigation) sent `X-Tenant-Id: 2` and showed only Blue data, with no Acme or all-tenant rows.
- **Return to all tenants:** cleared the selection.
- **Errors and empty:** a 503 showed the error panel (not empty) with `msg`, `errorCode` and request id; a refresh failure kept 25 rows plus the stale notice; an empty list showed "No tenants returned".

## 10. Backend dependencies and missing endpoints

1. **Missing endpoints:** tenant **detail**, **create**, **update**, **activate / deactivate (status)**, **delete**, **configuration**. Each needs an exact contract and a permission code before the frontend can offer it.
2. **No paging contract** for `GET /platform/tenants`. Large platforms will receive the whole list; client paging is presentation only.
3. **Status values:** `TenantDto.status` values are undocumented; whether `/reference/statuses` includes a tenant set is unknown.
4. **The `current` flag:** what `TenantDto.current` means when switching isn't persisted. It's shown as a raw server value only.
5. **Count semantics:** whether per-tenant counts are always populated, and whether `users` includes disabled users.
6. **Carried over:** real Safe-Fare Admin `/me/permissions` payload, test accounts, a safe test tenant, **HTTPS**.

## 11. Known limitations

- Selecting from the details drawer closes it (tenant-change remount; intentional isolation).
- Client-side paging and filtering only; the list is fetched in full.
- Status filter and summary depend on raw server strings; only "ACTIVE" has meaning to the frontend (selectability, a backend rule).
- The status catalogue is matched by a set `name`/`field` containing "tenant"; a differently named set would be ignored (safe default).
- A full page reload returns to all-tenants mode (Phase 5: in-memory selection).

## 12. Verification level per feature

| Feature | Code | Automated | Mocked browser | Manual (frontend) | Live backend |
|---|---|---|---|---|---|
| Tenant switching (page + top bar, shared context) | ✓ | ✓ | ✓ | ✓ (user, after Phase 5) | ✗ |
| Tenant list, summary, search, status filter, paging | ✓ | ✓ | ✓ | — | ✗ |
| Missing-value handling | ✓ | ✓ | ✓ | — | ✗ |
| Details drawer (from list data) | ✓ | static | ✓ | — | ✗ |
| Status catalogue integration | ✓ | ✓ | ✓ (synthetic catalogue) | — | ✗ (content unknown) |
| Error / stale / empty states | ✓ | ✓ | ✓ | — | ✗ |
| Access control (all roles) | ✓ | ✓ | ✓ (tenant ADMIN, Driver) | — | ✗ |
| No platform tenant header; no invented endpoints | ✓ | ✓ | ✓ | — | ✗ |
| Cache refresh / no stale data after switching | ✓ | ✓ (Phase 5) | ✓ | — | ✗ |
| Tenant create / edit / status / delete | — | — | — | — | **Not available in V10** |

**Phase 6 meets its acceptance criteria for everything verifiable without backend access.** Switching still works (automated and mocked browser; manually checked by the user), Tenant Management uses the centralized context, only real V10 operations are used, unsupported operations are documented and not simulated, and all quality checks pass. Phase 7 has not been started and is waiting for review and explicit approval.


---

## 13. Enhancement — Tenant creation (POST /api/v1/platform/tenants)

Date: 2026-11-02. Starting `git status`: 91 entries, all still there afterwards. Nothing was committed, reset or pushed. No backend or OpenAPI changes. **No live tenant was created.** Every check below used synthetic data and mocked APIs.

### 13.1 Contract (backend-supplied, not in V10)

`POST /api/v1/platform/tenants` is **not** in `api-docs-v10.json`. The test `TC authorization` asserts that it's still absent from the spec. The contract comes from the backend team's brief: a request body and one observed response. The response envelope was **not** confirmed against a live server, because the BFF is HTTP-only and no test environment has been designated.

| | |
|---|---|
| Request | `{ code, name, timezone, status, s3Prefix, copyRolePermissionsFromTenantId }`. The frontend always sends all six fields, trimmed. |
| Observed response | HTTP/envelope `code: 201`, `msg: "Success"`, `data` = TenantDto fields plus `s3Prefix`, `createdAt`, `updatedAt` (`CreatedTenantDto`), `total: null`, `extend: null` |
| Client handling | The shared client treats any 2xx as success, and any envelope `code ≥ 400` as an error even inside an HTTP 200 (tested). The POST is sent **once**: there's no automatic retry, and the only re-send is the client's existing single retry after a 401 token refresh. |
| Tenant scope | PLATFORM_WIDE. No `X-Tenant-Id` (`tenant: "none"`, and `/platform/*` is platform-wide anyway) and no `?tenantId`, even when a tenant is selected (tested + browser). |
| Permission | **Undocumented.** The frontend requires `platform === true` + `tenant.all`, which is the Tenants screen gate and the only tenant code in V10. This is an explicit assumption, recorded as `requires.offSpec` on the `tenants.create` action. |

Contract tests: `OFF_SPEC_CALLS` in `tests/v10-contract.test.cjs` lists this call site as the **only** off-spec call, and the list must stay exact. `access-v10` accepts an off-spec operation only if it's really absent from V10 and has a source.

### 13.2 Form and defaults

| Field | Behaviour | Basis |
|---|---|---|
| Tenant name | Required, trimmed, not blank. No length limit is enforced because none is documented; server field errors are shown. | Contract |
| Tenant code | Optional. An empty value is sent as `""`; the observed response returned a server-generated code. The frontend never generates codes. Spaces are rejected. | Observed request/response |
| Time zone | Searchable (input + datalist of the browser's IANA zones, always including Asia/Kolkata and UTC). **Default Asia/Kolkata.** The IANA id is sent, and it must be a zone the browser recognises. | Brief |
| Status | **Default ACTIVE.** Options come from the server status catalogue's tenant set when one exists; otherwise ACTIVE plus statuses the server already returns for tenants. Nothing invented. | Brief + Phase 6 catalogue |
| S3 prefix | Optional in the form; sent as `""` when blank (whether the server requires it is unknown). No generation rule. | Contract |
| Copy role permissions from | **Fixed at 1**, shown with the source tenant's name when it's in the list. Read-only until the backend confirms other sources are allowed. The form explains that it copies role permissions and doesn't create users or a Tenant Admin. | Brief (default 1, must not be 0/null) |

**Flow:** form → validation → **review step** (name, code or "Generated by the server", time zone, status, S3 prefix, permission source) → Create.
- **While sending:** the button shows "Creating…" and is disabled. A ref guard blocks duplicate clicks; in the browser a double click sent 1 POST.
- **Success** (only after the awaited POST resolves): a toast and a banner show the **server-returned** ID and code. The list is refetched and the search/filter reset, so the new tenant is visible and the summary counts update. The selection is **not** changed.
- **Failure:** the server message is shown inline and in a toast, and field errors map to the fields. A duplicate code (`DUPLICATE`) marks the code field. A 5xx/network error says the outcome is unknown and reloads the list. A success message is never shown.

### 13.3 Authorization

| Identity | Create Tenant | Verified |
|---|---|---|
| Safe-Fare Admin (`platform: true` + `tenant.all`), all-tenants or tenant selected | ✅ | Automated + mocked browser |
| Safe-Fare Admin without `tenant.all`; `platform: "true"` string | ❌ | Automated |
| Tenant ADMIN (also holding `tenant.all`), Fleet Owner, Dispatcher, Viewer, Driver, a "SUPER_ADMIN" role name | ❌ | Automated; browser (tenant ADMIN: no route, no button, 0 `/platform` calls, 0 create POSTs) |

No role-name checks: the button and panel render only when `canPerform(access, "tenants.create")` is true.

### 13.4 Tenant isolation and roles

- **Selection:** creating doesn't modify the tenant context. In the browser, "Working in Blue Line Cabs" stayed the same before and after a create, with 0 switch calls. In the store test, the selection stayed at tenant 2, or stayed null in all-tenants mode.
- **No extra resources:** no users, Tenant Admin or other resources are created by the frontend.
- **Unknown backend behaviour:** whether the backend creates default roles or users, beyond copying role permissions from tenant 1, is **not documented** (§13.7).

### 13.5 Tests and results

| Check | Result |
|---|---|
| `npm test` | **452 / 452** (12 new in `tests/tenant-create.test.cjs`; contract, access and P6 tests adjusted for the documented off-spec create) |
| Typecheck / lint (`eslint src tests`) | pass / pass |
| `npm run build` | pass, 33 routes (no new route) |
| Mutation check (9 mutations, each restored and hash-verified) | all caught: permission source ≠ 1, default time zone, status not validated, success code taken from the request, action reachable by tenant users, button ungated, no duplicate guard, tenant switched after create, wrong endpoint |

`tenant-create.test.cjs` covers:
- defaults
- the exact six-field body and no hard-coded example values
- validation (name, code, IANA time zone, status)
- time-zone and status options
- review rows
- server-returned ID/code
- error mapping (duplicate, field errors, 401/403/409, 5xx, network)
- authorization for 11 identities
- UI wiring (gating, duplicate guard, success only after the POST, no switching, no user creation)
- the request (path, body, bearer token, no tenant header or query, even with a selection)
- list refresh showing the new tenant
- failures rejecting once with the server message

### 13.6 Mocked browser results (headless Edge, every `/api/v1` call answered locally)

Evidence: `docs/evidence/screenshots/phase6/create-*.png`, `create-results.json` and `cdp-tenant-create.cjs.txt`. Labelled **MOCKED**: synthetic data, nothing reached the BFF.

- **Form defaults:** time zone Asia/Kolkata, status ACTIVE, code and S3 prefix empty, source "tenant 1 (Synthetic Base Tenant)".
- **Validation:** an empty name plus the time zone "India Time" gave two field errors and 0 POSTs.
- **Review:** all six values shown, with code "Generated by the server".
- **Loading and request:** "Creating…" disabled; a double click sent 1 POST. Body: `{"code":"","name":"Synthetic Transport","timezone":"Asia/Kolkata","status":"ACTIVE","s3Prefix":"","copyRolePermissionsFromTenantId":1}`, with no tenant header and no query.
- **Success:** a toast and banner showed "ID 9004 · code SYNTHE" (mock-generated). The list was refetched (1 GET), the new row appeared, the summary went 3 → 4, search found it, and the selection stayed "All tenants".
- **Errors:** 409 `DUPLICATE` showed an inline error, a code-field error and an error toast, with no success. 400 with `fieldErrors[s3Prefix]` showed the S3 field error.
- **With a tenant selected:** the context was unchanged after a create, and the POST had no tenant header.
- **Viewports** (320×568, 390×844, 768×1024, 1024×768, 1366×768, 1920×1080): page, form and review had no horizontal overflow, no clipped elements and no targets under 24 px, and the panel stayed in view.
- **Other writes:** none besides login, switch-tenant and create; `?tenantId` appeared 0 times.

### 13.7 Backend questions and limitations

1. Add the operation to the OpenAPI spec, including its **required permission** (currently assumed `tenant.all`), the HTTP status (201 vs 200) and the error codes (for example `DUPLICATE` for an existing code).
2. **Validation rules:** name, code and S3 prefix lengths and formats, whether a blank `s3Prefix` is allowed, and how codes are generated or deduplicated when `code` is empty.
3. **Status values** accepted on create (only ACTIVE is confirmed), and whether `/reference/statuses` will include a tenant set.
4. **Time zones** accepted: is it any IANA id?
5. **`copyRolePermissionsFromTenantId`:** may another source tenant be chosen? What happens if tenant 1 doesn't exist or is inactive? Are roles created as well as their permissions?
6. **Side effects:** does creation also create default roles, users or a Tenant Admin, or vendor-side resources? (The frontend creates none.)
7. **Live verification:** this needs a designated test environment and **HTTPS**. No credentials or tokens have been sent to the HTTP BFF.

Tenant **edit, activation/deactivation, delete and configuration** remain unimplemented. The page note now says these operations don't exist in the API.
