# Role-Based Landing Report

**Status:** fixed and tested on mocked data. Not yet verified with live accounts. Nothing is committed.

**Date:** 2026-11-05

**Mocked versus live.** Every test and browser result here is mocked. The browser run used the real login form on the production build, with synthetic accounts, and every `/api/v1` response was answered locally. No live account was used and nothing reached the backend.

## Root cause

**A sign-out left the previous account's page in the login URL, and that page beat the correct default.**

1. A Driver signs out on `/drive-vision/my-work`.
2. `AuthGate` treated this like any unauthenticated visit and went to `/login?next=/drive-vision/my-work`.
3. The Safe-Fare Admin signed in on that URL.
4. `LoginScreen` used `requested ?? defaultLanding(access)`, so the Driver's `next` won, with no access check.
5. The admin arrived on My Work and saw access denied.

The default was not the fault: `defaultLanding` already put platform admins first. That is why a hardcoded route was not the fix.

With the old "requested wins" line restored temporarily, 5 tests failed, including the Driver-to-Admin case. They passed again once the fix was back.

### Other problems found

| Problem | Fix |
|---|---|
| `/` and `/drive-vision` were server redirects to Fleet Overview, before the app knew who was signed in. An admin with a restored session reached Fleet Overview, not Platform Overview | `/` goes to `/drive-vision`, which resolves in the browser once permissions load |
| A Driver holding `device.read` would land on Fleet Overview | Drivers are checked before Fleet Overview |
| An account with no screen saw "Page not found" at `/drive-vision` | It now sees the no-access state |
| A page removed by a permission re-read left the user on a denied page | They move to their default |

### Stored state checked

| Item | Result |
|---|---|
| `?next=` in the login URL | **The cause.** Fixed |
| Last-visited or default route | None stored |
| Preferences in localStorage | Hold no route |
| API query data | No shared cache that could cross accounts |
| Tenant selection | Already cleared on each new session |

## Resolver

`defaultLanding(access)` in `access-policy.ts` is the single answer. It runs only after authentication and permissions have loaded.

| Order | Condition | Destination |
|---|---|---|
| 1 | Platform screen open: `platform === true` and `tenant.all` | Platform Overview |
| 2 | Role `DRIVER` and My Work open | First driver section the user can read; My Work if none is readable |
| 3 | Fleet Overview open | Fleet Overview |
| 4 | Otherwise | First screen in the server's menu that the user can open |
| 5 | Otherwise | First allowed screen in route order |
| 6 | Nothing | No destination: the no-access state |

Fleet Owner has no special rule. `FLEET OWNER` reaches Fleet Overview through its `device.read` permission at step 3, so no role name is matched there. If that permission is missing, step 4 applies.

## Routes used

| User | Screen | App route | Backend `routePath` |
|---|---|---|---|
| Safe-Fare Admin | Platform Overview | `/drive-vision/platform` | None mapped; the app's own route is used |
| Fleet Owner | Fleet Overview | `/drive-vision/overview` | `/dashboard` |
| Driver | My Work | `/drive-vision/my-work` | `/driver/work` |

No route or screen was added. `/driver/work` is the backend's path; the existing map sends it to the app route.

## Access checks

- A requested path only counts if this user can open it (`postLoginRoute`). Otherwise their own default applies.
- Platform access uses the boolean `platform` field. A tenant `ADMIN` is not treated as a Safe-Fare Admin.
- The role-permission matrix is not used.
- Platform Overview needs no selected tenant.
- A denied deep link stays denied, on its own URL, with no redirect and no loop.
- Route guards were not weakened. Every destination still passes the same check.

## Session switching

| Situation | Behaviour |
|---|---|
| Sign-out | Goes to a clean `/login`, with no `next` |
| Sign-out, then another account | That account's own default |
| Old `/login?next=` link | Used only if the new user can open it |
| Session expires, same user signs in | Returns to their page |
| Session expires, different account signs in | Their own default, even if they could open that page |
| Same user id in another tenant | Treated as a different account |
| Not signed in, deep link | Kept through sign-in if the user can open it |

To tell an expired user from a new one, the app records the expired account's tenant and user id in that tab's `sessionStorage`. It holds no token. Sign-out clears it.

## Refresh

- Reloading the page keeps a valid route.
- After a token refresh, permissions are re-read. A route that is still open is left alone.
- If the route the user had open is no longer allowed, they move to their default.
- A page that was never allowed stays denied, so this can't loop.

## Test results

| Check | Result |
|---|---|
| Full test suite | **795 tests: 793 pass, 0 fail, 2 todo** |
| New `tests/role-based-landing.test.cjs` | 40 pass |
| TypeScript, lint, production build | Pass |
| Contract checks (`v10-contract`, `access-v10`) | 102 of 102 pass |
| Mocked browser run (headless Edge) | All scenarios behaved as expected |

The 2 `todo` tests are from an earlier round and don't relate to this work. Session-switching tests run the real client and auth store. No existing test needed changing.

## Browser verification (mocked)

Evidence is in `docs/evidence/screenshots/role-based-landing/`: 11 screenshots, `results.json` and `cdp-role-based-landing.cjs.txt`.

**Account switching.** On one tab: Driver, Safe-Fare Admin, Fleet Owner, Driver, at 1366, 768 and 390 px. That is 12 sign-ins, each following a different account.

| Check | Result |
|---|---|
| Landing page | Correct in all 12 |
| Navigation after sign-in | None passed through another account's route |
| Page refresh | Stayed on the landing page |
| Another permitted page | Opened |
| Sign-out | Clean `/login` every time |
| Page overflow | None |

**Other scenarios, at 1366 px:**

| Scenario | Result |
|---|---|
| `/` and `/drive-vision` with a session | Each of the three accounts reached its own default |
| Admin opens Fleet Overview on purpose | Stays there |
| Back, then Forward | Correct pages |
| Admin deep link to My Work | Denied, same URL, no loop |
| The exact stale URL from the bug | Admin reached Platform Overview |
| Signed out, deep link to Alerts | Fleet Owner reached Alerts after sign-in |
| Driver's session expires, admin signs in | Platform Overview |

## Remaining limitations

- **Live accounts.** Not tested. The bug was reproduced through tests, not on your server.
- **Flash of the wrong screen.** Checked from the sequence of navigations and from code that renders nothing while resolving, not frame by frame. At `/drive-vision` the app shell can show briefly with empty content.
- **Route taken away after a token refresh.** Covered by unit and source tests only, not the browser run.
- **Same-tab record.** The expired-account record is per tab, so an expired page opened in a new tab relies on the access check alone.
- **Accounts with only Settings.** Anyone holding any permission can open Settings, so that can be their landing page. This follows the existing access rule.
- **Screens in the server menu.** Step 4 uses the menu order only for screens this app maps.

## Before release

With approved live accounts:

1. Sign in as a Driver, sign out, then sign in as Safe-Fare Admin on the same tab. Confirm Platform Overview.
2. Sign in as a Fleet Owner. Confirm Fleet Overview and the correct tenant.
3. Sign in as ADMIN, OPERATOR, DISPATCHER and VIEWER. Confirm each destination is suitable.

Nothing was committed, pushed, reset or discarded. Backend code and the OpenAPI specification were not changed.
