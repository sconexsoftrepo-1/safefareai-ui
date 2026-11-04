# Phase 7 — Global Roles & Permission Management

Date: 2026-11-02 · Branch `new-features/Prakash` @ `eccc41e` (no commits, resets or pushes; backend untouched; Phase 8 not started). Starting `git status`: 71 entries, all preserved.

## Verification levels

| Level | Meaning |
|---|---|
| **Code implemented** | Written against the V10 schemas, typechecked |
| **Automated tests passed** | Unit / contract tests (stub fetch, synthetic data), mutation-checked |
| **Mocked-browser verified** | Production build, headless Edge; every `/api/v1/*` call answered locally with **synthetic** data; nothing reached the BFF |
| **Manually checked in frontend** | **Nothing new in Phase 7** (tenant switching was checked by the user after Phase 5) |
| **Live backend verified** | **Nothing.** No role was created, edited or deleted; no permission was assigned or removed against the real BFF. |
| **Not verified** | §13 |

About the supplied identity: the brief states that the real Safe-Fare Admin `/me` and `/me/permissions` were supplied and reviewed (`platform: true`, `tenantId: null`, `roleCode: ADMIN`, `tenant.all`, role/permission codes, platform screens `/platform/roles`, `/platform/permissions`, `/tenants`). Those payloads aren't in the repository or in this session, so Phase 7 relies on the facts as stated in the brief. Test identities remain synthetic.

---

## 1. Initial audit findings

- Unlike tenants, **V10 has a complete role and permission API** (role-controller, 14 operations).
- Before Phase 7 only `GET /roles` and `GET /permissions` were used, read-only and tenant-scoped, by the Users page's roles panel.
- **Global vs tenant roles use the same endpoints.** The only discriminator is `RoleDto.tenantId`. V10 doesn't say how a global role is represented.
- **Protection signals exist as server flags** (`protectedRole`, `fullAccess`, `assignable`, `activeUsers` on roles; `editable`, `fullAccess` on role-permission data; `scope` on permissions). Related error codes also exist: `PROTECTED_ROLE`, `ROLE_IN_USE`, `PLATFORM_PERMISSION`, `ROLE_CODE_TAKEN`, `PERMISSION_CODE_TAKEN`. **V10 documents none of their rules** (dependency D5).
- **Permission scope values** `TENANT` | `PLATFORM` are defined by the request schemas' pattern. The permission code format is defined as a dotted lowercase pattern.
- **Tenant context:** without changes, `/roles` and `/permissions` would be TENANT_SCOPED (Phase 5 path classification). A selected tenant would then narrow, or redirect, global role writes.
- **No platform routes existed** for `/platform/roles` or `/platform/permissions`.

## 2. Role and permission API inventory

All operations: Bearer auth; generic optional `X-Tenant-Id` / `tenantId` parameters (not sent by the platform screens); errors use the V10 envelope `{code, msg, data, total, extend{errorCode, fieldErrors, requestId}}`.

