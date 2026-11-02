# Phase 8 — Driver Management & Driver–Device Assignments

Date: 2026-11-02 · Branch `new-features/Prakash` @ `eccc41e` (no commits, resets or pushes; backend and OpenAPI untouched; Phase 9 not started). Starting `git status`: 75 entries, all preserved.

## Verification levels

| Level | Meaning |
|---|---|
| **Code** | Written against the V10 schemas, typechecked |
| **Automated** | Unit / contract tests (stub fetch, synthetic data), mutation-checked |
| **Mocked browser** | Production build, headless Edge; every `/api/v1/*` call answered locally with **synthetic** data; nothing reached the BFF |
| **Live backend** | **Nothing.** No driver was created, edited or deleted, and no assignment made or ended, against the real BFF. |

---

## 1. Initial audit

- **A Drivers screen already existed** (`drivers/drivers-page.tsx`, built before the V10 phases and gated by Phases 3 and 5):
  - list with server paging, keyword and status filters; licence-expiry view;
  - detail drawer (profile, 30-day safety score and events, assignment history);
  - create / edit (full `DriverRequest` form with validation and server field errors), delete;
  - assign a vehicle (`deviceId`, `from`, `replaceCurrent`), end an assignment.
- **The vehicle detail page** already showed the vehicle's current driver (`GET /devices/{id}/summary`) and its assignment history (`GET /devices/{id}/driver-assignments`).
- **Gaps found:**
  1. The list lacked ID, email and assignment-status columns, and had no tenant column for the Safe-Fare Admin's all-tenants view.
  2. The assign dialog didn't offer `to`, didn't show a review (driver, vehicle, dates, replacement), didn't show the vehicle's current driver, and didn't require acknowledgement when replacing an active assignment.
  3. Ending an assignment was always "now" (`EndAssignmentRequest.at` not offered).
  4. Secondary reads were sent without their own V10 codes, giving a 403 after a request: safety score and events (`alarm.read`), the vehicle picker (`device.read`), the vehicle-detail assignment history (`driver.read` on a `device.read` screen).
  5. Historical alarm attribution wasn't addressed anywhere.
- **Alarm–driver displays in live code:** only the server's `AlertRow.driverName` (Alerts, platform dashboard). `dashboard/activity-feed.tsx`, which matched alarms to drivers from sample data, is **not imported anywhere** (legacy mock layer). No live code labels an alarm with a vehicle's *current* driver.

## 2. Driver API inventory (V10)

| Method + path | Purpose | Params | Body | Response | Permission | Status |
|---|---|---|---|---|---|---|
| GET `/drivers` | List | `keyword`, `status`, `pageNumber`, `pageSize` | — | `DriverDto[]` + `total`; description: rows also carry `tenantId`, `tenantName` | `driver.read` | Used |
| GET `/drivers/{id}` | Detail | id | — | `DriverDto` | `driver.read` | Used |
| POST `/drivers` | Create | — | `DriverRequest` (name* ≤150, userId, licenceNo ≤60, licenceClass ≤30, licenceIssuedOn / ExpiresOn date, icCardNo ≤60, phone ≤30, email ≤320, gender M\|F\|U, address ≤500, dateOfBirth, emergencyContactName / Phone, hiredOn, remark ≤500, status ACTIVE\|INACTIVE) | `DriverDto` | `driver.create` | Used |
| PUT `/drivers/{id}` | Update | id | `DriverRequest` | `DriverDto` | `driver.update` | Used |
| DELETE `/drivers/{id}` | Delete | id | — | Void | `driver.delete` | Used |
| GET `/drivers/licence-expiries` | Expiring licences | `withinDays` | — | `DriverDto[]` (+ tenant columns) | `driver.read` | Used |
| GET `/drivers/{id}/safety-score` | Score | `from`, `to` | — | `DriverScoreDto` | `alarm.read` | Used (now gated) |
| GET `/drivers/{id}/safety-events` | Server-attributed events | `from`, `to`, paging | — | `AlertRow[]` | `alarm.read` | Used (now gated) |
| GET `/drivers/availability` | Workforce availability | `date` | — | `AvailabilityOverviewDto` | `workforce.read` | Used by Workforce (unchanged) |
| GET `/safety/scores/drivers` | Ranking | window, paging | — | `ScoreDto[]` | `alarm.read` | Used by Safety (unchanged) |

