# Phase 3.5 — V10 live validation and post-authentication audit

Date: 2026-11-02 · Branch `new-features/Prakash` @ `eccc41e` (no commits, resets or pushes).
Scope: validation of the Phase 2–3 implementation. No new functionality, no Phase 4 work.

## Status legend

| Status | Meaning |
|---|---|
| **LIVE VERIFIED** | Observed against the real V10 BFF with a real account |
| **BROWSER (MOCKED)** | Real browser (headless Edge 156, production build). Every `/api/v1/*` request was intercepted and answered locally, so nothing reached the BFF. This proves UI behaviour and request construction, **not** backend behaviour. Counted as CODE-LEVEL in the summary. |
| **CODE-LEVEL VERIFIED** | Unit tests (mocked fetch), mutation checks, typecheck, build |
| **STATIC CONTRACT VERIFIED** | Checked against `docs/openapi/api-docs-v10.json` |
| **NOT TESTED** | — |
| **BLOCKED** | Needs something from the backend (see §11) |

## Change control

- `git status` was recorded before any edit (saved to the session scratchpad). All 23 modified and 18 untracked Phase 0–3 files are preserved unchanged.
- **No application source file was modified in Phase 3.5.** The only temporary source edits were the mutation checks in §10. They were made from a backup and restored byte-identical (SHA-1 checked).
- Files added or updated: see §13.

---

## 1. Safe-Fare Admin live login — **LIVE VERIFIED**

Evidence (user browser test after the Phase 2 implementation):
- The existing login page was opened and the **Safe-Fare Admin** option selected.
- Sign-in **succeeded**.
- **No tenant code was required.**

Code-level inference, not live verified: the app reaches the signed-in state only after `POST /auth/login`, `GET /me` **and** `GET /me/permissions` all succeed (`auth-store.ts` `signIn` → `loadSession`). A successful sign-in therefore implies both identity calls returned data. Their contents were not captured: `platform`, `tenantId`, `roleCode`, whether `tenant.all` is present, and `screens`.

Not live verified, and not claimed:

| Item | Status |
|---|---|
| Tenant ADMIN login | BLOCKED (no account) |
| Fleet Owner / Dispatcher / Viewer login | BLOCKED (no accounts, role codes unknown) |
| Driver login on V10 | BLOCKED (live only pre-V10, 2026-10-29) |
| Platform permission enforcement (backend) | BLOCKED |
| Tenant switching | NOT TESTED (Phase 5; not implemented) |
| Cross-tenant isolation | BLOCKED (needs two tenants + accounts) |
| Permission-matrix editing | NOT TESTED (Phase 6; not implemented) |
| Safe-Fare Admin post-login screens / dashboard data | BLOCKED (see §8.3) |

## 2. Authentication validation

| # | Check | Result | Status | Evidence |
|---|---|---|---|---|
| 1 | Tenant login sends `tenantCode` | ✅ | CODE-LEVEL + BROWSER (MOCKED) | `login-model.ts` `buildLoginRequest`. In the browser, the request body keys were `login, password, tenantCode` (`"TEST"`). |
| 2 | Admin login omits `tenantCode` entirely | ✅ | **LIVE VERIFIED** (login succeeded) + BROWSER (MOCKED) | In the browser, the body keys were `login, password` only. Test `3.5/T2` covers form codes `""`, `"   "` and `"ACME"` in admin mode: the key is absent in every case. |
| 3 | No empty `tenantCode` sent | ✅ | CODE-LEVEL + BROWSER (MOCKED) | A blank or whitespace code is dropped in both modes. In tenant mode, a whitespace-only code fails validation in the browser and sends 0 requests. |
| 4 | No `null` `tenantCode` sent | ✅ | CODE-LEVEL | The property is only ever assigned a non-empty trimmed string |
| 5 | `GET /me/permissions` is the authorisation source | ✅ | CODE-LEVEL | `useAccess()` → `computeAccess(state.identity)`. `identity` comes only from `readIdentity(myPermissions())`. |
| 6 | `GET /me` is profile only | ✅ | CODE-LEVEL | `state.user` is never passed to the access policy (grep: no `user.roleCode` in access code; `access-v10` source test) |
| 7 | Session start waits for both calls | ✅ | CODE-LEVEL + BROWSER (MOCKED) | `Promise.all([me, myPermissions])` runs before `status: "authenticated"`. In the browser, the shell rendered only after both mocked responses. |
| 8 | Failed identity load opens no shell | ✅ | CODE-LEVEL | Non-401 failure → `error` state (AuthGate retry panel, shell not rendered). 401 → signed out. *Note:* a 200 response with `data: null` gives an authenticated session with **no** identity: the "No access for this account yet" panel shows and every screen is closed. That is fail-closed by design and tested. |
| 9 | Token refresh works | ✅ | CODE-LEVEL; live pre-V10 | `client.ts` unchanged since before Phase 2 (`git diff` empty); `auth-refresh.test.cjs` |
| 10 | Cross-tab refresh coordination | ✅ | CODE-LEVEL | Unchanged lock + adopt-rotated-session paths; `auth-refresh.test.cjs` races |
| 11 | One retry after 401 | ✅ | CODE-LEVEL | `client.ts`: a single `send` retry with a refreshed session; a second 401 → `endSession("expired")` |
| 12 | Logout clears identity and permissions | ✅ | CODE-LEVEL | `onSessionEnded` → `SIGNED_OUT` clears `user`, `identity` and `bootError` together; `auth-access` logout test |
| 13 | No tokens or passwords in logs | ✅ | CODE-LEVEL | `diagnostics.ts` logs only method, URL, status, duration, error code and request id. `logAuth` messages are fixed strings. Test `auth-login` "no password, token or Authorization in console". |

