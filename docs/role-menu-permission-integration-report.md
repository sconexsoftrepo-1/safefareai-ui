# Role Menu Permission Integration Report

**Status:** frontend work is finished and tested on mocked responses. **My Work Add, Edit and Delete are blocked on the backend mapping** in [My Work CRUD codes](#my-work-crud-codes). No live authenticated call has been made. Nothing is committed.

**Date:** 2026-11-05 (first written 2026-11-04)

**Contract:** `docs/contracts/role-menu-permission-api.txt` (a copy of `Role_Menu_Permission_API.txt`)

This report covers the original integration, the final improvements made after review, and the correction to cell-level editability. Where they differ, the later section applies, and [My Work CRUD codes](#my-work-crud-codes) is the latest.

## How to read the evidence

| Level | What it proves |
|---|---|
| **Mocked** | Every `/api/v1` response was synthetic, written from the contract. It proves the frontend follows the document, not that the backend behaves that way. |
| **Live spec** | The public `/v3/api-docs` on `185.193.19.156:9096` was read. It shows what the backend documents, not how it behaves. |
| **Database output** | The Driver permissions listed in the 2026-11-05 brief. Supplied by the team; not queried or changed from here. |
| **Written brief** | The latest GET findings for role 4 in tenant 1 were supplied as a summary. The JSON itself was not attached and is not on this machine. |
| **Hypothetical** | Tests and browser runs marked this way use the desired My Work contract, built in the test only. It shows the screen is ready. It says nothing about the backend. |
| **Live calls** | Unauthenticated `GET /roles/4/menu-permissions`, which returned 401, repeated on 2026-11-05. **No authenticated call and no permission write was made, on any tenant.** |

Every screenshot and `results*.json` entry in this report is mocked.

## My Work CRUD codes

**Status: blocked on the backend. The grid does not manage these three codes yet, and no frontend change can make it do so.**

### Backend mapping

| Question | Answer | Source |
|---|---|---|
| Are the codes in My Work Add, Edit and Delete? | **No.** All three cells are null | Written brief |
| Where are the codes? | `otherPermissionCodes`, beside `own.data.read` | Written brief |
| Does the contract map them? | **No.** `role-menu-permission-api.txt` doesn't mention them | Contract |
| Does the public spec list them? | **No.** `/v3/api-docs` lists `driver.app` and no `driver.app.work.*` code | Live spec, 2026-11-05 |
| Could the PUT accept them? | **No.** The contract refuses a code that isn't a grid checkbox with `400 INVALID_VALUE` | Contract |

As section 2 of the brief requires, the frontend stops here. No cell was fabricated, and these codes are not sent.

### `otherPermissionCodes`

| | Before | Now, per the brief |
|---|---|---|
| Role 4, tenant 1 | `own.data.read` | `driver.app.work.create`, `driver.app.work.update`, `driver.app.work.delete`, `own.data.read` |

The codes are not lost. They are listed under the grid as kept on save and are never in the PUT body. The contract says the backend keeps them unchanged. That was exercised only against the mock.

### GET and PUT

**GET `/api/v1/roles/{roleId}/menu-permissions`.** Fields read: `tenantId`, `roleId`, `roleCode`, `fullAccess`, `editable`, `otherPermissionCodes`, and for each menu `menuId`, `menuKey`, `title`, `parentId`, `sortOrder`, `access` and `resources[]` (`label`, `view`, `add`, `edit`, `delete`, `actions[]`). A cell is `permissionCode`, `granted` and `editable`; an action also has `label`. These come from the contract. **No real response has been captured.**

**PUT `/api/v1/roles/{roleId}/menu-permissions`.** The request is `{"permissionCodes": [...]}`: every ticked grid code, once each. The response is the saved grid, in the same shape as GET. Both come from the contract and the mock. **No real PUT was made.**

### Frontend change

**Saves are now confirmed.** Before, the success message appeared as soon as the PUT returned, without checking the result.

- The `granted` values in the PUT response are compared with the codes sent, in both directions.
- If they match, success is shown.
- If they differ, or the response is empty or for another tenant or role, the screen shows "The server didn't confirm this save", names the codes, and shows no success message.
- The GET after the save runs in both cases, and the grid then shows that result. The comparison uses the PUT response, not that later GET.

Nothing else in `src` changed. No CRUD code is hardcoded, and a test checks this.

### When the backend sends the cells

**No further frontend change should be needed.** On a hypothetical grid in the desired shape, with the same built production app:

| Check | Result (mocked, hypothetical) |
|---|---|
| Add, Edit and Delete | Show the three codes, checked and enabled, from the response |
| All four `granted` and `editable` combinations | Follow the response |
| Read-only `driver.app` parent | Doesn't disable the CRUD cells |
| Each CRUD box | Changes alone; Save enables |
| Respond, execute and swap | Stay in their own rows, unchanged |
| PUT body | The complete list, less the one change; no `own.data.read` |
| Requests | GET, PUT, GET |
| Reload | Change held; `otherPermissionCodes` was only `own.data.read` |
| Saving in tenant 1 | 2419 and 2499 unchanged |
| Backend keeps a different result | Warning shown, no success message |

### Driver UI enforcement: not met

> **Partly superseded.** The driver buttons now follow their granular operations: see `docs/driver-permission-integration-report.md`. That report's test count is the current one. The finding below still holds for the three CRUD codes.

**The driver UI does not enforce any `driver.app.*` operation code, and it has nothing to gate for these three.**

- `src` uses only `driver.app` and `own.data.read` for My Work. The screen needs both, and every write action needs `own.data.read` (`driver.selfService`).
- `driver.app.work.respond`, `.execute` and the other granular codes aren't read either. A driver without them still sees those buttons.
- **My Work has no Create, Edit or Delete action.** Its writes are accept, decline, start, complete and swap, plus shifts, leave, checklist and contact details.

No gating was added. It would mean inventing actions that don't exist, and hiding the existing buttons is a separate piece of work that also depends on item 4 below.

### Backend API enforcement: not verified

The public spec shows every `/driver/*` operation requiring `own.data.read`, and **lists no `/driver/*` operation that creates, updates or deletes a work record**. No direct request was tried, because there is no designated test environment or test account. Adding the codes to the database does not by itself enforce them.

### Backend changes required

**A decision comes first: what do these three codes control?** Accept and decline already map to respond, and start and complete to execute, so no operation is left in the spec for them. If there is none, the three boxes would change the grid and nothing else.

Once that is decided, this is needed from the backend. Nothing here has been changed.

1. **Define the operations.** Name the exact `/driver/*` operation for each code, adding endpoints if create, update and delete are real features. Please also send their contract, since the frontend can't build these without one.
2. **Map the menu.** Map My Work's CREATE, UPDATE and DELETE to the three codes, for example through `PUT /api/v1/menus/{id}/operations`. Check with `GET /api/v1/screens/{menuKey}/operations`. Neither was called.
3. **GET.** Return the codes in `resources[].add`, `.edit` and `.delete` on the main My Work row, with real `granted` and `editable`, and remove them from `otherPermissionCodes`.
4. **PUT.** Accept them as grid checkbox codes, and remove them when left out of the list.
5. **Enforcement.** Check the codes on the `/driver/*` operations, and return 403 when one is missing. Please also confirm whether respond, execute and the other granular codes are enforced, because the spec still shows `own.data.read`.
6. **Login and refresh.** Return them in `user.permissions`, `menus[].operations` and `GET /me/permissions`, so the driver screens can read them.
7. **Other tenants.** Decide how 2419, 2499 and other tenants receive these codes. Nothing is assumed for them.
8. **`editable` for the Safe-Fare Admin.** Confirm the admin can edit these cells. The contract makes a code read-only for a caller who doesn't hold it.

**Label to confirm:** the brief's JSON says `"My work"`, while its summary says "My Work". The screen shows whatever is sent. The tests look rows up by label, so they will flag this when the fixture is replaced.

### Tests

All mocked. Tests for the mapped state are named HYPOTHETICAL.

| # | Requirement | Result |
|---|---|---|
| 1 | Codes in the right columns when returned | Pass (hypothetical) |
| 2 | Absent from the grid while null | Pass |
| 3 | Null cells empty and disabled | Pass |
| 4 | Each CRUD box changes independently | Pass (hypothetical) |
| 5 | Action permissions unchanged | Pass (hypothetical) |
| 6 | `own.data.read` kept outside the grid | Pass |
| 7 | PUT sends the complete list | Pass (hypothetical) |
| 8 | GET follows a successful save | Pass |
| 9 | Reload keeps the changes | Pass (hypothetical) |
| 10 | Tenant isolation | Pass |
| 11 | Driver UI respects the codes | **Not met.** Recorded as a `todo` test |
| 12 | Backend rejects unauthorized requests | **Not run.** Recorded as a `todo` test |

| Check | Result |
|---|---|
| Full test suite | **652 tests: 650 pass, 0 fail, 2 todo** (#11 and #12) |
| TypeScript, lint, production build | Pass |
| Contract checks (`v10-contract`, `access-v10`) | 102 of 102 pass |
| Mocked browser run (headless Edge, production build) | All scenarios behaved as expected |

Browser evidence is in `docs/evidence/screenshots/role-menu-permission/`: `crud-*` screenshots, `results-driver-crud.json` and `cdp-driver-crud.cjs.txt`.

## Driver permission matrix: database mappings

**Status: implemented; verified on mocked data only.** The database output is taken from the brief. The API response has not been seen.

### What changed

| Area | Before | Now |
|---|---|---|
| Null cells | Enabled box; a tick turned amber with a "won't be saved" note | Empty and disabled, with no amber state and no handler |
| Explanation | "Requires backend mapping" | Each box says the operation isn't mapped for that row, to mouse and screen-reader users. A note under the grid says it doesn't mean a permission is missing |
| My Work in the test fixture | Respond and execute were actions on the main row | Each has its own row, as the backend structure says |
| Fixture `granted` values | Partly placeholders | Every `driver.app.*` cell is granted, matching the database output for role 4 in tenant 1 |

The rule applies to every null cell on every menu, and no menu name or code is hardcoded. Removed: the amber box and note, its state, `PendingCell` and `pendingCellId`. Added to the model: `unmappedColumns` and `hasUnmappedCells`.

The app never reads the fixture. It renders the current API response, so `permissionCode`, `granted` and `editable` come from the server when it runs against the live API.

### My Work layout

| Row | Add | Edit | Delete | View | Actions |
|---|---|---|---|---|---|
| My Work | not mapped | not mapped | not mapped | `driver.app.work.read` | |
| Accept or decline trips | not mapped | not mapped | not mapped | not mapped | `driver.app.work.respond` |
| Start and complete trips | not mapped | not mapped | not mapped | not mapped | `driver.app.work.execute` |
| Trip swap requests | `driver.app.swap.create` | not mapped | not mapped | not mapped | |

### Live API comparison: not done

**The GET could not be compared.** The API needs a token. No session was available here: the Chrome extension wasn't connected, and no credentials were entered or looked for.

| Compared item | Result |
|---|---|
| `roleId`, `tenantId` | **Not verified** |
| Resource labels | **Not verified** |
| Permission codes | **Not verified** |
| `granted`, `editable` | **Not verified** |
| `otherPermissionCodes` | **Not verified** |

What is known from the live server without a login:

- `GET /api/v1/roles/4/menu-permissions` exists and returns 401 without a token.
- The public `/v3/api-docs` still lists no `driver.app.*` code. The spec may simply not list them, so this doesn't show the codes are absent from the API.

**To finish it,** sign in as Safe-Fare Admin, select tenant 1, open the DRIVER role, and copy the response from the browser's Network tab. Then replace the contents of `tests/fixtures/driver-role-menu-permissions.json` with its `data` object and rerun `tests/driver-menu-permissions.test.cjs`. Any different label, code or flag shows up as a failing test. Repeat the GET for tenants 2419 and 2499 by switching tenant; the screen sends the header itself.

### Things to check against the live response

1. **`driver.app`.** It isn't in the database list in the brief, which says assigned permissions "include" those shown. The fixture keeps it as the granted, read-only module box, from the earlier brief and the contract. Removing it from a PUT would remove it from the role, so check it is returned.
2. **`editable` for the Safe-Fare Admin.** The contract says a box is read-only when the signed-in user doesn't hold that permission. If the admin doesn't hold the new codes, they will show as disabled, and that would be correct API-driven behaviour rather than a screen fault. All 15 are editable in the fixture.
3. **Action labels.** The fixture uses the row name as the action's label, as the contract's examples do.
4. **Tenants 2419 and 2499.** Nothing is assumed. The mocks use made-up states: 2419 has the cells with only two codes granted, and 2499 has no granular cells at all.
5. **Enforcement.** Whether `/driver/*` checks the new codes is still unconfirmed. See [What the live server shows](#what-the-live-server-shows) and [Frontend gap if the codes are enforced](#frontend-gap-if-the-codes-are-enforced).

### Tests

All mocked. The 10 requested scenarios are in `tests/driver-menu-permissions.test.cjs` and run through the real API client, against a stub that refuses off-grid codes as the contract does.

| # | Requirement | Result |
|---|---|---|
| 1 | My Work View uses `driver.app.work.read` | Pass |
| 2 | My Work Add, Edit and Delete are null and disabled | Pass |
| 3 | Accept or decline uses `driver.app.work.respond` | Pass |
| 4 | Start and complete uses `driver.app.work.execute` | Pass |
| 5 | Trip swap uses `driver.app.swap.create` | Pass |
| 6 | All 15 assigned permissions render | Pass |
| 7 | Each of the 15 changes alone, enables Save, saves, and leaves the others in the body | Pass |
| 8 | Null cells never enter the PUT | Pass |
| 9 | Tenants 1, 2419 and 2499 load and save independently | Pass |
| 10 | After a save, the screen shows the backend's state, including when the backend kept less than was sent | Pass |

| Check | Result |
|---|---|
| Full test suite | **639 of 639 pass** |
| TypeScript, lint, production build | Pass |

### Mocked browser run

Headless Edge on the production build. Every `/api/v1` request was answered locally, so nothing reached the backend. Files are in `docs/evidence/screenshots/role-menu-permission/`: `granular-*` screenshots, `results-driver-granular.json` and `cdp-driver-granular.cjs.txt`.

| Check | Result |
|---|---|
| My Work | All four rows and their cells as in the table above |
| Null cells | 30 boxes on the DRIVER grid: none ticked, none enabled, no amber |
| Clicking My Work's Add, Edit and Delete | Nothing changed; Save stayed disabled; no unsaved marker |
| A valid change | Save enabled |
| Save | GET, PUT, GET in tenant 1; removed `driver.app.work.respond` and `driver.app.swap.create`; nothing else changed |
| Full page reload | The 14 remaining ticks matched the stored mock state |
| Tenant switch | One GET per tenant with its own header: 14 ticks in tenant 1, 2 in 2419, 1 in 2499 |
| Layout | No page overflow at 1366, 768 or 390 px; the grid scrolls at 768 and below |

The full page reload clears the Safe-Fare Admin's tenant selection, so the tenant has to be chosen again. This already worked this way and wasn't changed.

The older `driver-*` screenshots and `results-driver.json` show the earlier layout, with amber-capable boxes and respond and execute on the main row.

## Existing screen reused

- No new page, route or screen. The feature lives at `/drive-vision/platform/permissions`, in the **Role permissions** tab.
- `role-permission-matrix.tsx` is still the `RolePermissionMatrix` component.
- The **Catalogue** tab (view, create, edit, delete) still works and is still Safe-Fare Admin only.
- Global Roles was not changed or duplicated.

## Final improvements

### 1. Checkbox visibility

**Root cause.** The shared Checkbox has `dark:` colours that follow the operating system's dark mode, although the app has one light theme. On a machine in dark mode, the unchecked box was a translucent fill and the checked box ignored its intended colour. The browser run found this; a unit test on the theme colours could not. It was fixed for this grid only.

| State | Appearance | Contrast measured in the browser |
|---|---|---|
| Checked | Filled brand colour, white tick | Fill on row 4.63:1, tick on fill 4.86:1 |
| Unchecked | White, 2 px dark border | Border on row 4.87:1 |
| Disabled, ticked | Solid grey, white tick | Fill on row 5.11:1, tick on fill 5.11:1 |
| Disabled, unticked | Tinted, dashed border | Border on row 5.11:1 |

- Boxes went from 16 px to 20 px. The click target is 36 px, without changing the layout.
- Disabled boxes stay fully opaque, and rows of an unticked module are no longer faded.
- Hover shows a soft ring. Keyboard focus shows a solid ring with a gap. Tab reaches the boxes and Space toggles them.
- Module, Add, Edit, Delete, View and Actions all use the same component.
- Selection logic did not change. The shared `Checkbox` file was not edited, so other screens are unchanged.

The measurements were identical at 1366, 768 and 390 px wide, in both light and dark OS modes.

### 2. Final access policy

| User | Role Permissions tab | Catalogue tab | Global Roles |
|---|---|---|---|
| Safe-Fare Admin with `role.permission.read` | Yes | Needs `permission.manage` | Needs `role.read` |
| Safe-Fare Admin with only `permission.manage` | No | Yes | No |
| Tenant user with `role.permission.read` | Yes, own tenant only | Never | Never |
| Tenant user without it | Denied | Never | Never |

**Bug fixed:** a tenant user holding `permission.manage` but not `role.permission.read` could open the route and see a page with no tabs. They are now denied. Tenant users now have their own requirement on this screen (`tenantRequires`).

Saving still needs `role.permission.update`, and the Select Role list needs `role.read`. The backend still makes the final decision on every call.

### 3. Shared permission handling

Unticking a box now works out what would be removed before anything changes. If the removal reaches another module, a confirmation appears showing:

- the code being removed and the module where you unticked it;
- every permission that goes with it, and which other modules use each one;
- which modules will close.

Cancel changes nothing. Confirming applies the removal, and every affected module shows the same result. A removal that stays inside one module needs no dialog, so everyday edits aren't interrupted. No duplicate records are created.

**Limitation.** The API has one permission per code, so it can't separate "can open this module" from "can do this operation". `device.read` is one permission in every module that shows it, so nobody can remove it from Fleet Overview alone. A separate module-access permission would need a backend change.

### 4. Sidebar naming

| | Group | Label | Page title |
|---|---|---|---|
| Safe-Fare Admin | Platform | Permission Catalogue | Permission Catalogue |
| Tenant user | Administration | Role Permissions | Role Permissions |

This is display only: the route, screen key and access check are the same. Tenant users no longer see a Platform section. The top-bar section, search results and breadcrumbs use the same names. The URL still contains `/platform/permissions`.

### 5. Old grid cleanup

Removed, after confirming that only tests referred to them:

- `buildPermissionMatrix`, `filterMatrix`, `replaceRequest`, `permissionModule`, `moduleLabel`, `MATRIX_ACTIONS`
- the `replaceRolePermissions` service call and the `rolePermissions.replace` action
- the three Phase 7 tests and one contract row that covered them

Kept, because Global Roles uses them: `RolePermissionEditor`, `groupState`, `desiredSelection`, `setCodes`, `planChanges` and the add and remove calls. A test now checks this. The backend's `PUT /roles/{id}/permissions` is unaffected; only the unused frontend call went.

### 6. Browser Back and Forward

The extra history entry is gone, so after a save one Back press leaves the page.

**Second bug found.** The old guard stopped `popstate` in the capture phase, but the browser run showed this never worked: browsers run window `popstate` listeners in registration order, and the router registers first. It only appeared to work because the extra history entry made the router's response harmless. The guard now registers ahead of the router, in `src/instrumentation-client.ts`, the file Next.js documents as running before hydration. While there are unsaved changes, it undoes the traversal before the router sees it.

| Situation | Result (mocked browser, real history entries) |
|---|---|
| Back or Forward with unsaved changes | Confirmation. The URL and page stay put |
| Cancel | Stays on the same entry, selections kept |
| Discard and leave | Goes to the intended page |
| Unsaved changes made | 0 history entries added |
| After a save | One Back leaves; Forward returns; no dialog |

### 7. Sign-out protection

- With no unsaved changes, sign out works as before.
- With unsaved changes, the dialog shows the required message.
- **Cancel** keeps the session, the page and the edits, and sends no logout request.
- **Continue** runs the existing sign-out once.

Verified at desktop and mobile widths. The Sign out buttons on the access-denied and session-error screens can't appear while the grid is on screen.

### 8. Concurrent edit protection

**What was checked:** the contract, the V10 spec and the live `/v3/api-docs`. `RoleMenuPermissionsDto` has no version or timestamp, the only documented response header is `X-Request-Id`, and PUT takes no `If-Match` or similar. So there is no backend support.

**What was built:**

1. The first edit records the state it started from.
2. Save re-reads the role and compares ticked codes and `otherPermissionCodes`.
3. If they differ, no PUT is sent. The review closes and the required warning appears, with **Reload Latest Permissions**.
4. Edits stay on screen and Save stays blocked until you reload.
5. If the reload fails, the edits and the warning stay.
6. If the check itself fails, nothing is saved and the error is shown.

**This is not full protection.** The read and the write are two separate requests. A change landing between them is still overwritten, because only a backend version check can close that gap. The window is short, but it exists. Each save also makes one extra GET.

### 9. Save and dirty-state consistency

| Requirement | Result |
|---|---|
| One change marks the page as unsaved; changing it back clears that | Pass |
| Role switch with unsaved changes asks first | Pass |
| Tenant switch asks first, on the page and in the top bar | Pass |
| Back, Forward and Sign out ask first | Pass |
| A successful save clears unsaved state and re-reads the role | Pass (GET, PUT, GET) |
| A failed save keeps the edits | Pass (six error codes) |
| No duplicate submission | Pass |

The top-bar tenant switcher used to be locked during unsaved edits. It now asks instead, as you specified.

## Correction: cell-level editability

### What changed

| Rule before | Rule now |
|---|---|
| A code was editable only if all its boxes were | Each cell uses its own `editable` |
| An unticked module disabled its boxes | Only the cell's own `editable`, or a locked screen, disables a box |
| A null cell showed nothing | A null cell shows an empty box |

| `granted` | `editable` | Box |
|---|---|---|
| true | false | Checked, disabled |
| false | false | Unchecked, disabled |
| true | true | Checked, enabled |
| false | true | Unchecked, enabled |
| null or missing cell | | Empty and disabled; no code (changed from enabled by the latest round) |

Actions are evaluated one by one, and no cell reads another cell's flag. A locked screen still disables everything: a read-only role, no `role.permission.update`, or a save in progress.

Shared-code sync, review, tenant isolation and the save flow are unchanged.

### Three behaviours to review

1. **This departs from the contract.** The contract says an unticked module should "untick and disable the other boxes", and that a null cell shows no checkbox. The correction overrides both. Unticking a module still unticks its boxes once, and re-ticking still grants nothing else, but the boxes stay usable.
2. **A permission can be held under a hidden menu.** Ticking Add while the module is unticked is allowed, and the role still won't see that menu. A note says so at the time.
3. **A mixed shared code.** If one box of a code is editable and another isn't, a tick in the editable box also shows in the read-only one, because one code is one permission. The backend decides on save and returns 403 if it refuses. The documented reasons for `editable: false` are all per code, so this should be rare.

### Null cells

> **Superseded.** Null cells are now disabled, with no amber state: see [Driver permission matrix: database mappings](#driver-permission-matrix-database-mappings). The list below is kept as history. The note about the catalogue still applies.

- The user can tick the empty box. The tick turns amber, and a note on the page and in the review says it won't be saved.
- A tick stays apart from the selected codes. It can't reach the review's added or removed lists, the unsaved state or the save body, and on its own it leaves Save disabled.
- Ticks survive a save, because they weren't saved. They go on Reset, or on a role or tenant switch.
- A menu with no resources gets one row of empty boxes.
- **Empty Actions stay blank.** A null cell has a column to sit in, but an empty `actions` list has no named action to show.

**Why the catalogue can't supply a code.** `PUT /menu-permissions` refuses any code that isn't on the grid with `400 INVALID_VALUE`. So even a suitable code from `GET /permissions` can't be saved until the backend adds it to that menu's grid. Nothing is looked up or guessed at runtime.

### My Work investigation

> **Superseded for the grid.** The backend team has since mapped driver codes: see [Driver menu permissions](#driver-menu-permissions). The findings on `driver.*` still stand. The `own.data.read` findings still match the live spec, which hasn't changed.

**Finding at the time: no permission codes exist for My Work Add, Edit, Delete or actions, and none should be borrowed.** This comes from the V10 spec and the live `/v3/api-docs`, which agree here. It was not confirmed with a real login.

| Code | What it actually controls |
|---|---|
| `driver.app` | Menu visibility only. No API operation requires it. New tenants give it to DRIVER by default |
| `own.data.read` | All 22 operations that require it are `/driver/*`, reads and writes alike. It is the role's real gate for My Work |
| `driver.create` | `POST /drivers`: creating a driver record |
| `driver.update` | `PUT /drivers/{id}` and assigning or ending a driver's vehicle |
| `driver.delete` | `DELETE /drivers/{id}`: deleting a driver record |

**`driver.create`, `driver.update` and `driver.delete` must not be reused.** They manage other people's driver records on the admin Drivers screen. Giving them to a driver would grant fleet-wide record management, and they wouldn't control My Work at all, because no `/driver/*` operation checks them.

What My Work's writes need today:

| What a driver does | Operations | Requires |
|---|---|---|
| Start or end a shift | `POST /driver/shifts/start`, `/end` | `own.data.read` |
| Request or cancel leave | `POST /driver/leave-requests`, `/{id}/cancel` | `own.data.read` |
| Submit a checklist | `POST /driver/checklists` | `own.data.read` |
| Accept, decline, start or complete a dispatch | `POST /driver/dispatches/{id}/...` | `own.data.read` |
| Request a swap | `POST /driver/dispatches/{id}/swap-requests` | `own.data.read` |
| Edit own profile | `PATCH /driver/me` | `own.data.read` |

**So these writes can't be separated by role today.** They all share one code, and it can't be a checkbox: the contract lists it in `otherPermissionCodes`, and sending it returns `INVALID_VALUE`.

**Unticking My Work may not remove API access.** It removes `driver.app`, but the operations check `own.data.read`, which the grid keeps. This frontend requires both for the screen, but the API itself would still answer. Worth raising with the backend team.

### Backend mapping dependencies

1. **Confirm the real My Work mapping.** With a real login, read `GET /api/v1/screens` and `GET /api/v1/screens/{menuKey}/operations`. They need `role.permission.read` or `menu.manage`, and they show the backend's own menu-to-code table. These weren't called. The contract doesn't give My Work's `menuKey` or its rows either: its example has none, and "View: driver.app" comes from your description.
2. **Decide the business meaning first.** The team needs to decide what Add, Edit and Delete mean on My Work. The operations above are mostly actions such as accept or start, so they may fit Actions better than the three columns.
3. **Separate control needs new backend work.** That means new permission codes, checks on the `/driver/*` operations and the menu mapping. `PUT /api/v1/menus/{id}/operations` (`menu.manage`) can map a menu's operations, but mapping alone won't enforce anything until the operations check those codes. This frontend will then show the new cells with no change, because the grid is built from the response.
4. **Every other null cell is the same.** The contract defines null as "no such operation", so most of those boxes may never have a code. If a tick there has no intended meaning, the boxes may confuse more than they help.

## Driver menu permissions

**Status: tested on a synthetic response only.**

> **Partly superseded.** The My Work row layout and the null-cell behaviour below have been replaced: see [Driver permission matrix: database mappings](#driver-permission-matrix-database-mappings).

- **The attached response was not available.** It did not arrive with the request and is not on this machine. The fixture `tests/fixtures/driver-role-menu-permissions.json` was rebuilt by hand from the written brief and is marked as synthetic.
- **From the brief:** codes, columns, action labels, the `driver.app` parent flags and `otherPermissionCodes`.
- **Placeholders:** `menuKey`, `menuId`, `sortOrder`, resource labels, and any `granted` value the brief doesn't state.
- **To check against the real response:** replace the fixture's contents with it and rerun `tests/driver-menu-permissions.test.cjs`. The tests look cells up by title and label, so changed resource labels will show as failures to review.

### No grid code was needed

The grid already draws everything from the response, so the new codes appeared with no mapping added to `src`. A test checks that no driver code or menu name is hardcoded. The only `src` change this round was rewording one code comment.

### Mappings verified

| Menu or row | View | Add | Edit | Delete | Actions |
|---|---|---|---|---|---|
| My Work | `driver.app.work.read` | null | null | null | Accept or decline trips: `driver.app.work.respond`; Start and complete trips: `driver.app.work.execute` |
| Trip swap requests | null | `driver.app.swap.create` | null | null | none |
| My Shifts | `driver.app.shift.read` | `driver.app.shift.start` | `driver.app.shift.end` | null | none |
| My Leave | `driver.app.leave.read` | `driver.app.leave.create` | null | null | Cancel leave request: `driver.app.leave.cancel` |
| Shift Checklist | `driver.app.checklist.read` | `driver.app.checklist.submit` | null | null | none |
| My Safety | `driver.app.safety.read` | null | null | null | none |
| My Profile | `driver.app.profile.read` | null | `driver.app.profile.update` | null | none |

Placing swap requests on their own row, and respond and execute under Actions, is how the fixture reads the brief. The real response decides this.

### Behaviour verified

- **Parent:** `driver.app` is checked and disabled in all six menus and can't be changed.
- **Children:** each toggles alone, beside the disabled parent.
- **Save body:** the read-only `driver.app` is included, because a grid code left out is removed from the role.
- **`own.data.read`:** shown as a kept code, with no checkbox, and never sent.
- **Null cells:** 22 empty boxes, none ticked, never in the PUT. A cell the backend fills later renders with no change here.
- **Cancel leave request** stays under Actions, and Delete stays null.

### Cell labels

Cells such as "Add / Start shift" show only under the Add column. The contract gives labels to resources and actions, not to View, Add, Edit or Delete cells, and the live `CellDto` has no label field. If the real response adds one, it needs a small change to display.

### What the live server shows

The spec on `185.193.19.156:9096` has no `driver.app.*` codes, and all 22 `/driver/*` operations still require `own.data.read`. Either the update isn't deployed there, or the codes are enforced in a way the spec doesn't show.

**If the operations still check `own.data.read`, these boxes change the grid but not what a driver can do.** Unticking "Accept or decline trips" would save, and the driver's accept request would still succeed. This needs confirming with the backend team.

### Frontend gap if the codes are enforced

My Work doesn't read the new codes. It opens on `own.data.read` plus `driver.app`, and shows its buttons to every driver. If the backend starts enforcing them, a driver without `driver.app.work.respond` would still see Accept and get an error when using it. Hiding those buttons is separate work on the driver screens, and was not in this request.

### Tests and evidence

| Check | Result |
|---|---|
| Full test suite | **625 of 625 pass** (19 added in `tests/driver-menu-permissions.test.cjs`) |
| TypeScript, lint, production build, contract checks | Pass |
| Mocked browser run (headless Edge, production build) | All 7 rows matched; save and reload, tenant switch and layouts verified |

All 12 requested test areas are covered. The stub server refuses off-grid codes as the contract does, so saving proves `own.data.read` was not sent.

Browser results, all mocked:

| Check | Result |
|---|---|
| Save | GET, PUT, GET; added `driver.app.leave.cancel` and `driver.app.profile.update`, removed `driver.app.work.respond`, nothing else changed |
| Reload | Those three held; parent still disabled; `own.data.read` still listed; null box still empty |
| Tenant switch | Tenant 1 had 20 ticked boxes, tenant 2 had 8, with `X-Tenant-Id: 2` on the request |
| Layout | No page overflow at 1366, 768 or 390 px; the grid scrolls at 768 and below |

Evidence is in `docs/evidence/screenshots/role-menu-permission/`: `driver-*` screenshots, `results-driver.json` and `cdp-driver.cjs.txt`.

## APIs integrated

| Call | Permission | Used for |
|---|---|---|
| `GET /api/v1/roles` | `role.read` | Select Role |
| `GET /api/v1/roles/{roleId}/menu-permissions` | `role.permission.read` | The grid, the pre-save check, reload |
| `PUT /api/v1/roles/{roleId}/menu-permissions` | `role.permission.update` | Save |
| `GET /api/v1/platform/tenants?status=ACTIVE` | `tenant.all` | Select Tenant |
| `POST /api/v1/platform/switch-tenant` | `tenant.all` | Validates the tenant |

The menu-permission calls are declared as off-spec against V10. The OpenAPI files were not changed.

## Tenant handling

- **Safe-Fare Admin:** one tenant selection, shared with the top bar. The API client adds `X-Tenant-Id`. With no tenant, no role or grid request is sent.
- **Tenant users:** no dropdown, no tenant list request and no `X-Tenant-Id`. A stray selection is ignored.
- A response for a different tenant or role is refused and not shown.

## Checkbox and save rules

- One set of ticked codes drives every box, so all boxes for a code agree.
- A `null` cell renders an empty, disabled box with no permission code. A cell's `editable` decides that cell alone.
- Rows, labels and codes come only from the response.
- The save body is every ticked grid code once, including read-only ticked ones. `otherPermissionCodes` are shown but never sent.
- ADMIN is read-only, from the backend's flags. Mocked result: 32 of 32 boxes disabled.

## Files changed

The correction changed `role-menu-permission-model.ts`, `role-permission-matrix.tsx` and `tests/role-menu-permission.test.cjs`.

**Added in the final improvements round**

| File | Purpose |
|---|---|
| `src/instrumentation-client.ts` | Installs the Back and Forward gate before hydration |
| `src/components/drive-vision/shared/history-guard.ts` | Back and Forward logic |

**Changed in the final improvements round**

| File | Change |
|---|---|
| `platform/role-permission-matrix.tsx` | Checkbox style, impact dialog, conflict handling |
| `platform/role-menu-permission-model.ts` | `removalImpact`, `saveIfUnchanged`, `permissionState` |
| `platform/role-permission-model.ts`, `api/role-admin-service.ts` | Old grid removed |
| `platform/permission-catalog.tsx` | Page title by audience |
| `access/access-policy.ts` | `tenantRequires`; unused action removed |
| `shared/use-unsaved-guard.ts`, `store/unsaved-changes.ts` | Guard rewritten, no history entries |
| `app-shell/user-profile-menu.tsx` | Sign-out confirmation |
| `app-shell/tenant-switcher.tsx` | Asks instead of locking |
| `navigation/nav-config.ts`, `navigation/use-nav.ts` | Tenant naming and grouping |
| `app-shell/breadcrumbs.tsx`, `page-intro.tsx`, `topbar.tsx`, `global-search.tsx` | Use the tenant naming |

**Tests changed:** `role-menu-permission`, `phase7-role-permission`, `driver-access`, `v10-contract`.

**From the first round, still in place:** `role-menu-service.ts`, `role-menu-permission-model.ts`, `use-unsaved-guard.ts`, `unsaved-changes.ts`, `tests/role-menu-permission.test.cjs`, and changes to `platform-service.ts` and `types.ts`.

**Existing tests changed in the first round:**

| Test file | Change |
|---|---|
| `phase7-role-permission` | `permissions` is no longer platform-only. Catalogue actions are denied to tenant users through `canManageCatalogue` and `platformOnly` |
| `access-v10`, `final-audit-fixes` | `platformOnly` actions are recognised |
| `phase5-tenant-context` | One more tenant write; `permissions` is tenant-blocked until a tenant is selected |
| `phase4-platform-dashboard` | Off-spec widget operations are allowed |
| `v10-contract` | New off-spec calls are declared |

## Tests executed and results

| Check | Result |
|---|---|
| Full test suite (`node --test tests/*.test.cjs`) | **650 pass, 0 fail, 2 todo** across all features (652 tests) |
| TypeScript (`tsc --noEmit`) | Pass |
| Lint (`eslint .`) | Pass |
| Production build | Pass |
| Contract checks (`v10-contract`, `access-v10`) | Pass |
| Mocked browser run (headless Edge, production build) | All scenarios behaved as expected |

The repository has no component-test library, so React rendering is covered by the browser run. The Back and Forward unit tests use a fake browser that follows Chromium's listener order, so a guard registered after the router fails them.

Existing tests changed in the final improvements round, because behaviour changed on purpose:

| Test file | Change |
|---|---|
| `phase7-role-permission` | Old grid tests removed; a test added that the grid is gone and Global Roles' parts remain |
| `driver-access` | A tenant ADMIN has no Platform group; the item is under Administration |
| `v10-contract` | Row for the removed service call removed |
| `role-menu-permission` | Saves go through the conflict check; the switcher prompts |

## Browser verification evidence

All mocked, in `docs/evidence/screenshots/role-menu-permission/`, with `results.json` and the script `cdp-role-menu.cjs.txt`.

| Area | Screenshots |
|---|---|
| Layouts at 320 to 1920 px | `grid-*` |
| Checkbox visibility | `checkboxes-light-*`, `checkboxes-dark-*` (1366, 768 and 390 px) |
| Shared impact | `impact-1366x768` |
| Back guard | `back-guard-1366x768` |
| Sign out | `sign-out-1366x768`, `sign-out-390x844` |
| Conflict | `conflict-1366x768` |
| Tenant switching | `tenant-guard-1366x768` |
| Tenant user | `tenant-user-1366x768`, `tenant-user-390x844` |
| Save states | `review-*`, `save-failed-*`, `saved-*` |

Layout: no page overflow at any width. The grid scrolls horizontally at 768 px and below.

**Cell-level correction, mocked, on the production build:** `results-cell-level.json`, the script `cdp-cell-level.cjs.txt`, and `cell-level-*` screenshots at 1366, 768 and 390 px.

| Check | Result |
|---|---|
| Non-editable View and module box | Those two disabled; Add, Edit and Export enabled; Delete and Share disabled by their own flags |
| Clicks on editable and read-only boxes | Add and Export ticked; View and Delete unchanged |
| My Work with module unticked | View, Add, Edit and Delete all enabled and unticked; no Actions box |
| Pending ticks (since removed) | Shown amber, with the note on the page and in the review |
| Save | GET, PUT, GET; the body held only real grid codes |
| Pending only | Save stays disabled and nothing counts as unsaved |
| ADMIN | Every box disabled, none ticked by the screen |

The full earlier browser script was not rerun after this correction, so the older `grid-*`, `module-off-*` and `checkboxes-*` screenshots show the previous rules. In this round, only the focused check and the 606 tests ran on the final code.

## Remaining backend dependencies

1. **Driver codes.** Do the [live API comparison](#live-api-comparison-not-done), and confirm whether `/driver/*` enforces the new codes. See [What the live server shows](#what-the-live-server-shows).
2. **My Work CRUD codes.** See [Backend changes required](#backend-changes-required).
3. **Other null cells.** See [Backend mapping dependencies](#backend-mapping-dependencies).
4. **Live verification is still needed.** The live spec now lists `/api/v1/roles/{id}/menu-permissions`, and its schema matches the contract. That corrects the earlier report, which said it appeared undeployed. `status` is also now a documented parameter on the tenant list. No real call has been made.
5. **Atomic conflict protection** needs a version field or `If-Match` support on the PUT.
6. **Separating module access from operations** needs a backend model change.

## Remaining limitations

- **Browser support.** Back and Forward use the Navigation API. Without it, the guard still holds Back, confirmed in the browser run with the API removed, but treats any traversal as one step Back, so Forward or a multi-step jump lands wrongly. Only Edge was tested.
- **Leaving the app.** Back to a page outside the app, reload and closing the tab show the browser's own prompt, whose text can't be changed.
- **Session expiry.** If a session ends on its own, unsaved edits are lost without a prompt.
- **Other screens.** The shared Checkbox's `dark:` colours still apply wherever else it is used. Those screens were out of scope, but they probably have the same visibility problem in OS dark mode.

## Before release

Run these with real accounts, on an approved test tenant:

1. Sign in as Safe-Fare Admin. Confirm the tenant list and the grid for a non-ADMIN role, including DRIVER in tenants 1, 2419 and 2499.
2. Save a small change, confirm the re-read, then revert it.
3. Confirm `otherPermissionCodes` are unchanged after saving.
4. Confirm ADMIN is read-only and that a direct save returns `PROTECTED_ROLE`.
5. Sign in as a tenant user. Confirm there is no tenant header and that a box for a code they don't hold is disabled.
6. Open the same role in two sessions, save in one, and confirm the other shows the conflict warning.
7. Confirm the role's user receives the new menus after a token refresh.

No next phase was started. Nothing was committed, pushed or reset. Backend code and OpenAPI files were not changed.