`DriverDto` fields: `id, userId, name, status (ACTIVE|INACTIVE), phone, email, gender, address, dateOfBirth, emergencyContactName, emergencyContactPhone, hiredOn, icCardNo, remark, licence (LicenceDto), currentAssignment (AssignmentDto), createdAt, updatedAt`.

## 3. Assignment API inventory (V10)

All four candidates from the brief exist.

| Method + path | Body / response | Permission | Status |
|---|---|---|---|
| GET `/drivers/{id}/assignments` | → `AssignmentDto[]` | `driver.read` | Used (driver drawer history) |
| POST `/drivers/{id}/assignments` | `AssignRequest {deviceId*, from?, to?, replaceCurrent?}` → `AssignmentDto` | `driver.update` | Used (now sends `to`) |
| POST `/drivers/{id}/assignments/{assignmentId}/end` | `EndAssignmentRequest {at?}` → `AssignmentDto` | `driver.update` | Used (now sends `at`) |
| GET `/devices/{id}/driver-assignments` | → `AssignmentDto[]` | `driver.read` | Used (vehicle detail; assign dialog) |

`AssignmentDto`: `id, deviceId, deviceName, terminalNo, driverId, driverName, assignedFrom, assignedTo, source, active`.

V10 **does not document** whether a driver may hold several vehicles or a vehicle several drivers, what `replaceCurrent` ends exactly, or what `source` values mean. The UI therefore prevents nothing on its own: it shows conflicts, requires acknowledgement to replace, and lets the server decide.

## 4. APIs integrated in Phase 8

No new endpoints; all were already integrated. Phase 8 changed how they're used:
- **POST `/drivers/{id}/assignments`:** adds `to`, with pre-submit review and acknowledgement.
- **POST `…/end`:** adds `at`.
- **GET `/devices/{id}/driver-assignments`:** now also used inside the assign dialog for the chosen vehicle.
- **GET `/drivers` / `/drivers/licence-expiries`:** the documented tenant columns are typed (`DriverRow`) and shown.
- **Safety score/events, `GET /devices` and device assignments:** requested only when the identity holds their code.

Mapping totals unchanged (138 / 0 / 67 / 15); six rows annotated.

## 5. APIs missing from V10

| Need | Status |
|---|---|
| Historical driver resolution for an alarm (alarm time → device → assignment valid then → driver), or documented semantics for `AlertRow.driverId` / `driverName` | **Missing / undocumented** (§9) |
| Driver fields on `AlarmDto` (`/alarms/ai`, `/alarms/routine`) | Not present (no driver on those rows) |
| Assignment rules: one-to-one vs many, overlap policy, `replaceCurrent` semantics, `source` values | Undocumented |
| Which fields `GET /drivers?keyword=` searches | Undocumented (the UI says "Search drivers"; the server decides) |
| `tenantId` / `tenantName` in the `DriverDto` schema | Only in the operation description ("Tenant columns"), not the schema |

## 6. Exact request and response fields used

- **List:** `keyword`, `status`, `pageNumber`, `pageSize` → `id, name, licence.number / status / expiresOn / daysToExpiry, currentAssignment (deviceName, terminalNo, deviceId, active), phone, email, status`, plus `tenantName` / `tenantId` (all-tenants mode only).
- **Create / edit:** the full `DriverRequest`; blank optional fields are omitted; server `fieldErrors` are mapped to fields.
- **Assign:** `{deviceId, replaceCurrent, from?, to?}`. `from` / `to` are IST inputs converted to ISO; blank means not sent.
- **End:** `{at?}` (blank = `{}`).
- **Assignment display:** `assignedFrom`, `assignedTo` (or "open"), `source`, `active`, `deviceName` / `terminalNo`, `driverName`.

## 7. Permissions per screen and action