Browser-only observations (BROWSER (MOCKED), 375×812 and 1440×900): wrong-credential errors show the server's `msg` with `HTTP 401` underneath, and the password field is cleared. The account-type switch clears field errors. Login uses `auth: false`, so no bearer header is sent and a failed login can't trigger the refresh or session-expiry logic.

## 3. Platform admin access — CODE-LEVEL VERIFIED (synthetic fixtures)

All fixtures are synthetic (`tests/phase3-5-validation.test.cjs`). Role codes other than `ADMIN` / `DRIVER` are deliberately fake.

| # | Scenario | `kind` | `platform` | `canAccessPlatform` |
|---|---|---|---|---|
| 1 | `platform: true` + `tenant.all` | platform-admin | true | **true** |
| 2 | `platform: true`, no `tenant.all` | platform-admin | true | false |
| 3 | `platform: false`, `ADMIN`, every code incl. `tenant.all` | tenant-admin | false | false |
| 4 | `platform` missing | tenant-admin | false | false |
| 5 | `platform: null` / `"true"` / `1` | not platform | false | false |
| 6 | Empty permissions | — | — | false; **no screen at all, not even Settings** |
| 7 | Malformed permissions (string, object, non-string entries, `"TENANT.ALL"`, `" tenant.all"`) | — | — | false; malformed entries dropped |
| 8 | Unknown role code | tenant-user | false | false; grants nothing |

- Platform-only screens need `platform === true` **and** the screen's own code. A tenant ADMIN holding `tenant.all` still can't open one (test registry, since no platform screen exists yet).
- A tenant ADMIN's access comes only from its permission set. `ADMIN` gives no grant by itself.

## 4. Permission resolver — CODE-LEVEL + STATIC CONTRACT VERIFIED

- **Every code the frontend uses exists in V10, except `driver.app`.** `access-v10.test.cjs` checks every `SCREENS` / `FEATURES` / `ACTIONS` entry against the spec's "Required permission" for the operations it names. `driver.app` **does not appear anywhere in the V10 spec**. It is kept as an `observed` code (live DRIVER menus, 2026-10-29) and documented as such.
- **Special codes:**

  | Code | In V10 | Used by the frontend | Where V10 requires it |
  |---|---|---|---|
  | `tenant.all` | ✅ | `canAccessPlatform` only (no screen yet) | `GET /platform/tenants`, `POST /platform/switch-tenant` |
  | `role.manage`, `permission.manage`, `menu.manage`, `reference.manage` | ✅ | Not used (Phase 6–7 screens) | Role, permission, menu and reference admin operations |
  | `own.data.read` | ✅ | My Work (`allOf` with `driver.app`), `driver.selfService` | `/driver/**` (22 operations) |
  | `driver.app` | ❌ (observed only) | My Work | — |
  | `command.send` | ✅ | Device Commands screen (incl. history) | `GET`/`POST /commands`… |

  Nothing assumes these are returned to any user. Whether the Safe-Fare Admin receives `tenant.all` is **BLOCKED** (§11).
- **Fail closed:** missing or malformed identity, an empty set, unknown codes, look-alikes and prototype-chain strings all grant nothing.
- **Server screens restrict only.** A server screen with `routePath: "/dashboard"` or `/drive-vision/users` and `allowed: true` operations opens nothing without the matching code (test `3.5/T4`). `readOnly` and `allowed: false` remove actions.
- **Unknown screens and paths are denied** (`/drive-vision/platform`, `/tenants`, `/roles`, `/overviewx`, path traversal) → `unknown-route`.

