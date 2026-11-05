# Driver Permission Integration Report

**Status:** fixed and tested on mocked data. Not yet verified with a real login. Nothing is committed.

**Date:** 2026-11-05

## Evidence levels

| Level | What it means here |
|---|---|
| **Mocked** | Every `/api/v1` response was synthetic. All test and browser results in this report are mocked. |
| **Written brief** | Your summary of the `/me` and `/me/permissions` responses. **The JSON did not arrive with the request and is not on this machine.** |
| **Live spec** | The public `/v3/api-docs`, read without a login. It shows what the backend documents, not how it behaves. |
| **Live calls** | **None with a login.** No live trip, shift, leave, cancellation or checklist change was made. |

`tests/fixtures/driver-me-permissions.json` is built by hand from the brief and says so in its `_source` field. Its ids, role, menu keys, routes, codes, `allowed` values and `readOnly` on `my_safety` come from the brief. Every other `readOnly` value, the operation type names and labels are placeholders. `own.data.read` in `permissions` is inferred, because the screens open today and require it.

## Root cause

**One `readOnly` flag on My Safety disabled every driver button.**

1. All six driver routes map to one app screen, `myWork`.
2. `computeAccess` recorded `readOnly` per app screen.
3. `my_safety` correctly returns `readOnly: true`, so all of `myWork` became read-only.
4. That removed `driver.selfService`, the single action every driver button depended on.

So the permissions were never the problem. The pages still opened, because `readOnly` removes actions rather than screens.

**Proof:** with the old line restored temporarily, exactly the root-cause test failed. It passed again once the fix was back.

## What changed

| Area | Change |
|---|---|
| `access/identity.ts` | Added `isScreenOperationAllowed(identity, menuKey, permissionCode)`, on the existing identity. No new store |
| `access/access-policy.ts` | An app screen is read-only only when all its sections are. Added `DRIVER_OPERATIONS` and `canDriver`. Removed `driver.selfService` |
| `operations/my-work-model.ts` | Added `driverControl`, `leaveCancelBlock`, `TRIP_OPERATIONS` and `SECTION_READ` |
| `operations/my-work-page.tsx` | Each button uses its own operation. Reasons appear on the page. Each section opens on its own read operation |
| `api/client.ts`, `store/auth-store.ts` | A token refresh now re-reads `/me/permissions` |

## Structure consumed

From `GET /api/v1/me/permissions`: `data.userId`, `tenantId`, `roleId`, `roleCode`, `permissions`, and `screens[]` with `menuKey`, `title`, `routePath`, `readOnly` and `operations[]`. Each operation gives `operation`, `permissionCode` and `allowed`. Only an explicit `allowed: true` counts.

`isScreenOperationAllowed` returns false when the identity hasn't loaded, or the screen or operation is missing. It doesn't consult `readOnly`.

## Button mappings

The rule for every button: enabled when `allowed === true`, the record's state permits it, and nothing is in progress.

| Screen (`menuKey`) | Button | Operation |
|---|---|---|
| My Work (`my_work`) | Accept, Decline | `driver.app.work.respond` |
| | Start trip, Complete trip | `driver.app.work.execute` |
| | Request swap | `driver.app.swap.create` |
| My Shifts (`my_shifts`) | Start shift | `driver.app.shift.start` |
| | End shift | `driver.app.shift.end` |
| My Leave (`my_leave`) | Request leave | `driver.app.leave.create` |
| | Cancel request | `driver.app.leave.cancel` |
| Shift Checklist (`shift_checklist`) | Start checklist | `driver.app.checklist.submit` |
| My Profile (`my_profile`) | Edit contact details | `driver.app.profile.update` |

Each section also needs its read operation: `driver.app.work.read`, `.shift.read`, `.leave.read`, `.checklist.read`, `.safety.read`, `.profile.read`. My Safety has no write control. Driver Notifications were not changed.

## Disabled conditions: before and after

| Button | Before | After |
|---|---|---|
| Accept, Decline, Start, Complete, Swap | `noProfile`, which included `driver.selfService` | Own operation, profile loaded, nothing in progress. Trip rules unchanged |
| Start shift, End shift | Same | Own operation, same checks. Only one is shown, from the current shift |
| Request leave | Same | Own operation, same checks |
| Cancel request | Same, shown when `decidedAt` was empty | Own operation, shown only for an undecided PENDING request |
| Start checklist | Same, plus no template items | Own operation, plus a loaded template with items |
| Edit contact details | Hidden without `driver.selfService` | Shown once the profile loads; disabled without its operation |

**Two further fixes:**

- **Cancel request.** It could appear on a CANCELLED request that had no `decidedAt`. It now also uses the spec's `status` values: PENDING, APPROVED, REJECTED and CANCELLED.
- **Reasons were invisible.** They were in `title`, but disabled buttons have `pointer-events-none`, so the tooltip could never show. Reasons now appear as text beside the button.

**Validation kept:** Request leave opens its form, and the form validates on submit. The checklist needs every item answered, shows critical failures, and blocks a second submission. Every state change still asks for confirmation and re-reads afterwards.

## Results by screen

Mocked, on the production build, with `readOnly: true` on My Safety.

| Screen | All allowed | Writes denied | Reads denied |
|---|---|---|---|
| My Work | All offered buttons enabled | All disabled, reason shown | "You can't view this section" |
| My Shifts | Start shift enabled; End shift after starting | Disabled, reason shown | Same message |
| My Leave | Request leave and Cancel enabled | Both disabled, reason shown | Same message |
| Shift Checklist | Start checklist enabled | Disabled, reason shown | Same message |
| My Safety | Data shown; no write controls | Same | Same message |
| My Profile | Edit enabled | Disabled, reason shown | Same message |

No page overflow on any of the six screens at 1366, 768 or 390 px.