| Method + path | Purpose | Path / query | Body | Response | Permission | Group | Phase 7 status |
|---|---|---|---|---|---|---|---|
| GET `/roles` | List roles | — | — | `RoleDto[]` | `role.read` | Global + tenant roles | **Used** (platform-wide) |
| POST `/roles` | Create role | — | `CreateRoleRequest` {code* `^[A-Z][A-Z0-9_]{1,29}$`, description* ≤200} | 201 `RoleDto` | `role.manage` | Global role (no tenant sent) | **Used** |
| GET `/roles/{id}` | One role | id* | — | `RoleDto` | `role.read` | — | Not used (list has every field) |
| PUT `/roles/{id}` | Update role | id* | `UpdateRoleRequest` {description* ≤200} | `RoleDto` | `role.manage` | Global role | **Used** |
| DELETE `/roles/{id}` | Delete role | id* | — | Void | `role.manage` | Global role | **Used** |
| GET `/roles/{id}/permissions` | Role's permissions | id* | — | `RolePermissionsDto` {roleId, roleCode, tenantId, fullAccess, editable, permissionCodes} | `role.permission.read` | Role-permission mapping | **Used** (global roles only) |
| POST `/roles/{id}/permissions` | Add codes | id* | `RolePermissionsRequest` {permissionCodes* ≤300, unique} | `RolePermissionsDto` | `role.permission.create` | Mapping | **Used** |
| PUT `/roles/{id}/permissions` | Replace all codes | id* | `RolePermissionsRequest` | `RolePermissionsDto` | `role.permission.update` | Mapping | **Not used, by design** (could overwrite concurrent changes) |
| DELETE `/roles/{id}/permissions` | Remove codes | id*, `codes`* (array ≤300, repeated) | — | `RolePermissionsDto` | `role.permission.delete` | Mapping | **Used** |
| GET `/roles/permission-matrix` | Roles × permissions | — | — | `PermissionMatrixDto` | `role.permission.read` | Mapping (overview) | Not used (optional view) |
| GET `/permissions` | Catalogue | — | — | `PermissionDto[]` {code, description, scope} | `role.permission.read` or `permission.manage` | Permission catalogue | **Used** (platform-wide) |
| POST `/permissions` | Create code | — | `CreatePermissionRequest` {code* pattern ≤60, description* ≤200, scope* TENANT\|PLATFORM} | 201 `PermissionDto` | `permission.manage` | Catalogue | **Used** |
| PUT `/permissions/{code}` | Update code | code* | `UpdatePermissionRequest` {description*, scope*} | `PermissionDto` | `permission.manage` | Catalogue | **Used** |
| DELETE `/permissions/{code}` | Delete code | code* | — | Void | `permission.manage` | Catalogue | **Used** |

Related but **out of scope** (not touched): menus (`/menus`, `/menus/{id}`, `/menus/{id}/operations`, `menu.manage`), `GET /screens/{menuKey}/operations`, and `/me/menus`.

## 3. Global vs tenant classification

| Concern | Rule in the frontend |
|---|---|
| Which roles are global | `RoleDto.tenantId` absent or `null` → **global**; a number → tenant role (needs backend confirmation, §12) |
| Global role screen | Manages **global roles only**. Tenant roles are listed read-only ("Tenant roles (view only)"); their mappings are never fetched; edit, delete and assign aren't offered |
| Request scope | Every Global Roles and Catalogue call is **PLATFORM_WIDE**: `tenant: "none"`, so no `X-Tenant-Id` even with a tenant selected, and never `?tenantId` |
| Tenant-scoped role reads | The Users page keeps `admin-service` (tenant-scoped reads of `/roles` and `/permissions`), unchanged |
| Tenant role-permission writes | **Not exposed anywhere** (product rule). The Users page has no permission editing (tested) |
| Phase 5 interplay | Platform actions are `tenantWrite: false`, so all-tenants mode doesn't block them; a tenant selection doesn't change them (browser: identical rows, no header) |

## 4. Existing functionality reused

- **Central resolver and route guard:** new screens, actions and widgets are registry entries checked against the V10 spec by the existing tests.
- **Shared API client:** bearer token, refresh, single retry, error envelope and `fieldErrorMap`.
- **Phase 5 request scope:** the `tenant: "none"` option.
- **Tenant context:** unchanged.
- **Shared UI:** `Panel`, `SlideOverPanel` / `DetailRow`, `ConfirmDialog`, `FormField`, `SegmentedControl`, `StatusBadge`, `ApiErrorState`, `EmptyState`, `LoadingSkeleton`, `toast`.
- **Navigation:** the Platform nav group, `SERVER_ROUTE_PATHS`.

## 5. Features implemented

### Global Roles — `/drive-vision/platform/roles` (server `/platform/roles`)
- **List:** id, code, description, flags (Protected, Full access, Not assignable), permission count, active users.
  - Permission count is "All" for full access, the number of distinct server codes otherwise, or "—" when not returned (never 0).
  - Search covers code, description and id. Filters: scope (global / tenant view-only) and flags.
  - Loading, empty, error (server `msg`) and stale-refresh states; refresh button; cards on narrow screens, table on wide.
- **Create** (`role.manage`): code (pattern) + description (≤200), validated before sending; duplicate submits blocked; server `fieldErrors` and `msg` shown (e.g. `ROLE_CODE_TAKEN`); list refreshed and new role opened.
- **Edit description** (`UpdateRoleRequest` has description only) and **delete** (confirmation).
- **Role drawer:** all fields plus the permission editor.

