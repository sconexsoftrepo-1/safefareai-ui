# Phase 3 — controlled write tests: preflight and plan

Date: 2026-10-29. Status: **blocked — nothing sent.** Real-backend write verification so far: **0 operations**.

## Preflight result

| Prerequisite | Result | Evidence |
|---|---|---|
| Tenant explicitly designated for testing | **Not confirmed** | Only indicators: tenant data is a stored demo set ("Demo Tenant Admin", "Demo Truck AP01", "Demo Driver One", `admin.demo01@safefare.example`), `extend.source = LOCAL` with `fallbackReason = VENDOR_NOT_CONFIGURED`. Nothing in the spec, the API or the docs states the tenant is a test tenant. |
| Disposable target with no real-world effect | **Unclear** | Device 1 (Demo Truck AP01): vendor feed not configured, so no terminal should receive anything. Driver 1 (Demo Driver One): `userId` null (no driver login → no driver-app delivery), but has phone `+919200000101`. |
| Side effects documented | **No** | Every operation in the spec has an empty summary/description. No SMS/push/webhook features appear in the spec (the only "sms" match is `gsmSignal`). In-app notifications (`/notifications`) may be created; unknown for which users. |
| Cleanup | **Partial** | No `DELETE /dispatches/{id}` in the spec. Cleanup = `POST /dispatches/{id}/cancel`, which leaves a CANCELLED record permanently (only a backend purge would remove it). `DELETE /drivers/{id}` exists, so a disposable *driver* can be fully removed. Leave requests, swap requests, checklists and alert actions have no delete. |
| Authorization | Admin (`PLATFORM_ADMIN`) | Confirmed earlier in the session; **session ended** at 16:06:08 by an explicit sign-out (`POST /auth/logout` 200, ref `203da18e-aa25-4b37-912c-e8a119325dd4`), not initiated by the agent. |
| Alert assign | Still disabled | `alertService` has no assign function (#32). |
| Driver operations | Still blocked | No Driver role mapping (Q1); `/my-work` not opened as Admin. |

## Needed before the first write

1. Written confirmation that the dev tenant behind `NEXT_PUBLIC_API_BASE_URL` is a test tenant and may receive disposable records.
2. Confirmation that creating/cancelling a dispatch sends nothing outside the BFF (no SMS/push/email to `+919200000101` or anyone else), **or** a different disposable driver with no contact details.
3. Agreement that cleanup leaves one CANCELLED dispatch (or that the backend team will purge it), with the record id reported here.
4. A signed-in Admin session in the test tab.

## Plan A — one disposable dispatch (run only when 1–4 are met)

Every step is a single request, sent through the app's UI (Dispatch screen) so the real client is used; the agent stops at the first deviation from the contract.

| Step | Request | Body (sanitized) | Expect / verify |
|---|---|---|---|
| A0 | `GET /dispatches` (All) | — | Baseline: 0 records (observed 2026-10-29). |
| A1 | `POST /dispatches/check` | Same body as A2 | `CheckResultDto`; creates nothing — confirm afterwards with `GET /dispatches` still 0. If a record appears, stop. |
| A2 | `POST /dispatches` | `{ deviceId: 1, driverId: 1, title: "[TEST] SafeFare frontend contract test — disposable", instructions: "Automated frontend test. Do not action.", scheduledStart: <tomorrow 10:00 IST as ISO>, scheduledEnd: <tomorrow 11:00 IST> }` | 200 `Row` with `id`, status (value recorded raw). |
| A3 | `GET /dispatches/{id}` | — | Same fields as A2 persisted. |
| A4 | `GET /dispatches/{id}/verification` | — | `VerificationDto` (ready + checks) rendered in the drawer. |
| A5 | `GET /notifications`, `/unread-count` | — | Record whether A2 created a notification (side-effect evidence). |
| A6 | `PUT /dispatches/{id}` | A2 body with `instructions` changed only | 200; A3 again shows the change. |
| A7 | `POST /dispatches/{id}/cancel` | `{ reason: "Test cleanup" }` | 200; `GET /dispatches/{id}` → cancelled status + `cancelReason`. This is the cleanup. |

Not in Plan A: swap request/approve/reject (reassigns drivers), driver lifecycle actions (driver role).

## Plan B — other Admin writes, one at a time (after Plan A passes)

| Order | Operations | Disposable record / cleanup | Blocker |
|---|---|---|---|
| B1 | `POST /drivers` → `PUT /drivers/{id}` → `DELETE /drivers/{id}` | New driver "[TEST] …", no phone/email; **fully removed** by DELETE | Same as 1–4 |
| B2 | Server-side validation: `POST /drivers` with a value the client accepts but the server may reject (e.g. `userId` of a non-existent user) | Expect 4xx with field errors shown per field; confirm with `GET /drivers` that nothing was created | Same as 1–4 |
| B3 | `POST /drivers/{id}/assignments` (B1 driver → device 1, `replaceCurrent: false`) → `/end` | Expect conflict with the existing active assignment of device 1, or an assignment that `/end` closes; history stays | Confirm assignment history residue is acceptable |
| B4 | `POST /leave-requests` (B1 driver) → `/reject` | Leave record persists (no delete) | Residue acceptable? |
| B5 | Notification read/unread | Needs a notification to exist (0 today) | Data |
| B6 | Alert acknowledge/comment/resolve/dismiss/reopen | Would change the tenant's only alert; history persists | **#36** (status vs. history) must be answered first |
| — | `POST /assistant/ask` | Probably read-like, but unconfirmed whether it logs or calls an external LLM | Confirm behaviour/cost |
| — | `POST /alerts/{id}/assign` | — | **#32** — stays disabled |
| — | 21 `/driver/*` | — | Q1 + test-driver login |