| Item | V10 code | Notes |
|---|---|---|
| Drivers screen, detail, assignment history, licence expiries | `driver.read` | screen gate |
| New driver | `driver.create` | tenant write, class A |
| Edit, assign vehicle, end assignment | `driver.update` | tenant write, class B |
| Delete driver | `driver.delete` | tenant write, class C |
| Safety score / events in the drawer | `alarm.read` | widget `drivers.safety` |
| Vehicle picker in the assign dialog | `device.read` | widget `drivers.deviceChoices` |
| A vehicle's driver assignments (vehicle detail, assign dialog) | `driver.read` | widget `vehicles.driverAssignments` |

All checks go through the central resolver; no role names are used.

| Identity (tests) | Screen | Create | Update / assign / end | Delete |
|---|---|---|---|---|
| Safe-Fare Admin, tenant selected | ✓ | ✓ | ✓ | ✓ |
| Safe-Fare Admin, all tenants | ✓ (read; tenant column) | disabled — "select a tenant" | hidden + notice | hidden |
| Tenant ADMIN | ✓ | ✓ | ✓ | ✓ |
| Fleet Owner (synthetic codes) | ✓ | ✓ | ✓ | ✗ |
| Operator (synthetic; no `driver.read`) | ✗ | ✗ | ✗ | ✗ |
| Dispatcher (synthetic) | ✓ (view; no safety data) | ✗ | ✗ | ✗ |
| Viewer (synthetic) | ✓ (view) | ✗ | ✗ | ✗ |
| Driver | ✗ | ✗ | ✗ | ✗ |

Unauthenticated users are redirected to login. **In the browser, Operator and Driver generated 0 driver or assignment requests, and the Dispatcher 0 safety requests.**

## 8. Tenant isolation

Phase 5 is unchanged and reused:
- **Header rules:** tenant-scoped requests carry `X-Tenant-Id` only when the Safe-Fare Admin has selected a tenant. They never carry `?tenantId`; tenant users never send a header.
- **Cache:** keys are scoped by tenant, and page content remounts on a switch. In the browser, Acme → Blue showed 20 Blue rows and no Acme rows.
- **All-tenants mode:** rows of every tenant come with the documented tenant columns, now shown in a "Tenant" column. Writes stay blocked until a tenant is selected (create disabled with the reason; record actions hidden; notice shown).
- **Finding, not implemented:** V10's description says the Safe-Fare Admin may send a row's `tenantId` to operate on that row's tenant. That would allow record operations (classes B/C) in all-tenants mode, using the row's own tenant. It requires a per-request tenant override in the client, which changes the Phase 5 architecture, so it's documented as a follow-up.
- **Phase 5 report correction:** "only the dispatch `Row` carries a `tenantId`" is true for the **schemas**. 40 list operations' descriptions say their rows also carry `tenantId` / `tenantName`.

## 9. Historical alarm → driver attribution

**What V10 offers:**
- `AlertRow.driverId` / `driverName` on alert rows, `GET /drivers/{id}/safety-events` (alerts the server attributes to a driver), and assignment history with `assignedFrom` / `assignedTo`.
- V10 does **not** state whether `AlertRow.driverId` is resolved at the alarm's time or is the vehicle's current driver.
- The raw alarm lists (`AlarmDto`) carry no driver at all.

**What the frontend does:**
- It never attaches a driver to an alarm itself.
- Alerts show "Driver (server)", with a tooltip saying the app never derives it from the vehicle's current assignment.
- The driver drawer labels its events as attributed by the server.
- It never uses `currentAssignment`, the vehicle's current driver or assignment history to label an alarm (static tests).

**The rule, as a tested reference:** `assignmentAt(assignments, deviceId, time)` returns the single assignment with `assignedFrom ≤ time < assignedTo` (an open end counts as ongoing), and **null** when none or more than one match. Tests cover the brief's example:
- A on device 101 from 08:00 to 12:00, B from 12:00.
- An alarm at 10:30 → A; at 12:00 → B (half-open intervals).
- Before 08:00 → none; after A ended (no B in the data) → none.
- A later assignment never changes a past attribution; overlapping data → null.

It is **not wired to the UI**, because the backend's own semantics are unconfirmed. Wiring it would mean the frontend inventing attribution that may contradict the server.

**Backend dependency:** confirm that `AlertRow.driverId` / `driverName` are resolved at alarm time. If not, provide that resolution (or documented semantics) server-side.

## 10. Files