### Role-permission mapping (Global Roles → role → Permissions)
- **Lists:** Assigned and Available tabs, grouped by code prefix (collapsible), with search. Each code shows its scope badge and description ("No description provided by the backend." when missing). Assigned codes missing from the catalogue are flagged.
- **Selecting changes:** checkboxes create pending additions and removals. A code is never in both lists, and toggling again undoes it.
  - Additions are limited to unassigned codes and removals to assigned ones, so duplicates and no-ops never reach the server.
- **Review dialog:** exact additions and removals, plus warnings:
  - Platform-scope permission (the server may refuse it with `PLATFORM_PERMISSION`).
  - Self-lockout: you hold this role and are removing platform-admin codes.
  - Frontend effect: holders lose access the app ties to the removed code.
- **Blocking problems:** a missing `role.permission.create` / `.delete` permission, codes not in the catalogue, or more than 300 codes per request.
- **Save:** POST additions, then DELETE `?codes=` removals, both without a tenant header.
  - Each step's success or failure is recorded. A **partial** result says what was saved and what failed, with the server's `msg`.
  - The mapping and the role list are **always re-read** afterwards; success is never assumed.
- **Read-only cases:** full-access roles ("no list to edit"), `editable === false`, tenant roles.

### Permission Catalogue — `/drive-vision/platform/permissions` (server `/platform/permissions`)
- **Display:** groups by code prefix; code, scope badge (TENANT / PLATFORM / "no scope"), description (or the "not provided" note), and **frontend usage** — which screens, actions, features or widgets of this app check the code ("Not used by this app" otherwise).
- **Filters:** search on code and description; scope filter (values present plus counts); code-prefix filter.
- **Create** (code pattern ≤60, description ≤200, scope TENANT|PLATFORM) and **edit** (description, scope; a warning when scope changes).
- **Delete:** confirmation that warns which app access the code controls. A server refusal (e.g. 409) keeps the dialog open with the message.

### Effect of permission changes on frontend access
`frontendUsage(code)` reads the app's own access registries, so the catalogue, the delete confirmation and the mapping review show exactly what in this frontend a code controls.

## 6. Unsupported features and missing APIs

- **Not built (available but not needed / deliberately unused):** `GET /roles/{id}`, `PUT /roles/{id}/permissions` (replace), `GET /roles/permission-matrix` (possible matrix view).
- **Not in V10:** renaming a role's code (`UpdateRoleRequest` has description only), role "status", permission "module", "action" or "category" fields (grouping uses the code prefix, labelled as such), and tenant-specific global-role enforcement rules.
- **Not exposed by product rule:** tenant role-permission editing, for any non-platform user.

## 7. Permission and access-control rules

| Item | Requirement (all also `platform === true`) |
|---|---|
| Global Roles screen | `role.read` (V10 requirement of `GET /roles`) |
| Role create / edit / delete | `role.manage` |
| View a role's permissions | widget `role.permission.read` + catalogue read |
| Add / remove permissions | `role.permission.create` / `role.permission.delete` (each side gated separately) |
| Permission Catalogue screen and writes | `permission.manage` |

- Both screens are `platformOnly`; actions require their screen; the two new widgets also check `platform`.
- **Tested identities:** Safe-Fare Admin allowed. Denied with **0** role or permission requests in the browser:
  - tenant ADMIN, including one holding every V10 code;
  - `platform: false` + ADMIN, and `platform` missing;
  - Fleet Owner, Operator (synthetic), Dispatcher, Viewer, Driver.
- **Missing precise codes:** `platform: true` without the specific code is denied that specific screen, action or widget (e.g. without `role.manage` the roles screen is read-only).
- **Never used as a grant:** `roleCode` alone or a code alone. The platform pages contain no permission logic of their own (static test).

## 8. Protected role behaviour

From server flags only. Disabled actions say why, and add "The backend remains the authority":

