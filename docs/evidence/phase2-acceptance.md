# Phase 2 — Acceptance matrix and browser evidence

Run 2026-10-27, `next dev` on http://localhost:3000, Chrome tab 79646198, signed in by the user as Sconex Admin (`PLATFORM_ADMIN`). Only this Admin account is available, so no Fleet Owner / Driver behaviour is claimed. Evidence comes from Resource Timing (path, query keys/values, status) and page text/DOM. Emails/phones are masked; no token, cookie, header value or response body beyond `code`/`msg`/`extend` metadata is recorded. **No write was sent:** every write control below was opened to its confirmation and cancelled, or blocked by client validation, with 0 requests observed.

Baseline before any change: typecheck pass · lint pass · `npm test` 64/64 · `npm run build` pass (21 page routes + catch-all). The project is **not a Git repository**, so there is no diff to inspect; earlier work is identified from the docs and evidence files.

Statuses: **Verified** (live browser + automated where logic exists) · **Implemented but unverified** · **Partially implemented** · **Blocked by backend** · **Not implemented**.

## A. Users, Sub-Accounts, Settings

| Feature | Endpoint | Automated | Browser (this run) | Status | Remaining / backend |
|---|---|---|---|---|---|
| User list | GET `/users` {pageNumber, pageSize=20} | phase2-models | 200, 4 users | Verified | — |
| Keyword search | GET `/users` {keyword} (debounced) | phase2-models | "smoke" → 1 user; "zzqx" → 200, "No users · The server returned no users for these filters." | Verified | — |
| Status filter | GET `/users` {status} | phase2-models | DISABLED → 200, 0 users, empty state; ACTIVE → 200, 4 users | Verified | — |
| Role filter | GET `/roles` + GET `/users` {roleId} | phase2-models | OPERATOR → `roleId:3` 200, 1 user | Verified | — |
| Pagination | GET `/users` {pageNumber} | phase2-models | Only 4 users exist → single page | Implemented but unverified | Needs > 20 users |
| User detail | GET `/users/{id}` | — | `/users/71` 200: status, role, phone, parent, locale, failed sign-ins, timestamps | Verified | Parent shows "User 70" (id) when the parent isn't in the current list page |
| Hierarchy | GET `/users/tree` | phase2-models | 200; Administrator › Smoke Test Operator; Demo Tenant Admin; Sconex Admin | Verified | — |
| Roles & permissions (read) | GET `/roles`, GET `/permissions` | — | `/permissions` 200; 5 roles (ADMIN, DRIVER, MANAGER, OPERATOR, PLATFORM_ADMIN) with codes; read-only notice; no edit controls | Verified | Server has DRIVER ("own.data.read") and MANAGER ("Fleet manager") roles — mapping to app roles not confirmed; nothing invented |
| Disable / enable | PATCH `/users/{id}/status` | phase2-models | Disable → alertdialog "Disable Smoke Test Operator? …" → Cancel → 0 requests, still ACTIVE | Implemented but unverified (write not sent) | Needs a disposable user + approval |
| Create, edit, unlock, reset password | POST `/users`, PUT `/users/{id}`, POST `/users/{id}/unlock`, POST `/users/{id}/password` | phase2-models | Buttons present; not opened | Implemented but unverified | Disposable user; PUT optional-field semantics (#24) |
| Delete user / role edits | — | — | Not exposed | Not implemented (by design) | Cascade + role model (#24) |
| Profile (read) | GET `/me` | auth tests | Display name, email, phone, locale, time zone, tenant, role, last sign-in shown | Verified | — |
| Profile update | PATCH `/me` | phase2-models | Blank display name → "Display name is required.", 0 requests. **Pass 3:** change + restore round-trip, 200 each, re-read equals snapshot | Verified | — |
| Preferences (read) | GET `/me/preferences` | phase2-models | 200; values shown; Save disabled until a change | Verified | Value sets undocumented (#27) |
| Preferences save | PUT `/me/preferences` | phase2-models | Auto-stop 500 (range 1–120) → field invalid, 0 requests. **Pass 3:** alarmPopupMax 10→11→10 round-trip, 200 each, re-read equals snapshot (only `updatedAt` set) | Verified | Value sets for theme/modules/night mode undocumented (#27) |
| Change password | POST `/me/password` | phase2-models | Form present, submit disabled when empty; not filled (no passwords entered by the agent) | Implemented but unverified | User-run test |

## B. Geofences, Reports

| Feature | Endpoint | Automated | Browser | Status | Remaining / backend |
|---|---|---|---|---|---|
| List + map | GET `/geofences` | phase2-models | 200, 1 zone "Demo Depot North", drawn on MapTiler map | Verified | — |
| Shape filter | GET `/geofences` {shape} | phase2-models | LINE → 200, 0, "No geofences · The server returned none of this shape."; AREA → 200, 1 | Verified | **Backend:** LINE response says `source VENDOR, stale false, persisted true` while all/AREA say `LOCAL, stale, VENDOR_EMPTY` — UI shows "Live vendor data" faithfully |
| Detail | (list data) | — | Bound to Demo Truck AP01, area type code 1, 3 points; rule codes "—" | Verified | Code meanings undocumented (#22) |
| Delete | DELETE `/geofences/{id}` | — | Alertdialog "Delete “Demo Depot North”? … can't be undone here." → Cancel → 0 requests, still listed | Implemented but unverified (write not sent) | Only geofence on the tenant; needs disposable data + approval |
| Create / edit | POST/PUT `/geofences` | — | Disabled with explanation banner | Blocked by backend | Rule/area/colour codes (#22) |
| Mileage | GET `/reports/mileage` {from, to, deviceIds?} | phase2-models | 7 d → 200, 0, empty state; 30 d + Demo Truck → `deviceIds:1` 200 | Verified (empty data) | No non-empty data on tenant |
| Driving / Parking | GET `/reports/driving`, `/reports/parking` {from, to, pageNumber, pageSize} | phase2-models | 200, 0 each, empty states | Verified (empty data) | — |
| Media | GET `/reports/media` | phase2-models | 7 d / 30 d / device filter → 200, 0 | Verified (empty data) | Media/trigger codes (#23) |
| Error vs empty | — | phase2-models | **Simulated** (page-local fetch stub, 503 `DATA_UNAVAILABLE` for `/reports/*`): "Mileage report unavailable · HTTP 503 · DATA_UNAVAILABLE · Try again" + note that 503 isn't shown as empty. Stub removed → Try again → real 200 → empty state | Verified (simulated error) | — |

## C. Historical Video, Device Commands

| Feature | Endpoint | Automated | Browser | Status | Remaining / backend |
|---|---|---|---|---|---|
| Recording calendar | GET `/devices/{id}/recording-calendar` {month} | phase2-models | `month:2026-10` 200 (0 days); previous month → `month:2026-09` 200 | Verified (empty data) | Month format / integer meaning (#21) |
| Recordings of a day | GET `/devices/{id}/recordings` {from, to, channel?} | phase2-models | IST day 26 Oct 18:30Z → 27 Oct 18:30Z, 200, 0; Channel 2 → `channel:2` 200. Days without recordings aren't selectable (24 Oct click → no request) | Verified (empty data) | — |
| Export list | GET `/video/exports` {deviceId, pageNumber, pageSize=10} | phase2-models | 200, 1 job (24 Oct 14:35→15:35, Ch 1, REQUESTED). **Pass 3:** placeholder URL now shown as "Link not usable" (0 anchors) | Verified | **Backend:** placeholder `example.invalid` URL on a REQUESTED job; status values undocumented (#23, #29) |
| Export request | POST `/video/exports` | phase2-models | No recordings → no segment to export; not attempted | Implemented but unverified | Recordings + cost semantics (#23) + approval |
| Playback | — | — | "Playback not available yet" | Blocked by backend | Vendor SDK (#20) |
| Command history | GET `/commands` {type?, deviceId?, pageNumber, pageSize} | phase2-models | 200, 1 (INSTANT_SHOT, PENDING); type WAKE_UP → 200, 0, empty state | Verified | — |
| Command detail | GET `/commands/{id}` | — | **`/commands/1` → 500 `INTERNAL_ERROR`** three times (refs `dd04e054-…`, `b4a2fc03-…`, `351a2c05-…` — full ids in Pass 3); `/commands/999999` → correct 404. UI shows error panel with ref + Try again | Blocked by backend | Backend must fix the 500 (#28) |
| Command types | GET `/commands/types` | phase2-models | 200, 27 types with required/optional params and "Critical" badges; no send controls | Verified | — |
| Send | POST `/commands` | — | No send control exists | Not implemented (by design) | #25 |

## Frontend changes in this pass

| File | Change | Why |
|---|---|---|
| `components/drive-vision/navigation/nav-config.ts` | Commands description/subtitle → "Device command history and types" / "Command history and types from the server — sending is off" | Old copy said "simulated", but the screen shows live server data and sends nothing |
| `devices/device-commands.tsx`, `geofences/geofences-page.tsx`, `users/users-page.tsx`, `reports/reports-page.tsx` | Singular/plural in header counts | "1 users", "1 geofences", "1 commands" observed |

Browser re-check: Commands header "Command history and types from the server — sending is off · 1 command"; Geofences "1 geofence". Users/Reports singular forms not re-observed (no single-result state re-run). Typecheck pass · lint pass · `npm test` 64/64.

## Other observations

- Overview `GET /alarms/routine` returned **200** throughout 2026-10-27 (earlier docs: 503). Not re-checked for other ranges.
- `features/drive-vision/services/command-service.ts` (simulated sender) is no longer imported anywhere — dead code, left in place.

## Pass 3 — approved writes and defect investigation (2026-10-27, 10:57–11:02 UTC)

Approval (user, in chat): reversible `PATCH /me` and `PUT /me/preferences` tests; read-only investigation. **Not approved and not executed:** password change, any change to the four shared users, user admin writes, deleting Demo Depot North, video export requests, device commands, authorization mapping changes.

Evidence types: **live** = real BFF request observed in the browser · **simulated** = page-local fetch stub · **automated** = `npm test`.

### Command detail 500 (live)

| Request | Status | Envelope | Request id (`extend.requestId` = `x-request-id` header) |
|---|---|---|---|
| GET `/commands/1` (UI, earlier) | 500 | `INTERNAL_ERROR`, "Unexpected server error" | `dd04e054-b6c6-4326-b50e-669fbff2cd02` |
| GET `/commands/1` (UI retry) | 500 | same | `b4a2fc03-1881-4469-901d-7aff7ba8c0bc` |
| GET `/commands/1` (direct read, 10:57:35Z) | 500 | same | `351a2c05-11e4-4ec4-97f0-c7582edfc2ba` |
| GET `/commands/999999` (control) | 404 | `NOT_FOUND`, "Command not found" | `95c7ed7c-4514-4d64-b0de-2ee3d1fd83de` |
| GET `/commands` (same record in list) | 200 | "Success" | header `4cefeff1-9104-4130-8b86-f42a65398389` |

The list item for id 1 has `section: null`, `targets: []` (empty) while `targetCount` is a number, `completedAt: null`, `params: {channel}`. **Hypothesis, unverified:** the detail endpoint fails building this record (null section or targets/targetCount mismatch). Unknown ids are handled correctly, so it's record-specific. Frontend: error panel with the request id as "ref" and Try again; no command details are invented. A direct read before the app refreshed its session got 401 `INVALID_TOKEN`; those were the probe's own expired token, not app behaviour.

### Export placeholder URL (live + automated)

- Before: `safeHttpUrl()` accepted any http(s) URL, so the REQUESTED export at `https://example.invalid/…` rendered as a working "Download" link. **The frontend did not treat it as unusable.**
- Fix: `safeHttpUrl()` (shared by Video exports and Reports media) now also rejects reserved, never-resolving hosts — `*.invalid`, `*.example`, `example.com/.net/.org` and their subdomains (RFC 2606/6761). When the server sent a URL that's rejected, the row says **"Link not usable"** (with a tooltip) instead of "No file yet" or a dead link.
- Browser (live data): export row now reads "24 Oct, 14:35 → 15:35 · Ch 1 · REQUESTED · Link not usable", 0 anchors. The link was never followed; no export was requested.
- Automated: `phase2-models` asserts placeholder hosts → null (incl. upper-case and trailing dot) and look-alikes (`invalid.safefare.io`, `myexample.com`, `example.community`) stay usable.

### Profile round-trip — `PATCH /me` (live, via the Settings form)

Contract: `UpdateMeRequest`, all fields optional (displayName 1–150, email, phone pattern, locale pattern, timezone ≤ 50); response `CurrentUserDto`. The app sends only changed fields.

| Step | Request | Status | Request id | Verification |
|---|---|---|---|---|
| Snapshot | GET `/me` | 200 | — | displayName "Sconex Admin", locale en, timezone Asia/Kolkata, phone null, email set |
| Concurrency check | GET `/me` | 200 | — | equal to snapshot |
| Change | PATCH `/me` body keys `[displayName]` = "Sconex Admin (round-trip test)" | 200 "Success" | `d2d70532-a54d-4d6d-85df-f5d44b7e5a4d` | toast "Profile saved" after the response; header updated; re-read shows new name, other fields unchanged |
| Pre-restore check | GET `/me` | 200 | — | still the test value (no concurrent change) |
| Restore | PATCH `/me` body keys `[displayName]` = "Sconex Admin" | 200 "Success" | `a8cf0541-86c4-4420-b04b-9646c49da908` | re-read equals snapshot exactly (incl. email) |

### Preferences round-trip — `PUT /me/preferences` (live, via the Settings form)

Contract: full `PreferencesDto`; required theme, homeModules, deviceInfoFields, trackAlarmTypeIds, videoLayout, expiryReminderMode. The app sends the loaded object plus edits (all 14 fields), dropping server-owned `updatedAt`, so no stored field is omitted. Field chosen: `alarmPopupMax` (documented 1–50). `videoAutoStopMin` was avoided because it's null and the UI can't restore a null.

| Step | Request | Status | Request id | Verification |
|---|---|---|---|---|
| Snapshot | GET `/me/preferences` | 200 | — | 14 fields; alarmPopupMax 10; `updatedAt` **null**, `videoAutoStopMin` null |
| Concurrency check | GET | 200 | — | equal to snapshot (full-value compare; no version stamp available) |
| Change | PUT, 14 keys, alarmPopupMax 11 | 200 "Success" | `3743a858-fa50-4da6-a509-61917f6471ad` | toast "Preferences saved"; re-read diff = `alarmPopupMax 10→11`, `updatedAt null→2026-10-27T11:01:08.846Z` only |
| Pre-restore check | GET | 200 | — | still the test state |
| Restore | PUT, 14 keys, alarmPopupMax 10 | 200 "Success" | `7bf10a24-3432-476a-9c6b-426edb963ea3` | re-read diff from snapshot = `updatedAt null→2026-10-27T11:01:27.360Z` only |

Residual effect: preferences were previously unsaved server defaults (`updatedAt` null). They're now an explicitly stored record with identical values. If the backend later changes its defaults, this account keeps the stored values.

Writes sent in this pass: exactly these 4. Password, user admin, geofence, export and command writes: none.

### Test plans for unapproved writes (not executed)

Moved to [phase2-write-test-plans.md](phase2-write-test-plans.md): user admin on a disposable user, geofence deletion on a disposable geofence, video export after backend confirmation, and a user-operated password change.

## Pass 4 — backend defect report and regression protection (2026-10-27)

- **Backend defect report:** [backend-defect-commands-detail-500.md](backend-defect-commands-detail-500.md). A 4th reproduction after the refactor below: GET `/commands/1` → 500 `INTERNAL_ERROR`, ref `56fb1f41-1ff1-4998-87d6-508c70f9262f` (**live**). The panel still shows "Couldn't load this data · Unexpected server error · HTTP 500 · INTERNAL_ERROR · ref …" with Try again (**browser-verified**).
- **Frontend hardening (no behaviour change for valid data):** the command detail panel now renders through `commandDetailView()` (`devices/commands-model.ts`). Malformed values become "—" instead of crashing or showing "User null" / "Invalid Date": non-object targets are skipped and counted, `targets` that isn't an array counts as none, non-integer ids/counts are ignored, unparseable timestamps are dropped. When `targetCount` disagrees with the returned targets (the shape seen on command 1), the panel says "The server counts 1 target but returned 0." It never invents a target. The successful-detail rendering is **automated-only**: the backend has returned no 200 detail to look at.
- `apiErrorMeta()` moved from `shared/api-states.tsx` to `api/errors.ts` (re-exported from `api-states`, so existing imports are unchanged) so the "HTTP · code · ref" line is unit-testable.
- **Automated** (`tests/commands-detail.test.cjs`, new, 4 tests): real API client + stub fetch. 500 → `ApiError {http, 500, INTERNAL_ERROR, requestId}`, message "Unexpected server error", meta "HTTP 500 · INTERNAL_ERROR · ref …", exactly one request (no retry storm). 404 keeps "Command not found". Normalisation of the observed record and of malformed inputs. `phase2-models`: more look-alike URLs that must stay usable (`examples.com`, `example.co`, `notexample.org`, `cdn.safefare.io/example/invalid.mp4`).
- **Preferences residual effect (from Pass 3):** this account now uses an explicitly saved preferences record (`updatedAt` 2026-10-27T11:01:27.360Z). If the backend later changes its default preferences, this account keeps its saved values and won't inherit the new defaults.

## Phase 2 status: NOT complete

Every read path and the approved profile/preferences writes are verified live. Still open: password change (not approved), user-admin writes (no disposable user), geofence delete and video export (not approved; backend confirmation pending), command detail 500 (#28), and the undocumented code tables. See `missing-backend-apis.md` #20–#31.