## 5. Driver access — CODE-LEVEL VERIFIED

- My Work (Work, Shifts, Leave, Checklist, Safety, Profile) needs a DRIVER login (not platform) **and** `own.data.read` **and** `driver.app`. Each code alone, ADMIN with both, platform + DRIVER, and an unknown role with both are all denied.
- A driver gets no fleet screens or actions. Actions available: `driver.selfService`, `account.password`, `notifications.markRead`.
- Fleet screens appear only when explicitly granted: `alarm.read` → Alerts + Safety only, and still no `alerts.handle`.
- Settings is always hidden for drivers.
- Driver notifications: `/driver/notifications` maps to "no page" (header bell); `notifications.markRead` is signed-in only.
- Other drivers' data: the frontend can't route a driver to `/drive-vision/drivers[/id]`, `/users` or `/workforce`. Whether `/driver/**` returns only the caller's rows is a **backend** guarantee: **BLOCKED** (no V10 Driver account).
- The driver requirements were **not** removed.

## 6. Operation-level permissions — CODE-LEVEL VERIFIED

Real V10 codes. Each case checks the **exact** set of actions offered on the screen, so nothing leaks.

| Screen | Read | Create | Update (button set) | Delete |
|---|---|---|---|---|
| Drivers | `driver.read` | `driver.create` → Add | `driver.update` → Edit, Assign, End assignment | `driver.delete` → Delete |
| Dispatch | `dispatch.read` | `dispatch.create` → New | `dispatch.update` → Edit, Cancel, Request swap, Approve/Reject swap | — (no delete in the UI) |
| Workforce | `workforce.read` | `workforce.create` → Request leave | `workforce.update` → Approve/Reject leave | — |
| Users | `user.read` | `user.create` → Add user | `user.update` → Edit, Status, Unlock, Reset password | — (`user.delete` exists in V10; the UI has no delete) |

| Combo | View | Create | Edit | Delete | Result |
|---|---|---|---|---|---|
| A read | ✅ | hidden | hidden | hidden | ✅ all 4 screens |
| B read + update | ✅ | hidden | ✅ | hidden | ✅ |
| C read + create | ✅ | ✅ | hidden | hidden | ✅ |
| D read + update + delete | ✅ | hidden | ✅ | ✅ (Drivers) | ✅ |

Write codes without the read code open neither the screen nor its actions. Source check: each page's buttons and action menus are gated by these flags. `drivers-page.tsx` gates Delete and Edit separately (lines 331–338) and End assignment by `canUpdate` (line 456). Dispatch, Workforce and Users follow the same pattern.

## 7. Navigation and route protection

| # | Check | Status |
|---|---|---|
| 1 | One nav catalogue (`NAV_GROUPS`) filtered by the resolver | CODE-LEVEL |
| 2 | `routePath` used for server screens | CODE-LEVEL + STATIC CONTRACT |
| 3 | No `routeKey` assumption (`MyScreenDto` has none; the only `routeKey` is in the unused legacy `MenuNodeDto`, which V10 also defines) | STATIC CONTRACT |
| 4 | `menuKey` parsed, never fabricated or used | CODE-LEVEL |
| 5 | Unknown paths → "Page not found" | CODE-LEVEL |
| 6 | Unauthorised direct URL blocked | CODE-LEVEL + BROWSER (MOCKED): synthetic platform identity → `/drive-vision/users` → "You don't have access to this page" |
| 7 | Platform-only routes need `platform` + code | CODE-LEVEL (test registry) |
| 8 | Tenant screens respect permissions | CODE-LEVEL |
| 9 | Driver navigation (six sections, server order and titles) | CODE-LEVEL |
| 10 | Missing identity exposes nothing, including Settings | CODE-LEVEL |
| — | No session: `/drive-vision/users`, `/settings`, `/my-work`, `/not-a-page`, `/drive-vision` → `/login?next=…` with **0 API calls** | BROWSER (MOCKED) |
| — | Nav ⇔ route agreement for every fixture | CODE-LEVEL |

**Unmapped routePaths.** Only these server paths are mapped: `/driver/work|shifts|leave|checklist|safety|profile`, `/driver/notifications` (no page), `/dashboard`, `/alarms`, `/reports`, plus the app's own `/drive-vision/…`. Every other screen has no confirmed backend `routePath`: Monitoring, Video, Trips, Vehicles, Drivers, Dispatch, Workforce, Safety, Geofences, Commands, Users, Settings, and all future platform screens. Those screens are opened by permission codes; server titles and order aren't applied to them (D3).