| Flag / data | Frontend behaviour | Basis |
|---|---|---|
| `protectedRole: true` | Edit and delete disabled | Conservative frontend choice: V10 has the flag and the `PROTECTED_ROLE` error but no documented rule |
| `activeUsers > 0` | Delete disabled; missing `activeUsers` doesn't block | Frontend inference from the `ROLE_IN_USE` error code |
| `fullAccess: true` | Mapping read-only ("every permission") | No explicit list exists to edit |
| `editable: false` | Mapping read-only | Server flag |
| `editable` missing | Not blocked; backend decides | — |
| PLATFORM-scope code added | Warning, not blocked | `PLATFORM_PERMISSION` error exists; rule undocumented |
| Removing platform-admin codes from your own role | Warning (self-lockout) | Frontend safeguard |

Last-administrator protection: **no V10 signal exists**, so the frontend can't enforce it. It's documented as a backend responsibility.

## 9. Files

**Created:**
- `src/features/drive-vision/api/role-admin-service.ts`
- `src/components/drive-vision/platform/role-permission-model.ts`
- `src/components/drive-vision/platform/global-roles.tsx`
- `src/components/drive-vision/platform/role-permission-editor.tsx`
- `src/components/drive-vision/platform/permission-catalog.tsx`
- `src/app/drive-vision/platform/roles/page.tsx`, `src/app/drive-vision/platform/permissions/page.tsx`
- `tests/phase7-role-permission.test.cjs`
- `docs/phase7-role-permission-report.md`
- `docs/evidence/screenshots/phase7/` (23 screenshots, `results.json`, `cdp-phase7.cjs.txt`)

**Modified:**
- `access/access-policy.ts`: `roles` / `permissions` screens, 8 actions, 2 widgets plus the platform check, 3 server routePaths.
- `api/types.ts`: `RolePermissionsDto`, request types, scope note.
- `navigation/nav-config.ts`: Platform group entries.
- **Tests:**
  - `access-v10`: platform-screen actions aren't tenant writes; the admin's screen list.
  - `final-audit-fixes` GA-16: tenant ADMIN **must not** get platform actions, now asserted explicitly.
  - `v10-contract`: 11 runtime cases.
- **Docs:** `implementation-status.md`, `v10-api-frontend-mapping.md`, `current-architecture.md`, `v10-permission-matrix.md`.

## 10. Automated test results

| Check | Result |
|---|---|
| `npm test` | **408 / 408** (378 + 19 Phase 7 + 11 contract cases) |
| `npm run typecheck` | pass |
| `npm run lint --max-warnings=0` | pass |
| `npm run build` | pass, **33 routes** |
| V10 contract | 0 errors; every new call has a runtime case asserting method, path, body, query and no tenant header |

**Phase 7 tests:**
- **Roles:** filters, permission count, validation, protection reasons.
- **Catalogue:** filters, grouping, validation, missing descriptions, frontend usage.
- **Mapping:** toggle, change plan (duplicates, unknown codes, permissions, 300 limit, warnings), read-only rules, apply summary, editor re-read and duplicate-submit guards.
- **Service:** 11 calls platform-wide even with a tenant selected; repeated `codes`; Users page still tenant-scoped.
- **Errors:** 409 `ROLE_CODE_TAKEN` / `PROTECTED_ROLE` / `ROLE_IN_USE`, 400 `PLATFORM_PERMISSION`, 403, 404, 503, network.
- **Sequences:** a partial apply.
- **Access:** 10 identity variants plus the missing-code cases.
- **Routes and regressions:** routePath mapping, static regression checks.

Existing Phase 5 and 6 tenant tests pass unchanged (switching, isolation, tenant management, platform dashboard, tenant ADMIN Overview, drivers).

**Mutation check** (each run from a backup, then restored; all caught):

| Mutation | Failing |
|---|---|
| Roles screen not `platformOnly` | 1 |
| Role widgets without the platform check | 1 |
| Global role create treated as a tenant write (blocked in all-tenants mode) | 1 |
| Role list follows the selected tenant (tenant header) | 1 |
| Duplicate assignments sent | 1 |
| Protected role deletable | 1 |
| `editable: false` ignored | 1 |
| Partial save reported as success | 2 |
| Tenant roles treated as global | 3 |

## 11. Browser viewport results (mocked, synthetic data)