**Created:**
- `tests/phase8-driver-management.test.cjs`
- `docs/phase8-driver-management-report.md`
- `docs/evidence/screenshots/phase8/` (25 screenshots, `results.json`, `cdp-phase8.cjs.txt`)

**Modified:**
- `drivers/drivers-model.ts`: `to`; `EMPTY_ASSIGN_FORM`; `activeAssignments`, `reviewAssignment`, `validateEndAt`, `endRequestBody`, `assignmentAt`.
- `drivers/drivers-page.tsx`:
  - list: ID, email, assignment and tenant columns; search placeholder;
  - assign dialog: `to`, vehicle current-driver check, review, replacement acknowledgement;
  - end dialog: optional time;
  - widget-gated safety section and vehicle picker; server-attribution note.
- `vehicles/vehicle-operations.tsx`: device assignment history gated by `driver.read`.
- `alerts/incidents.tsx`: "Driver (server)" label and tooltip.
- `shared/confirm-dialog.tsx`: no overflow at 320 px, using an explicit `minmax(0,1fr)` column. Tall dialogs scroll instead of being cut off (`my-auto`), and the decorative icon is hidden below 400 px. It's a shared component; wider layouts are unchanged.
- `access/access-policy.ts`: widgets `drivers.safety`, `drivers.deviceChoices`, `vehicles.driverAssignments`.
- `api/types-operations.ts`: `TenantColumns`, `DriverRow` (`DriverDto` unchanged).
- `api/operations-service.ts`: list operations typed `DriverRow`.
- `tests/helpers/v10-contract.cjs`: `documentedResponseFields`. It allows exactly `data[].tenantId` / `data[].tenantName`, only on operations whose description has the "Tenant columns" note.
- **Docs:** `implementation-status.md`, `v10-api-frontend-mapping.md` (row notes), `current-architecture.md`, `v10-permission-matrix.md`.

## 11. Tests

| Check | Result |
|---|---|
| `npm test` | **422 / 422** (408 + 14 Phase 8) |
| V10 contract | 0 errors |

**Phase 8 tests:**
- **Assignment model:** form validation (`to` after `from`, or in the future); exact request body; review (driver and vehicle conflicts, duplicate pair, replacement acknowledgement, server `active` flag only); end-time validation and body.
- **Attribution:** the four required cases plus ambiguity and missing data; static no-fabrication checks.
- **Authorization:** 8 identity variants (screen, three actions, routes, unauthenticated); widget gates wired into queries.
- **Contract:** new widgets mirror V10 codes; the tenant-column allowance is limited to documenting operations, and `DriverDto` stays schema-exact.
- **Service:** exact paths, queries and bodies; tenant header only with a selection, never `?tenantId`; 409 surfaces the server `msg`, and success follows the awaited call.

**Contract checker fix in this phase:** the first attempt added tenant columns to the shared `DriverDto`. The checker correctly rejected that, because it leaked the fields into operations without the note (`/driver/me`, `POST /drivers`, …). It was replaced by `DriverRow` plus the narrowly scoped documented-fields rule.

**Mutation check** (each run from a backup, then restored; final state all caught):

| Mutation | Failing |
|---|---|
| Assignment end inclusive (`t ≤ to`) | 1 |
| Ambiguous match picks the first | 1 |
| Attribution ignores the device | 3 |
| Replacement without acknowledgement | 1 |
| Active inferred from a missing flag | 1 |
| End-before-start accepted | 1 |
| Safety score requested without `alarm.read` | **0 at first** → test tightened (both queries asserted) → 1 |
| Safety events requested without `alarm.read` | 1 |
| Wrong code for device assignments | 2 |
| Tenant columns allowed everywhere | 1 |

**Incident during the mutation run, now resolved:** one shell command failed partway and left `drivers-page.tsx` with both safety queries ungated, with no backup to restore from. I restored the two lines by hand: the loop only ever replaced those exact strings. The fix was verified by re-running the mutation pair with a hash-checked restore, and the full suite and browser run afterwards passed on the restored file.

## 12. Typecheck, lint, build

`npm run typecheck` pass · `npm run lint --max-warnings=0` pass · `npm run build` pass, **33 routes** (no new route).

## 13. Mocked browser results (`docs/evidence/screenshots/phase8/`)