## 8. Browser testing

### 8.1 Login page — BROWSER (MOCKED), headless Edge 156, production build

| Check | Result |
|---|---|
| Tenant user selected by default; tenant code visible | ✅ |
| Safe-Fare Admin selection: radio `aria-checked`, tenant field removed, explanatory note shown | ✅ |
| Tenant code validation: empty → "Tenant code is required."; whitespace-only → same; 0 requests | ✅ |
| Admin validation: only login + password required | ✅ |
| Password visibility: `type` password ↔ text, `aria-pressed`, label "Show/Hide password" | ✅ |
| Sign-in loading: "Signing in…", button disabled | ✅ |
| Error state: server `msg` + `HTTP 401`; password cleared | ✅ |
| Request construction per mode (see §2) | ✅ |

### 8.2 Post-login with the real Safe-Fare Admin account

**NOT TESTED by Claude.** No credentials were supplied, the BFF is plain HTTP, and the brief forbids entering more credentials. Only the user's live login (§1) exists.

### 8.3 Post-login, mocked synthetic platform identity (`platform: true`, permissions `["tenant.all"]`)

BROWSER (MOCKED). This shows how the shell treats such an identity, **not** what the backend returns:
- Landing → redirected to **Settings** (the only screen open: no fleet codes, and no platform screen exists before Phase 4).
- The profile menu shows the `GET /me` name and email. The access panel shows "Role: ADMIN · platform".
- `/drive-vision/users` typed directly → access-denied panel, with "Go to Settings" and "Sign out".
- No horizontal overflow at 1440×900 or 375×812.

What the real Safe-Fare Admin sees depends entirely on the codes `/me/permissions` returns. That is **BLOCKED** until the payload is captured (§11 items 2–3).

Screenshots and raw results: `docs/evidence/screenshots/phase3-5/` (`results.json`, the `cdp-validate.cjs.txt` driver script).

## 9. Responsive testing — BROWSER (MOCKED)

Login page, both account types, at every viewport:

| Viewport | Horizontal overflow | Clipped fields | Overlapping controls | Touch targets |
|---|---|---|---|---|
| 320×640 | none | none | none | radios 113×39, inputs/button 238×40 |
| 375×812 | none | none | none | radios 141×36, inputs 293×40 |
| 390×844 | none | none | none | radios 148×36 |
| 768×1024 | none | none | none | radios 165×36, inputs 342×40 |
| 1024×768 | none | none | none | same |
| 1440×900 | none | none | none | same |

At 320 px the "Safe-Fare Admin" label wraps to two lines inside its segment, with no clipping. The show/hide-password button is **28×28 px**: it passes WCAG 2.2 AA (24 px) but is below the 44 px mobile guideline. This is pre-existing and recorded only, not changed. The signed-in shell was checked only with the mocked identity (§8.3), not at all viewports.

## 10. Automated tests

| Check | Result |
|---|---|
| `npm test` | **325 / 325** (baseline 312 + 13 new in `tests/phase3-5-validation.test.cjs`) |
| V10 contract (`v10-contract.test.cjs`) | pass, 0 errors |
| Auth tests (`auth-login`, `auth-access`, `auth-refresh`) | pass |
| Permission tests (`access-v10`, `access-policy`, `driver-access`, `phase3-5-validation`) | pass |
| `npm run typecheck` | pass |
| `npm run lint` (`--max-warnings=0`) | pass, 0 warnings |
| `npm run build` | pass, **29 routes** |
| Responsive | §9 (browser, mocked) |

No test was weakened or removed.

**Mutation check of the new tests** (each run from a backup; `access-policy.ts` restored byte-identical afterwards):

| Mutation | New tests failing |
|---|---|
| Empty permission set opens Settings | 1 |
| Driver audience ignored (anyone with both codes gets My Work) | 1 |
| `platformOnly` ignored | 1 |
| `canAccessPlatform` without `tenant.all` | 1 |
| Action offered without its screen | 2 |

## 11. Backend dependencies (unanswered; nothing assumed)

