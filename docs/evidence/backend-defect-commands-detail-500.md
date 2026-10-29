# Backend defect — `GET /api/v1/commands/1` returns 500

**For:** Safe-Fare Fleet BFF owner · **Reported:** 2026-10-27 · **Environment:** BFF at `185.193.19.156:9096`, tenant "SafeFare Demo Transport", caller `PLATFORM_ADMIN` · **Severity:** command detail unusable for this record. History, types and other ids are unaffected.

## Observed

| Request | Result |
|---|---|
| `GET /api/v1/commands/1` | **HTTP 500**, `{code: 500, msg: "Unexpected server error", data: null, extend.errorCode: "INTERNAL_ERROR"}` |
| `GET /api/v1/commands/999999` (non-existent) | HTTP 404, `NOT_FOUND`, "Command not found" (correct) |
| `GET /api/v1/commands?pageNumber=1&pageSize=20` | HTTP 200, one item: id 1, `INSTANT_SHOT`, `PENDING` |

Reproduced 4 times. Request ids from `extend.requestId` (for #3 also checked equal to the `X-Request-Id` response header):

| # | When (UTC, 2026-10-27) | Request id | Source |
|---|---|---|---|
| 1 | before 10:57 (time not recorded) | `dd04e054-b6c6-4326-b50e-669fbff2cd02` | app, open detail |
| 2 | before 10:57 (time not recorded) | `b4a2fc03-1881-4469-901d-7aff7ba8c0bc` | app, Try again |
| 3 | 10:57:35 | `351a2c05-11e4-4ec4-97f0-c7582edfc2ba` | direct read-only GET |
| 4 | after 11:02 (time not recorded) | `56fb1f41-1ff1-4998-87d6-508c70f9262f` | app, after the frontend refactor |

## The record, as returned by the list (types only, no values beyond those shown)

`id 1`, `type INSTANT_SHOT`, `status PENDING`, **`section: null`**, **`targets: []`** (empty array) while **`targetCount`** is a number (the UI shows 1), `completedAt: null`, `params: {channel: <number>}`, `requestedBy: <number>`, `createdAt: <string>`.

## Hypothesis — unconfirmed

The detail endpoint may fail while building this record: it might dereference the null `section`, or expect at least one target row because `targetCount` is 1. This is inferred from the data shape only; it hasn't been checked against server logs or code.

## Asked of the backend

1. Look up the request ids above in the server logs and fix the 500.
2. Confirm whether command 1 should have a target row (count 1 vs empty `targets`), and whether `section` may be null.
3. If the record is bad seed data, say so. The frontend will keep showing whatever the server returns.

## Frontend behaviour (unchanged by this report)

The detail panel shows "Couldn't load this data · Unexpected server error · HTTP 500 · INTERNAL_ERROR · ref <request id>" with **Try again**. No command details are invented. Automated tests cover the 500/404 presentation and how incomplete or malformed detail data is displayed (`tests/commands-detail.test.cjs`).