**Functional (1366×768, synthetic data):**
- **All tenants:** columns ID, Driver, Licence, Assignment, Phone, Email, **Tenant**, Status. Notice shown; "New driver" disabled; drawer offers no write actions; **0** tenant headers.
- **Acme selected:** no Tenant column; 20 Acme rows, no stale rows; `X-Tenant-Id: 1`.
- **List controls:** search → `?keyword=Driver+0`; status → `?status=INACTIVE` (only INACTIVE rows); paging → `?pageNumber=2`.
- **Detail:** profile, safety (score 82, events with the attribution note), history (active + ended).
- **Assign to a busy vehicle:**
  - The review listed *Acme Driver 01 → KA-01-1001* and *Acme Driver 07 → KA-02-1002*, with the "expected to refuse" warning.
  - With "Replace" ticked, the button stayed disabled until acknowledged.
  - The POST sent `{"deviceId":102,"replaceCurrent":true}`, then re-read `/drivers/1`, `/drivers/1/assignments` and `/drivers`. History showed the old assignment closed and the new one active.
- **Refused assignment (mocked 409):** dialog stayed open with the server message; 1 POST; no success toast.
- **End assignment:** an end time before the start disabled "End assignment" with the message; blank sent `{}`.
- **Create driver:** an empty name showed "Name is required." with 0 POSTs; a mocked 400 field error showed on the email field; the retry posted `{name, status, email}` with `X-Tenant-Id: 1`.
- **States:** a 503 showed the error panel with `msg`, code and request id; "Try again" then the empty state "No drivers".
- **Roles:** Dispatcher saw no "New driver" or drawer actions, "Needs alarm.read" in place of safety data, and **0** safety requests. Operator and Driver saw "You don't have access to this page", no nav link and **0** driver requests.

| Viewport | List | Drawer | Assign dialog |
|---|---|---|---|
| 320×568 | ✓ | ✓ | ✓ (after fix) |
| 390×844 | ✓ | ✓ | ✓ |
| 768×1024 | ✓ | ✓ | ✓ |
| 1024×768 | ✓ | ✓ | ✓ |
| 1366×768 | ✓ | ✓ | ✓ |
| 1920×1080 | ✓ | ✓ | ✓ |

- **Fixed during this phase:** at 320 px the assign form overflowed the dialog panel. The cause was the shared `ConfirmDialog`'s implicit grid column plus Chromium's minimum width for date-time inputs.
- **Remaining:** the 16 px "Replace" checkbox sits inside its `<label>`, so the label text is the tap target. The screenshots predate one change, the search placeholder shortened from "Search drivers (server keyword)" to "Search drivers".

## 14. Backend dependencies and questions

1. **Historical attribution:** are `AlertRow.driverId` / `driverName` resolved at the alarm's timestamp (the assignment valid then)? If not, can the backend provide it? Should `AlarmDto` carry a driver?
2. **Assignment rules:** can a driver hold several vehicles, or a vehicle several drivers, at once? Are overlapping intervals allowed? What exactly does `replaceCurrent` end (the driver's assignment, the vehicle's, or both)? What are the `source` values?
3. **Search:** which fields does `GET /drivers?keyword=` search?
4. **Tenant columns:** add `tenantId` / `tenantName` to the list-row schemas. Confirm the "send the row's `tenantId`" rule for record operations, which would enable all-tenants record actions.
5. **Delete semantics:** what happens to a deleted driver's assignments and history?
6. **Carried over:** test accounts, a safe test tenant for writes, **HTTPS**.

## 15. Known limitations

- Historical alarm → driver attribution is a backend dependency; the frontend shows only the server's value.
- Assignment conflicts are shown, not prevented; the server is the authority.
- The Safe-Fare Admin can't act on driver records in all-tenants mode (it must select a tenant), even though V10 hints at row-tenant operations (§8).
- Secondary panels show "Needs <code>" when the identity lacks the code, by design.
- The `ConfirmDialog` layout change is shared. It was verified on the driver dialogs at all viewports; other dialogs only change below 400 px (icon hidden) or when taller than the screen (now scrollable).

**Phase 8 is complete for everything verifiable without backend access.** Phase 9 has not been started and is waiting for review and explicit approval.
