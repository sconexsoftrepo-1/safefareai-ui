# Phase 2 — Pending write-test plans (NOT executed)

Prepared 2026-10-27. None of these writes has been run. Each needs the listed test data **and** explicit approval in chat for that specific test. Not to be used under any circumstances: the four shared users (Administrator, Demo Tenant Admin, Sconex Admin, Smoke Test Operator), the geofence "Demo Depot North", device commands (out of scope entirely).

Common rules for every plan:
- Browser: the agent's own tab, signed in by the user; the agent never types passwords.
- Before each write: snapshot the record with a GET; re-read just before saving and stop if it changed.
- After each write: verify the HTTP response (method, path, status, `extend.requestId`) and re-read. Success feedback must appear only after the server answered.
- Restore wherever the operation is reversible, then re-read and compare with the snapshot. Stop and report on any unexpected status or failed restore. Don't retry blindly.
- Evidence: method, path, status, request id, field names and non-sensitive values only. No tokens, passwords or personal data.

## 1. User administration — disposable test user

**Preconditions**
- A disposable user created by the backend owner or the user and named explicitly in chat (id + display name), on tenant "SafeFare Demo Transport", not one of the four shared users, with no sub-accounts and no devices.
- Answers to `missing-backend-apis.md` #24: does `PUT /users/{id}` clear omitted optional fields, and which permission each mutation needs?
- Approval for each operation below.

| Step | UI action | Request | Expected | Restore / verify |
|---|---|---|---|---|
| 1.1 | Users → open the test user | GET `/users/{id}` | 200; snapshot | — |
| 1.2 | Edit → change display name to "<name> (edit test)" → Save | PUT `/users/{id}` | 200; toast after response; parent id resent unchanged | Re-read: only displayName changed. Edit back → PUT → re-read equals snapshot |
| 1.3 | Disable → confirm | PATCH `/users/{id}/status` {DISABLED} | 200; status DISABLED in list and detail | — |
| 1.4 | Enable → confirm | PATCH `/users/{id}/status` {ACTIVE} | 200; ACTIVE | Re-read equals snapshot (except server timestamps) |
| 1.5 | Unlock (only if the backend can put the user in a locked state, e.g. after failed sign-ins set up by the backend owner) | POST `/users/{id}/unlock` | 200; failed sign-ins reset | Re-read |
| 1.6 | Guard check: open **own** account (Sconex Admin) | — | Disable / Reset password for self are blocked in the UI (no request) | — |
| 1.7 (optional, separate approval) | Create user | POST `/users` | 201/200; appears in list | Backend owner deletes it (no delete in the UI) |

Reset password for another user is excluded unless the backend owner asks for it. The new password would be chosen and typed by the user, not the agent.

## 2. Geofence deletion — disposable test geofence

**Preconditions**
- A disposable geofence created by the backend owner (the frontend can't create one; create/edit is disabled), named e.g. "TEST delete me", bound to no device or to a disposable device. Its id is given in chat.
- Confirmation of the side effects: delete also removes the rule from bound devices and from the vendor; is it reversible?
- Approval.

| Step | UI action | Request | Expected | Verify |
|---|---|---|---|---|
| 2.1 | Geofences → All → select the test geofence | GET `/geofences` | 200; snapshot ids of all geofences | — |
| 2.2 | Delete → confirm "Delete geofence" | DELETE `/geofences/{id}` | 200/204; toast after response | Re-read: only that id gone; Demo Depot North and others unchanged |
| 2.3 | Error path (optional) | DELETE the same id again only if the backend owner wants it | 404 shown as an error, list unchanged | — |

## 3. Video export request

**Preconditions**
- Backend confirmation of (a) cost: does an export consume vendor credit or device data? (b) the `ExportDto.status` / `vendorStatus` value table and which value means "file ready" (is `readyAt` that signal?); (c) that `url` stays null until the file exists, with no placeholder hosts (#23, #29).
- A device with at least one recording segment (the calendar currently shows 0 days).
- Approval with the specific device, channel and time window.

| Step | UI action | Request | Expected | Verify |
|---|---|---|---|---|
| 3.1 | Video → device → day with recordings → choose a segment | GET calendar / recordings | 200 | — |
| 3.2 | Request export → confirm | POST `/video/exports` {deviceId, channel, from, to} | 200; job appears with the documented initial status | GET `/video/exports` |
| 3.3 | Wait for the ready status (poll by Refresh, no automatic loop) | GET `/video/exports` | Ready status; `url` on a real host | Link shown only when usable; not opened by the agent unless approved |

## 4. Password change — user-operated only

The agent will not type, read, store or relay passwords. The user runs this themselves.

**Preconditions:** the user chooses a test window and has the current password at hand. Other open sessions may be signed out ("other sessions may need to sign in again").

| Step | Who | Action | Expected |
|---|---|---|---|
| 4.1 | User | Settings → Change password: wrong current password → Change password | Server error shown on the form, no success toast. Agent may observe only method, path and status (POST `/me/password`, 4xx) |
| 4.2 | User | Mismatched confirmation | Client validation blocks it, 0 requests |
| 4.3 | User | Valid change | 200; success toast after the response |
| 4.4 | User | Sign out, sign in with the new password | Works. Optionally change it back the same way |

The agent records only: method, path, status, request id, whether a success toast appeared, and whether the existing session kept working.