| Viewport | Roles list | Role drawer + permission editor | Catalogue |
|---|---|---|---|
| 320×568 | no overflow / clipping / targets < 24 px | full-width drawer, in view | ✓ |
| 390×844 | ✓ | ✓ | ✓ |
| 768×1024 | ✓ | ✓ (672 px panel) | ✓ |
| 1024×768 | ✓ | ✓ | ✓ |
| 1366×768 | ✓ | ✓ | ✓ |
| 1920×1080 | ✓ | ✓ | ✓ |

**Functional (1366×768):**
- **Roles list:** global roles ADMIN, AUDITOR (missing fields shown "—"), OPS_LEAD; the tenant tab shows only TENANT_DISPATCH; search and "Protected" filter work.
- **ADMIN** (protected, full access): edit and delete disabled with the reason; mapping read-only.
- **OPS_LEAD mapping:** add `device.update`, remove `driver.read`.
  - The review showed both plus the frontend-effect warning.
  - Saving sent `POST /roles/2/permissions {"permissionCodes":["device.update"]}`, then `DELETE /roles/2/permissions?codes=driver.read`, both with no tenant header. It then re-read `/roles/2/permissions` and `/roles` and showed "Permissions updated".
- **Partial save** (mocked removal 409): "Partly saved: added 1; removing failed…" with the server `msg`, and the counts from the server's state.
- **Create role:** an invalid code made 0 requests; a mocked 409 showed "Role code already exists (MOCKED)"; the retry posted `{code: "QA_LEAD", description}` without a tenant header.
- **Catalogue:**
  - 10 prefix groups; the missing-description note shown; search and PLATFORM filter work.
  - Deleting `driver.delete` warned "action drivers.delete"; the mocked 409 kept the dialog open.
  - Editing a scope showed the warning.
- **Tenant selected (Acme):** `GET /roles` still had no tenant header, with identical rows.
- **Unauthorized** (tenant ADMIN with every code; Driver): both routes denied, no platform-config nav links, **0** `/roles` or `/permissions` requests.
- **Fix made during this phase:** at 320 px the sticky "pending" bar covered the permission tabs even with nothing pending. It now appears only while changes are pending.

## 12. Backend dependencies

1. **Global role representation.** Confirm that a global role has `tenantId` absent or null. Confirm what `GET /roles` returns to the Safe-Fare Admin without a tenant (global + all tenant roles?).
2. **Creating a global role.** Confirm that `POST /roles` without a tenant creates a global role. The V10 convention ("creates without a tenant → `TENANT_REQUIRED`") may apply. The frontend never sends a tenant here (it would create a tenant role) and shows any `TENANT_REQUIRED` error.
3. **Flag semantics:** `protectedRole`, `fullAccess`, `assignable`, `editable`, `PermissionDto.scope`, and when `PROTECTED_ROLE`, `ROLE_IN_USE` and `PLATFORM_PERMISSION` are returned (D5).
4. **Last-administrator and self-lockout protection** on the backend.
5. **Permission deletion when in use:** the expected error code.
6. **D6:** confirmation that tenant ADMIN is refused on role-permission and catalogue writes. The frontend hides them regardless.
7. **Carried over:** test accounts, a safe test environment for writes, **HTTPS**.

## 13. Known limitations

