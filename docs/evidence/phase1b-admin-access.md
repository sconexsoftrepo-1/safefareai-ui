# Phase 1B — Admin access verification

Started 2026-10-27. Record only method, path, status, request id and visible UI state — no tokens, headers, cookies or bodies.

## Automated (done)

`npm run typecheck` pass · `npm run lint` pass · `npm run build` pass · `npm test` **44/44** (40 existing + 4 new):

| New test | Covers |
|---|---|
| exact codes only | Whitespace/case/prefix/wildcard permission codes, menu `routePath`/`menuKey`/`title`/`requiredPermissionCode`, permission objects with descriptions → no grant |
| prototype-chain role codes | `constructor`, `__proto__`, `valueOf`, array or object codes → no grant |
| nav ⇔ route agreement | For admin, no user, unknown role, permission/menu grants and a mapped role: nav items = screens `decideRoute` allows |
| search visibility | Sample records only with `recordSearch` and an openable target; pages only for openable screens; unknown/foreign hrefs dropped |

Review result: no defects found. Search filtering was moved from `global-search.tsx` into `visibleSearchResults()` in the policy so it is unit-tested and shares the route check.

## Browser — authenticated Admin (manual steps)

Run in Chrome against `npm run dev` (http://localhost:3000) with DevTools → Network filtered to `9096`. Sign in with an authorised `PLATFORM_ADMIN` test account.

| # | Step | Expected |
|---|---|---|
| 1 | Open `/login?next=/drive-vision/overview`, sign in | `POST /auth/login` 200 → lands on Overview; no "No access" panel |
| 2 | After sign-in | `GET /me` 200 and `GET /me/menus` 200, each with `Authorization` header (check presence only) |
| 3 | Sidebar / mobile drawer / section bar | All 12 screens across Overview, Monitor, Fleet, Safety, Manage, Admin |
| 4 | Visit Overview, Live Monitoring, Vehicles (+ a vehicle detail), Alerts, Users & Sub-Accounts | Each renders; the API reads already recorded in `api-integration-checklist.md` fire with 200 (or their known 503s); Users is still sample data (no API) |
| 5 | Ctrl K, type a vehicle name | Pages and sample records listed |
| 6 | Iris button in the header | Visible; panel opens |
| 7 | Visit `/drive-vision/does-not-exist` | "Page not found" panel inside the shell; **no** BFF requests from that route |
| 8 | Reload any screen | Session recovered via `GET /me` (refresh only if near expiry); no redirect to /login |
| 9 | Profile menu → Sign out | `POST /auth/logout` 200 → `/login`; visiting `/drive-vision/overview` redirects to `/login?next=…` with no BFF requests |

## Browser — results

| # | Result |
|---|---|
| 1–9 | **Pending — not run.** 2026-10-27: a sign-in tab was opened in the agent's Chrome tab group and the user was asked twice to sign in there. Both checks found the form still empty and 0 BFF requests in that tab, so no authenticated session was available to verify. A session from another tab can't be used: tokens live in per-tab `sessionStorage`. |
| 1–9 | **BLOCKED — second attempt, 2026-10-27.** The Claude-in-Chrome extension reported "Browser extension is not connected" on two consecutive tries, so the original tab couldn't be reached. Nothing was entered or submitted. Separately, the agent does not type the password into the form, because it is sent to the remote BFF (`185.193.19.156`); the user types the password and the agent fills only tenant code and login. |
| 1–9 | **BLOCKED — third attempt, 2026-10-27.** The user reported that login works, but the extension's `tabs_context` call timed out twice ("did not respond in time"). The original tab's state couldn't be read, so no check could be observed. Phase 2 work continued without browser verification. |
| 1–9 | **BLOCKED — fourth attempt, 2026-10-27.** Extension connected, but `tabs_context` returned "This session has no tab group of its own" twice (before and after the user reported being signed in as Sconex Admin on Overview). The user's signed-in tab is outside any group this session can reach, so nothing was observed. No tab was opened, nothing was entered. |

### Fifth attempt — run 2026-10-27 (tab 79646198, agent's own tab group)

The agent opened `/login?next=/drive-vision/overview` in a new tab in its own group; the user signed in there by hand as Sconex Admin (the agent didn't touch the form). Evidence came from Resource Timing (path + status), the extension's network log (method + status), and a temporary in-page `fetch` wrapper that recorded only method, path, status and whether an `Authorization` header was **present**. No token, header value, cookie or body was recorded. The only write was the logout in check 9; no device command or other mutation was sent.

| # | Result | Evidence |
|---|---|---|
| 1 | **PASS** | `/api/v1/auth/login` 200 (fetch) → `/drive-vision/overview`, h1 "Good afternoon, Sconex Admin"; no "No access" text on the page. The method was not captured: network tracking started after sign-in, and Resource Timing has no method. |
| 2 | **PASS** | Login sequence: `/me` 200, then `/me/menus` 200. A read-only re-fetch of both endpoints returned `/me` 200 with envelope `{code,msg,data,total,extend}`, `role.code = PLATFORM_ADMIN`, 21 permissions; `/me/menus` 200 with 3 items (Dashboard `/dashboard` [device.read], Alarms `/alarms` [alarm.read], Reports `/reports` [report.read]). `Authorization` presence: the app's own GETs (`/alarms/ai`, `/alarms/routine` on Alerts → Refresh) logged `auth=true`. GETs with only `Accept` triggered CORS preflights (OPTIONS 200), so a non-safelisted header was attached. |
| 3 | **PASS** | Desktop sidebar has 13 links (12 original + Phase 2 Reports): Overview, Live Monitoring, Historical Video, Trips & Tracking, Reports, Vehicles & Assets, Drivers, Alerts & Events, Safety Analytics, Geofences, Device Commands, Users & Sub-Accounts, Settings. Section bar: Overview, Monitor, Fleet, Safety, Manage, Admin. At 390 px, "Open navigation" opens a drawer with the same 13 hrefs. |
| 4 | **PASS** | All BFF reads returned 200, with no "No access" panel and no 503s observed this run: Overview (`devices`, `groups`, `monitor/realtime`, `alarms/ai`, `alarms/routine`, `me/preferences`). Live Monitoring (`groups`, `reference/device-models`, `reference/object-types`, `monitor/realtime`, `devices`). Vehicles (same + `monitor/realtime?deviceIds`). Vehicle detail `/vehicles/1` "Demo Truck AP01" (`devices/1`, `reference/protocols`, `monitor/realtime`, `alarms/ai`, `alarms/routine`). Alerts (`alarms/ai`, `alarms/routine`, `devices`, `reference/alarm-types`). **Change from expected:** Users is no longer sample data — it calls `GET /users` 200 and `GET /roles` 200 and lists 4 users (Phase 2). |
| 5 | **PASS (with finding)** | Ctrl K opens "Search SafeFare AI". "veh" → Pages: Live Monitoring, Vehicles & Assets. "TS" → 4 pages, 6 sample vehicles (NL-01…NL-06), 4 sample drivers. **Finding:** the real API vehicle "Demo Truck" → "No matches": record search reads only the in-browser sample store, not the API. |
| 6 | **PASS** | "Toggle Iris assistant" button is in the header; the panel opens ("Iris AI · Rule-based · 100% local"). It answers from sample data and greets "Hi Operations", not the signed-in user. |
| 7 | **FAIL** | `/drive-vision/does-not-exist` shows Next's default black "404 · This page could not be found." **outside** the app shell (no sidebar/header); the route-guard "Page not found" panel never renders. 0 BFF requests (that part passes). Cause (from code): `src/app/drive-vision/` has no catch-all or `not-found.tsx`, so unmatched paths never reach the layout's `RouteGuard`. |
| 8 | **PASS** | F5 on `/drive-vision/overview` (navigation type `reload`): stayed on Overview; `/me` 200, `/me/menus` 200, then screen reads 200. No `/auth/refresh` (not near expiry) and no redirect to /login. Fresh document loads of other screens during check 4 also recovered the session the same way. |
| 9 | **PARTIAL — logout returned 401** | Profile menu → Sign out: **`POST /auth/logout` → 401** (expected 200). The client still cleared the session and went to `/login?next=%2Fdrive-vision%2Fdevices%2Fcommands`. Visiting `/drive-vision/overview` afterwards → `/login?next=%2Fdrive-vision%2Foverview` with **0** BFF requests. Per the spec, logout is unauthenticated and takes only `refreshToken` (the client sends `auth: false`), so the server rejected the refresh token. Cause not established. Same-origin iframe probes (responsive tests below) shared this tab's sessionStorage just before sign-out; whether they rotated the token was not checked. Needs a clean re-test: sign in → sign out with nothing else in between. |

Other observations:
- In `next dev`, the first visit to each route by sidebar click caused a full document load rather than a client transition (the navigation entry changed; the in-page wrapper was lost). Later clicks (Vehicles → detail) were client-side. Likely dev on-demand compilation; not seen in a production build, which wasn't tested.
- Device Commands subtitle still says "Configure and send terminal commands — simulated", while the list is live API data (read-only banner shown).

### Fixes and retest — 2026-10-27 (same tab 79646198, three further user sign-ins)

**Check 7 — fixed, PASS.** Added `src/app/drive-vision/[...slug]/page.tsx` (calls `notFound()`, title "Page not found") and `src/app/drive-vision/not-found.tsx`. Both render the existing guard panel, now extracted as `AccessStatePanel` in `route-guard.tsx`. `access-policy.ts` is unchanged.

| Case | Observed |
|---|---|
| Signed out, `/drive-vision/does-not-exist` | → `/login?next=%2Fdrive-vision%2Fdoes-not-exist`, 0 BFF requests |
| Admin, direct navigation `/drive-vision/does-not-exist` | Inside the shell (sidebar + header): "Page not found", "This address doesn't match a SafeFare AI page you can open.", buttons "Go to Fleet Overview" / "Sign out". Title "Page not found · SafeFare AI". BFF: only `/me` 200 and `/me/menus` 200 |
| Same, F5 reload (navigation type `reload`) | Same panel and requests; no redirect |
| Admin, `/drive-vision/vehicles/1/nope` (unmatched path under an allowed screen) | Same panel via `not-found.tsx`; BFF only `/me`, `/me/menus` (no `devices/1`). Cosmetic: the shell's page header still shows "Vehicles & Assets" with breadcrumb "Fleet › Vehicles & Assets › Vehicle details" above the panel |
| Valid Admin route `/drive-vision/users` | Renders; `/users` 200, `/roles` 200 |
| Permission-denied state | **Not browser-tested** — only a `PLATFORM_ADMIN` account is available. Covered by unit tests: `tests/not-found-route.test.cjs` (an unmapped role on `/drive-vision/users/nope` → `no-role` panel, so the not-found page never mounts) and the existing `access-policy` / `auth-access` tests |
| HTTP status | 200 in both `next dev` and `next start` (port 3100, then stopped). The body carries Next's streamed `NEXT_HTTP_ERROR_FALLBACK;404`. Per Next's docs, streamed responses keep 200; a real 404 needs a Proxy check before streaming. Not done (the app is behind sign-in). Unmatched non-app paths (`/totally-unknown`) return 404 |

**Check 9 — investigated, fixed, PASS.**

1. Clean run (fresh sign-in → Overview → Sign out; no other pages, no iframes; sanitized recorder): `POST /auth/logout` → **401**, envelope `code 401`, `msg "Authentication required"`, `data null`. Body keys `[refreshToken]`, 64 characters, equal to the stored session's refresh token. No `/auth/refresh` had run, so it was the token the login issued; it expires 2026-11-10. `Content-Type: application/json`. **No `Authorization` header**, because the client sent logout with `auth: false`. The refresh-token contract was satisfied; the server wanted authentication.
2. Login response (sanitized): fields `accessToken, tokenType, expiresIn, refreshToken, refreshExpiresIn, user`; `expiresIn` 900 s (15 min access token), `refreshExpiresIn` 1 209 600 s (14 days), opaque (non-JWT) refresh token.
3. Live spec `/v3/api-docs`: global `security: [bearerAuth]`, and **no operation overrides it** (not even login). `docs/api-inventory.md` said login/refresh/logout were exempt, which the spec doesn't say. Corrected.
4. Fix (`auth-service.ts`, `client.ts`): logout now gets the session via a new `usableSession()` (re-reads storage, refreshes first if the access token is near expiry) and sends `POST /auth/logout` **with** the bearer token and that same session's refresh token. Local sign-out still always happens.
5. Clean retest with the new code (confirmed loaded — the served chunk contains `usableSession`, not the old `auth: false` call): **`POST /auth/logout` → 200**, `code 200`, `msg "Success"`, `data null`. Bearer present and equal to the stored access token; body refresh token equal to the stored one; session key removed from sessionStorage; → `/login?next=%2Fdrive-vision%2Foverview`. `/drive-vision/users` afterwards → `/login?next=%2Fdrive-vision%2Fusers`, 0 BFF requests.
6. The first fifth-attempt 401 is explained the same way: the request had no bearer token. Whether the server now actually revokes the refresh token was not tested: re-using a spent token would need its value, which the client discards.

Side notes: the first of these sign-ins hit `401 "Invalid credentials"` once before succeeding (form entry). In `next dev`, a `POST /__nextjs_original-stack-frames` (dev-overlay symbolication) followed both a sign-in and a sign-out. The console log reset with the navigation, so its source wasn't captured; no error panel was visible.

**Users filter row — fixed.** `users-page.tsx`: below `sm` the filter bar is full width, search takes its own row (`max-sm:basis-full`) and the two selects share the next one (`max-sm:flex-1`). `sm` and up are unchanged. Measured (same-origin frames; viewport set to the exact CSS width — 391 for the 390 run because of scrollbar rounding):

| Width | Search (x, width) | Any status | Any role | Overlap | Page overflow-x |
|---|---|---|---|---|---|
| 360 | 16–344, 328 px, row 1 | 16–176, row 2 | 184–344, row 2 | none | 0 |
| 390 | 16–375, 359 px, row 1 | 16–192, row 2 | 200–375, row 2 | none | 0 |
| 768 | 88–344, 256 px | 352–496, same row | 504–648, same row | none | 0 |
| Desktop (1405 px viewport) | 825–1081, 256 px | 1089–1233, same row | 1241–1385, same row | none | 0 |

**Automated (after all fixes):** `npm run typecheck` pass · `npm run lint` pass · `npm test` **64/64** (59 + 4 in new `tests/not-found-route.test.cjs` + 1 new logout test in `auth-access.test.cjs`; the existing sign-out test now also asserts 200, bearer present and the current refresh token sent; the fake BFF requires a bearer token on logout like the real one) · `npm run build` pass. There's no DOM/layout test harness (tests run TS in a Node `vm`), so the Users layout is verified in the browser only.

**Phase 1B status: COMPLETE for the Admin role.** Checks 1–9 pass (7 and 9 after the fixes above). Open items that don't block the Admin checks:
- The permission-denied panel is unit-tested only (no non-admin account).
- Unknown routes return HTTP 200 with a streamed 404 fallback.
- Record search doesn't include API vehicles.
- Iris greets "Operations".
- A screen's header shows above the not-found panel on unmatched sub-paths.

## Phase 2 — browser results (2026-10-27, same session, read-only)

Desktop = 1600 CSS px window. The window could not be resized (Chrome kept 1600 CSS px), so 360 / 390 / 768 were tested in a same-origin iframe, inside the same tab, whose viewport was set to exactly that CSS width (scrollbar compensated). Each row records: page renders with no "No access"/login redirect, all BFF reads 200, `scrollWidth − clientWidth`, and elements past the right edge outside scroll containers.

| Screen | BFF reads (all 200) | Desktop | 768 | 390 | 360 |
|---|---|---|---|---|---|
| Reports `/reports` | `reports/mileage`, `devices`; empty state "No mileage records"; NOT_LINKED_TO_VENDOR banner | pass | pass (sidebar) | pass (mobile header) | pass |
| Historical Video `/video` | `devices`; after choosing Demo Truck AP01: `devices/1/recording-calendar`, `devices/1/recordings`, `video/exports` (1 pre-existing REQUESTED job from 24 Oct; none created) | pass | pass | pass | pass |
| Geofences `/geofences` | `geofences`, `groups`, `devices`; "Demo Depot North" drawn on MapTiler map | pass | pass | pass | pass |
| Device Commands `/devices/commands` | `commands/types`, `devices`, `commands` (1 INSTANT_SHOT PENDING, 24 Oct; none sent) | pass | pass | pass | pass |
| Users `/users` | `users`, `roles`; 4 users | pass | pass | **overlap** → fixed, pass | **overlap** → fixed, pass |

Horizontal overflow was 0 on every screen at every width.

**Defect (fixed later the same day — see "Fixes and retest") — Users filter row at ≤ 390 px:** the search input (x 16–93) is overlapped by the "Any status" select (starts x 48 at 360 px, x 78 at 390 px). The search field is a 77 px sliver and the select's "Any" label is hidden. At 768 px they sit side by side (search 88–344, status 352–496).

Not tested in Phase 2: write paths (user create/edit/status/unlock/password, geofence delete, video export request, command send, transfer); Hierarchy and Roles & permissions tabs; other Reports tabs (Driving/Parking/Media).

## Phase 2 — automated results (2026-10-27)

At the time of these runs there was no browser session (same blocker); browser results were added later — see "Phase 2 — browser results" above. Automated checks after the Phase 2 changes:

| Check | Result |
|---|---|
| `npx tsc --noEmit` | pass (exit 0), after all changes |
| `npm run build` | pass — 21 routes incl. new `/drive-vision/reports`, after all changes |
| `npm test` | 59/59 pass (44 existing + 15 new in `tests/phase2-models.test.cjs`) — run before the final deletion of the unused `video/demo-feed.tsx`; not re-run afterwards (tool safety check unavailable). No remaining references to the deleted file. |
| `npm run lint` | pass — same timing as `npm test` |

No mutation (user create/edit/status/unlock/password, geofence delete, video export, command, transfer) was sent to the BFF during development.

Previously browser-verified (Phase 1A): unauthenticated `/drive-vision/users` → `/login?next=%2Fdrive-vision%2Fusers`, 0 BFF requests.