| # | Question | Blocks |
|---|---|---|
| 1 | Exact role codes for all six roles (only `ADMIN` and `DRIVER` known) | Labels, fixtures |
| 2 | Does the Safe-Fare Admin receive `tenant.all`? | Platform admin access (Phase 4) |
| 3 | Is the Safe-Fare Admin's `tenantId` `null` before tenant selection? | Tenant context, `TENANT_REQUIRED` |
| 4 | Is `driver.app` required alongside `own.data.read`? (`driver.app` is not in V10) | My Work gate |
| 5 | Actual `menuKey` / `routePath` values for all screens | Server-driven nav (§7) |
| 6 | Meaning of `TenantSelectionDto.header` | Phase 5 |
| 7 | Tenant switching behaviour | Phase 5 |
| 8 | Does the backend reject tenant ADMIN permission-management operations? | Phase 6 |
| 9 | Test accounts for all six roles | Every live check in §1 |
| 10 | A test tenant where safe writes are allowed | Live write checks |
| 11 | HTTPS for the development BFF | Any further real-credential testing |
| 12 | Python Swagger | Phase 8 |

**Cheapest unblocker for items 2–3:** the user (already signed in as Safe-Fare Admin) opens DevTools → Network → `GET /api/v1/me/permissions` and shares the response **with tokens removed**. Claude does not need credentials for this.

## 12. Security observations

1. **Plain-HTTP BFF.** Credentials and tokens cross the network unencrypted, including the Safe-Fare Admin login that was just tested. This is the highest-priority item (D8).
2. Tokens live in `sessionStorage`, which is readable by any XSS. This is the existing design; a CSP is recommended before production.
3. The access policy is a UI convenience. Every guarantee in §3–7 must also be enforced by the BFF. Backend enforcement is **not** verified (BLOCKED).
4. The Safe-Fare Admin without a selected tenant is still offered the 26 tenant-scoped writes whenever it holds the codes, and these would fail with `TENANT_REQUIRED` (known; Phase 5).
5. A 200 response from `/me/permissions` with `data: null` gives a signed-in session with no access. This is fail-closed, but the panel doesn't distinguish "server sent nothing" from "no permissions".
6. No secrets in logs (§2 #13). The open-redirect guard on `next` stays in place (`safeNext`).

## 13. Issues found and fixes applied

**No product defects found, so no application code changed.**

| Finding | Action |
|---|---|
| My first browser mock used a `message` field and the UI showed the generic 401 text | Test-harness error, not a product defect: V10 `ErrorResponse` uses `msg`. Re-ran with a spec-shaped body; the server message displays correctly. |
| The Phase 2–3 report listed Safe-Fare Admin login as unverified | Updated to LIVE VERIFIED, with the evidence |
| No explicit tests for the brief's scenario matrices (platform null, malformed codes, combos A–D per page, …) | Added `tests/phase3-5-validation.test.cjs` (13 tests, synthetic fixtures, mutation-checked) |

Files changed in Phase 3.5:
- `docs/phase2-3-auth-permission-report.md` — verification-level banner, live and browser test sections
- `docs/implementation-status.md` — verification levels, feature table, baseline 325
- `docs/phase3-5-validation-report.md` — new (this file)
- `tests/phase3-5-validation.test.cjs` — new
- `docs/evidence/screenshots/phase3-5/` — new (18 screenshots, `results.json`, `cdp-validate.cjs.txt`)

## 14. Remaining risks

- Real `/me/permissions` content for every role is unknown. The UI is correct for the payloads it was tested with, but what each user sees depends on data nobody has captured yet.
- A Safe-Fare Admin without fleet codes sees only Settings until Phase 4 adds platform screens. A Safe-Fare Admin with fleet codes but no tenant sees fleet screens whose writes fail.
- `driver.app` is a non-spec requirement. If the backend drops it, drivers lose My Work.
- Server-driven navigation covers only the driver app and 3 fleet paths (D3).
- No V10 live test yet for tenant users, drivers, refresh or logout.

## Acceptance

| Criterion | Result |
|---|---|
| Reports updated with Safe-Fare Admin LIVE VERIFIED, other items kept separate | ✅ |
| Auth, platform, resolver, driver, operation and navigation validation | ✅ CODE-LEVEL / STATIC CONTRACT |
| Browser + responsive (login page) | ✅ BROWSER (MOCKED) |
| Post-login with the real Safe-Fare Admin | ❌ NOT TESTED (no credentials, HTTP) |
| Regression baseline holds; tests not weakened | ✅ 325/325, typecheck, lint 0, build 29 routes |
| No destructive or production writes; nothing sent to the BFF by Claude | ✅ |

**Phase 3.5 passes for everything that can be verified without backend access.** The live items in §1 and §11 remain BLOCKED and are not claimed. Phase 4 has not been started and is waiting for approval.