**Write flows, in the mock only:** Accept, Start shift, End shift and Cancel request each confirmed, sent one POST, and updated the screen. The Request leave, Start checklist and Edit contact details panels opened; those three weren't submitted in the browser.

## Every reason a button can be disabled

| Type | Text shown | Seen in the browser run |
|---|---|---|
| Permission denied | "Your role doesn't allow this action" | Yes |
| Required data missing | "Your driver profile couldn't be loaded" | Yes |
| Required data missing | "The checklist couldn't be loaded" | Not run |
| Status | "The server returned no checklist items" | Yes |
| Loading | "Loading your driver profile", "Loading the checklist" | Not captured |
| Processing | "Another action is in progress" | Covered by unit tests |

Actions a trip's record rules out aren't shown as disabled. They are left out, with the reason as text: "This trip has already started", "This trip is completed", "A swap request for this trip is already pending". Leave statuses other than undecided PENDING show no Cancel button, and the row shows the status.

## Authentication and refresh

- Permissions load after login and clear on sign-out.
- **New:** a token refresh in the same tab re-reads `/me/permissions`.
- If that re-read fails, the identity is dropped rather than kept stale, so the user sees the existing retry screen. A brief network failure at that moment can interrupt the session.
- Tenant users always work from their identity, and a stray tenant selection is cleared.
- No token is logged or exposed. User 469 and tenant 1 appear only in the test fixture.

## Backend enforcement

**Not verified, and the spec suggests the granular codes aren't enforced.** No direct request was tried. Frontend checks are not security.

The public spec on 2026-11-05 documents `own.data.read` as the required permission for all of these:

| Button | Operation | Spec requires |
|---|---|---|
| Accept, Decline | `POST /driver/dispatches/{id}/accept`, `/decline` | `own.data.read` |
| Start, Complete | `POST /driver/dispatches/{id}/start`, `/complete` | `own.data.read` |
| Swap | `POST /driver/dispatches/{id}/swap-requests` | `own.data.read` |
| Start, End shift | `POST /driver/shifts/start`, `/end` | `own.data.read` |
| Request, Cancel leave | `POST /driver/leave-requests`, `/{id}/cancel` | `own.data.read` |
| Submit checklist | `POST /driver/checklists` | `own.data.read` |
| Edit profile | `PATCH /driver/me` | `own.data.read` |

The spec also lists no `driver.app.*` granular code, so it may be out of date. **If it is accurate, a driver denied by the screen can still call these APIs directly.**

**Backend change needed:** check each operation's granular code and return 403 without it, then update the spec. Not changed here.

## Work CRUD gap

The user holds `driver.app.work.create`, `.update` and `.delete`, but `my_work` exposes no matching operations. They enable nothing, and a test checks this. No Create, Edit or Delete button was added, because no such workflow or API exists. See "My Work CRUD codes" in `docs/role-menu-permission-integration-report.md`.

## Tests and build

| Check | Result |
|---|---|
| Full test suite | **755 tests: 753 pass, 0 fail, 2 todo** |
| TypeScript, lint, production build | Pass |
| Contract checks (`v10-contract`, `access-v10`) | 102 of 102 pass |
| New `tests/driver-permissions.test.cjs` | 103 pass |
| Mocked browser run (headless Edge) | Pass; 6 screens at 3 widths |

The 2 `todo` tests are from the previous round: the driver UI respecting the CRUD codes, and the backend rejecting unauthorized requests.

Each of the 15 operations is tested five ways: allowed, denied, missing data, ineligible state, and processing. Specific regression tests cover My Leave, Shift Checklist and My Work. The token-refresh tests run the real client and auth store.

**Limits of the tests.** The repository has no component-test library, so button wiring is covered by source checks and the browser run. The processing state was checked only in unit tests.

**Existing tests changed:** `access-v10`, `final-audit-fixes` and `phase3-5-validation` listed `driver.selfService`. `driver-menu-permissions` banned all `driver.app.work` codes from the access policy; it now bans only the three CRUD codes.

**Evidence:** `docs/evidence/screenshots/driver-permission-integration/`, with `results.json`, the script `cdp-driver-permissions.cjs.txt`, and screenshots at all three widths.

## To review

1. **Tenants without these operations lose the driver sections.** With `operations` missing, the mocked run showed "You can't view this section" on all six. This follows your fail-closed rule, but any tenant not yet given the operations would be locked out until it is. Check tenants 2419 and 2499 before release.
2. **`readOnly` on a section with allowed writes.** Writes follow `allowed`, as you specified. The contract says `readOnly` means only View is allowed. If the backend ever sends `readOnly: true` with `allowed: true`, the buttons stay enabled.
3. **Complete trip on a trip that hasn't started.** It is offered, as before. The trip rules leave this to the server, because trip status rules aren't documented.
4. **APPROVED leave.** Cancel isn't offered, as before. If the backend allows cancelling approved leave, this rule needs widening.
5. **`own.data.read` still opens the driver app.** The app requires it and `driver.app`. If the backend retires it, this needs changing or drivers lose the app.

## Remaining limitations

- The real `/me/permissions` response hasn't been compared. Replace the fixture and rerun `tests/driver-permissions.test.cjs`.
- A token refresh adopted from another tab doesn't re-read permissions until that tab refreshes or reloads.
- Backend enforcement is unverified.

## Before release

Run these with an approved test driver and designated test records:

1. Sign in as a driver. Confirm each screen's buttons match this report.
2. Change one permission in Role Permissions, refresh the driver's token, and confirm that button changes.
3. Sign in as a driver in tenants 2419 and 2499.
4. With a permission removed, call its API directly and confirm a 403.

No next phase was started. Nothing was committed, pushed, reset or discarded. Backend code was not changed.