- Global vs tenant classification relies on `tenantId` (§12.1).
- Protection is conservative and flag-based; the backend may allow more (e.g. editing a protected role's description) or less.
- Grouping uses the code prefix, not a backend module.
- No permission-matrix overview; mapping is edited per role.
- Changes to the catalogue or to roles don't update the signed-in user's own `/me/permissions` until the next session load. The frontend doesn't re-read identity after saving.
- Add and remove are two requests (V10 has no atomic delta), so partial results are possible. They are reported, and the server state is re-read.

## 14. Verification levels per feature

| Feature | Code | Automated | Mocked browser | Manual (frontend) | Live backend |
|---|---|---|---|---|---|
| Global Roles list / search / filters / states | ✓ | ✓ | ✓ | ✗ | ✗ |
| Role create / edit / delete | ✓ | ✓ | ✓ (create, disabled states) | ✗ | ✗ (no real write) |
| Role-permission mapping (add / remove / partial / re-read) | ✓ | ✓ | ✓ | ✗ | ✗ (no real write) |
| Permission Catalogue list / filters / grouping | ✓ | ✓ | ✓ | ✗ | ✗ |
| Catalogue create / edit / delete | ✓ | ✓ | ✓ (delete refusal, scope warning) | ✗ | ✗ (no real write) |
| Global vs tenant role separation | ✓ | ✓ | ✓ | ✗ | ✗ (§12.1) |
| No tenant header on platform configuration | ✓ | ✓ | ✓ | ✗ | ✗ |
| Access control (all identities) | ✓ | ✓ | ✓ (tenant ADMIN, Driver) | ✗ | ✗ |
| Regressions (tenant switching, Tenant Management, dashboard, tenant Overview, drivers) | ✓ | ✓ | partly (tenant switch in this run) | switching ✓ (user, earlier) | ✗ |

**Phase 7 meets its acceptance criteria for everything verifiable without backend access.** Live verification and real writes remain intentionally untested. Phase 8 has not been started and is waiting for review and explicit approval.


---

## Enhancement (2026-11-02) — checkbox-based role permission management

Scope: **Global Roles → Open role → Permissions** only. The Global Roles list, role create/edit/delete, the Permission Catalogue, authorization and the API layer are unchanged. No new endpoint, no V10 contract change, no backend change.

### What changed

- **One grouped checklist instead of Assigned / Available tabs.** Every catalogue permission has a checkbox; *checked = assigned*. Assigned codes missing from the catalogue are still listed ("not in catalogue").
  - Modules use the code prefix, e.g. "Alarm permissions `alarm.*`". Each shows "n/m selected" and a module checkbox: checked when all are selected, unchecked when none, **indeterminate** (native `indeterminate`, `aria-checked="mixed"`) when some.
  - **Summary line:** "*x* assigned of *y* available · *z* selected (+a −r)", plus **Reload** (re-reads assignments and catalogue).
- **Local pending changes:** checking an unassigned code makes a pending addition; unchecking an assigned one makes a pending removal; toggling back undoes it. Nothing is sent until **Review changes → Save changes**.
- **Bulk selection:**
  - **Select all / Deselect all** act on the permissions currently shown. With a search or filter active they read "Select shown / Deselect shown".
  - **Module checkbox** selects or deselects that module (shown items).
  - Buttons are disabled when they wouldn't change anything.
- **Search and view filter** (All / Assigned / Not assigned / Changed) change only what's shown. Pending changes outside the visible set are never touched. "Changed" lists exactly the pending codes.
- **Read-only rules** are the existing ones, applied to single and bulk selection alike:
  - full access, `editable: false`, tenant role → every box (and module box) disabled; no bulk buttons;
  - no `role.permission.create` → unassigned boxes can't be checked, and Select all adds nothing;
  - no `role.permission.delete` → assigned boxes can't be unchecked, and Deselect all removes nothing.
- **Review:** "*a* to add · *r* to remove", the exact lists, and the existing warnings (platform scope, self-lockout, lost frontend access) and blocking problems. **Cancel** returns to the editor with the selection unchanged.
- **Save:** unchanged operations, still POST `/roles/{id}/permissions {permissionCodes}` for additions, then DELETE `/roles/{id}/permissions?codes=…` for removals, both without a tenant header. Duplicate submissions are blocked. **No** replace-all (`PUT`).
  - Afterwards the role's permissions and the role list are always re-read.
  - **New:** changes the server didn't accept stay pending. Success clears them; a failure keeps all; a partial result keeps only the failed step. The banner says the unsaved selection is kept for another save or a discard.
- **Catalogue vs. assignments:** creating a permission in the Permission Catalogue assigns it to no role. The editor shows it **unchecked** the next time a role is opened (or after **Reload**).
- **Switching roles** loads that role's assignments: the editor is keyed by role id, so no state carries over.

### Model (pure, tested) — `platform/role-permission-model.ts`

`desiredSelection`, `setCodes` (single and bulk, respecting `locked` / `canAdd` / `canRemove`), `codeEditable`, `groupState` (all / none / some), `pendingAfterApply`. The existing `planChanges` (no duplicates or no-ops, problems, warnings) and `summarizeApply` are reused.

### Files

- **Modified:** `src/components/drive-vision/platform/role-permission-model.ts` (functions above), `src/components/drive-vision/platform/role-permission-editor.tsx` (checkbox UI), `tests/phase7-role-permission.test.cjs` (+7 tests), `docs/phase7-role-permission-report.md` (this section), `docs/implementation-status.md`, `docs/current-architecture.md` (test count).
- **Added evidence:** `docs/evidence/screenshots/phase7/ui-*.png` (17), `results-checkbox-ui.json`, `cdp-phase7-ui.cjs.txt`. The earlier Phase 7 screenshots of the tab UI are kept as history.

### Tests

- **Result:** `npm test` **429 / 429** (422 + 7). The existing Phase 7 tests are unchanged and pass. Typecheck pass · lint (`--max-warnings=0`) pass · build pass, 33 routes.
- **New tests cover:** assigned codes checked and unassigned unchecked; check → addition, uncheck → removal, undo; Select all, Deselect all, module select and deselect; indeterminate state (model and rendering); search and filters preserve the selection; locked roles and missing rights can't be bypassed by bulk selection; exact review additions and removals; failed and partial saves keep the unaccepted changes; the save path uses only add/remove plus re-read (no replace).
- Unauthorized access is covered by the existing access tests (unchanged).

**Mutation check** (each run from a backup, restore hash-verified; all caught):

| Mutation | Failing |
|---|---|
| Bulk add ignores `role.permission.create` | 1 |
| Bulk remove ignores `role.permission.delete` | 1 |
| Locked role editable | 1 |
| No indeterminate state | 1 |
| Failed additions dropped after save | 1 |
| Pending removals still shown checked | 1 |
| Pending changes lost after a failed save (editor) | 1 |

### Mocked browser results (synthetic data; nothing reached the BFF)

- **Open FLEET_OWNER** (4 of 15 assigned): exactly those 4 checked; alarm, device and driver modules indeterminate ("2/5", "1/4", "1/4").
- **Single changes:** checking `alarm.rule.create` and unchecking `device.read` gave (+1 −1).
- **Device module checkbox:** 4/4 and checked, then 0/4.
- **Search "rule" → Select shown:** only `alarm.rule.update` / `.delete` added (3 shown); earlier picks preserved after clearing.
- **Select all / Deselect all / Discard:** 15/15, then 0/15 (−4), then back to the server state.
- **Review:** "2 to add · 1 to remove", the lists, and the frontend-access warning. Cancel kept the selection.
- **Save:** `POST /roles/5/permissions {"permissionCodes":["alarm.rule.create","alarm.rule.update"]}`, then `DELETE /roles/5/permissions?codes=driver.read`, then `GET /roles/5/permissions` and `GET /roles`. No tenant header; "Permissions updated."; 5 checked.
- **Partial** (mocked removal 409): "Partly saved: added 1; removing failed…" plus the server `msg` and the "kept" note. The failed removal is still pending ("Changed 1").
- **Protected ADMIN** (full access): read-only notice; all 15 boxes and every module box disabled; no Select all.
- **Catalogue:** groups listed. Creating `report.export` sent one POST and **0** role writes; in the editor `report.export` is present and **unchecked**.
- **Unauthorized** (tenant ADMIN holding every code): "You don't have access to this page", **0** `/roles` / `/permissions` requests.
- **Totals:** 0 tenant headers on role administration; 0 replace calls.
- **Viewports** 320×568, 390×844, 768×1024, 1024×768, 1366×768, 1920×1080: editor and review dialog without overflow, clipping or targets under 24 px.

### Limitations

- **Bulk scope:** Select / Deselect all act on the *shown* permissions (search and filter applied), by design, so a search can be bulk-selected without touching hidden codes.
- **Two requests:** saving is still two requests (V10 has no atomic delta), so partial results are possible. They're reported, and the unaccepted part stays pending.
- **Catalogue refresh:** a permission created in another tab appears after **Reload** or reopening the role (no live push).
- **Sticky bar:** at 320 px the review bar overlays the bottom of the scrolling list while changes are pending.
- **Live verification:** none. No real role permission was changed.
