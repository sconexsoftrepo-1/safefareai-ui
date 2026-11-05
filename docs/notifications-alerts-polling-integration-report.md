# Notifications and Alerts Polling Integration Report

**Status:** implemented and tested against mocked responses. Not verified with a real login. Nothing is committed.

**Date:** 2026-11-04

**Contract:** `docs/contracts/polling-apis.txt` (a copy of `polling-apis.txt`)

## Was live backend verification performed?

**No.** No authenticated request was made to the backend, and no notification or alert was read or changed on it.

| Level | What was done |
|---|---|
| **Mocked** | Every `/api/v1` response was synthetic, written from the contract. It proves the frontend follows the document, not that the backend behaves that way. |
| **Live spec only** | The public `/v3/api-docs` on `185.193.19.156:9096` was read. It lists `/notifications/poll`, `/alerts` with `kind` and `/notifications/read-all` with `type`. A listing shows what is documented, not how it behaves. |

Every test result and screenshot in this report is mocked.

## APIs integrated

| API | Used for | Timing |
|---|---|---|
| `GET /notifications/poll?limit=20` | Bell badge, AI Events and Alarm tabs | Every 5 s while signed in |
| `GET /alerts?kind=AI&openOnly=true&...` | AI events tab | Every 5 s while open and visible |
| `GET /alerts?kind=ROUTINE&openOnly=true&...` | Routine alarms tab | Every 5 s while open and visible |
| `GET /alerts?openOnly=true&...` | Incidents tab | Every 5 s while open and visible |
| `GET /alerts/{id}` | Alert detail drawer | On click, never polled |
| `GET /notifications` | See more and the All tab | On open, page change or action |
| `POST /notifications/{id}/read` | Mark read, or click a notification | On action, no body |
| `POST /notifications/{id}/unread` | Mark unread | On action, no body |
| `POST /notifications/read-all?type=` | Mark all read in a tab | On action, no body |
| `GET /alarms/ai`, `GET /alarms/routine` | History view | On open, filter change or Refresh only |

`GET /notifications/poll` and `read-all?type` are not in the V10 spec, so they are declared as off-spec in `tests/v10-contract.test.cjs`. The OpenAPI files were not changed. `GET /alarms/routine/recent` has no screen and is not called.

## Polling architecture

| Piece | Role |
|---|---|
| `hooks/poller.ts` | The loop. No React, so its timing is unit-tested with a controlled clock |
| `hooks/use-polled-query.ts` | React wrapper, with the same return shape as `useApiQuery` plus `stale` |

How each rule is met:

| Rule | How |
|---|---|
| 5-second interval | The first request is immediate, then a timer of 5 s after each response |
| No overlap | The next timer is set only when a request finishes, so there is no `setInterval` |
| Hidden tab | No timer runs. A request already open finishes |
| Visible again | One request at once, then the normal pace |
| Stop on logout or session end | `onSessionEnded` stops the loop and unmounting cleans up |
| Cleanup | The timer and listener are removed and the request aborted with `AbortController` |
| Strict Mode | Each mount owns one poller, and cleanup aborts it |
| One loop | A new key or tenant starts a new poller and stops the old one |
| No needless renders | An identical response keeps the same state object, so React doesn't render |

**Lists don't flash.** `DataTable` shows a skeleton while `isLoading` is set, so polls never set it. In the browser the same table element survived 11 seconds of polling.

**A fixed `to` would hide new alerts.** The old query fixed `to` when the page loaded, so nothing newer could ever appear. Live queries never send `to`, and they rebuild `from` on every poll. The default 7-day range sends neither, which matches the documented request exactly.

## Screens

### Notification bell

- The badge uses `unreadTotal`, and the tabs use the two tab counts. `unreadTotal` also counts other types, so it can be higher than the tabs add up to.
- Every row in the AI Events and Alarm tabs shows the unread dot.
- The time is `details.vendorAlarmTime` as sent, or `createdAt` in the user's zone if there is no `details`.
- Clicking a notification marks it read, re-polls, then opens the alert. If the read fails, it shows an error and doesn't navigate.

**Added: an All tab.** The poll only returns AI Events and Alarm. Drivers and others also receive dispatch, leave and sensor notices, which the bell showed before, so without this tab they would have disappeared. All uses `GET /notifications`.

### Alerts & Events

- All three tabs now use the live list and the existing workflow drawer. No new screen was added.
- Rows show device, terminal number, alarm name, local alarm time, severity and handling status.
- Severity now shows the documented names (Severe, Moderate, General, Notice) instead of a raw number.
- The drawer adds severity, device, terminal and alarm time to what it already showed.
- If alerts close and the current page no longer exists, the list steps back to the last page.

**Added: a Live / History switch on the AI and Routine tabs.** These tabs used to read the vendor APIs, which must not be polled. Live is now the default. History keeps the old view with its image and video links, and calls the vendor only when opened, on a filter change or on Refresh. Nothing was removed.

**Filters sent:** `kind`, `openOnly`, `from`, `alarmTypeIds`, `deviceIds`, `keyword`, `pageNumber` and `pageSize`. The screen has no controls for `status`, `severity`, `driverId` or `assigneeUserId`, so they are not sent.

**Time zone.** The app's formatters are pinned to IST. Alert lists, the drawer and notifications now use a new browser-local formatter. Other screens are unchanged.

## Permission and tenant handling

| User | Bell | Alerts | History |
|---|---|---|---|
| Tenant user with `alarm.read` | Polls own notifications | Polls own tenant, no `X-Tenant-Id` | Works |
| Tenant user without `alarm.read` | Polls | Screen denied, 0 alert requests, no 403 shown | Denied |
| Safe-Fare Admin, no tenant | Polls, stays empty, nothing invented | All tenants, no header | Asks for a tenant, 0 vendor calls |
| Safe-Fare Admin, tenant selected | Polls, no header | That tenant, with `X-Tenant-Id` | Works, with the header |

Tenant handling reuses the existing client and tenant context, and tenant isolation rules did not change. The tenant is part of the poll's key, so a switch can't show the old tenant's data.

## Error handling

| Response | Behaviour |
|---|---|
| 401 | The existing client refreshes and retries, and polling continues. If the refresh is refused, the session ends and polling stops |
| 400, 403, 404 | The loop stops, because repeating won't help. A filter change or Retry starts it again |
| Network error, timeout, 5xx | Data stays, a quiet "Couldn't refresh" note appears, and the next cycle retries |

The login and token-refresh code was not changed.

## Tests executed and results

| Check | Result |
|---|---|
| Full test suite | **594 of 594 pass** (547 before this work) |
| TypeScript (`tsc --noEmit`) | Pass |
| Lint (`eslint .`) | Pass |
| Production build | Pass |
| Contract checks (`v10-contract`, `access-v10`) | Pass |
| Mocked browser run | 35 of 35 recorded checks pass |

The new tests are in `tests/notifications-alerts-polling.test.cjs`. Timing uses a controlled clock, and requests go through the real API client with a stubbed `fetch`.

**Existing tests changed:**

| File | Change |
|---|---|
| `alerts-model.test.cjs` | The view has a new `history` field |
| `v10-contract.test.cjs` | New off-spec call, query parameter and `details` field declared |
| `helpers/v10-contract.cjs` | A literal `undefined` argument is no longer treated as a request body. The runtime test confirms no body is sent |

## Browser testing evidence

Mocked, in headless Edge on the production build. Files are in `docs/evidence/screenshots/notifications-alerts-polling/`, with `results.json` and the script `cdp-poll.cjs.txt`.

| Requirement | Result |
|---|---|
| Bell and AI polling | Exactly 5.0 s apart |
| Routine polling | Documented request sent on the Routine tab |
| New alert while open | Badge and first row updated with no reload |
| No overlap | With a 7 s server, the gap was 12 s |
| Hidden tab | 0 requests in 11 s |
| Visible again | Requests within 400 ms |
| Vendor APIs | 0 calls in Live; 0 while idle in History; only on open and Refresh |
| Leaving Alerts | 0 alert requests; the bell continues |
| Navigating back and forth | Still one loop, 5.0 s apart |
| Logout | 0 requests afterwards |
| Token refresh | 1 refresh, polling continued, page kept |
| Refused refresh | Ended at `/login`, 0 requests afterwards |
| Network error and 503 | Rows and badge kept, note shown, recovered |
| Server 403 | 0 further requests |
| Read, unread, read-all | Correct requests, no body, counts updated at once |
| Time zone | In emulated New York, `04:20:54Z` showed as `03 Nov, 23:20:54` |
| Strict Mode | On a dev server: 4 polls per query in 21 s, 5 s apart, so one loop each |

Layouts were checked at 1366, 768 and 390 px with no page overflow. At 390 px the Severity and Status columns need a sideways scroll inside the table.

**Bugs the browser run found, now fixed:** See more, the All tab and the Safe-Fare Admin's empty bell rendered blank, from an operator-precedence mistake that TypeScript can't detect. History also still showed IST times, and the page said "ai events". A regression test now covers the blank panel and the label.

The Strict Mode run used the `npm run dev` server already running on port 3000, loaded in a separate headless browser with all API calls mocked. That server was left running.

## Remaining backend dependencies

1. **Live verification.** Needs a real login on an approved test tenant.
2. **Safe-Fare Admin alert detail.** The contract says `GET /alerts/{id}` answers 404 if the alert doesn't exist "in this tenant". It doesn't say what happens with no tenant selected, so opening an all-tenant row may fail. Needs confirming.
3. **Evidence links.** Placeholder hosts are deliberately not linked, so real media URLs need checking.
4. **Tenants with over 100 active devices.** The contract says History returns 400 without `deviceIds`. The error would show, but the screen doesn't send them automatically.
5. **Assigning alerts.** Still not offered, because `POST /alerts/{id}/assign` has no assignee field in the spec.

## Things to review

- **Request volume.** On the AI or Routine tab, each open browser sends 3 requests every 5 seconds: the bell, the list, and the other tab's total for its count badge. Dropping that badge would make it 2.
- **Safe-Fare Admin polling.** The bell polls although the answer is always empty, as specified. Skipping it for that user would remove pointless traffic.
- **Other vendor callers.** Fleet Overview and Vehicle Detail also call `/alarms/*`. They run once on open, never on a timer, but they can fetch up to 5 pages of each kind. They also have no tenant check, so a Safe-Fare Admin with no tenant may get errors there. Those screens were left unchanged.
- **Vendor time.** `vendorAlarmTime` is shown as sent, as specified, so a user outside the vendor's zone sees a different time in the bell than on the Alerts screen.

## Known limitations

- See more and All lists update after an action, not on a timer.
- An open alert drawer doesn't update by itself, as required.
- "5 min ago" updates when the list changes, not on every poll.
- The Today filter starts at midnight fleet time (IST), as before.
- Only Edge was tested.

## Files changed

**Added**

| File | Purpose |
|---|---|
| `src/features/drive-vision/hooks/poller.ts` | The polling loop |
| `src/features/drive-vision/hooks/use-polled-query.ts` | React hook |
| `src/components/drive-vision/app-shell/notifications-model.ts` | Pure bell logic |
| `tests/notifications-alerts-polling.test.cjs` | New tests |
| `docs/contracts/polling-apis.txt` | The contract |

**Changed**

| File | Change |
|---|---|
| `app-shell/notification-center.tsx` | Polling, tabs, See more, actions |
| `alerts/alerts-page.tsx` | Live and History views |
| `alerts/incidents.tsx` | Live list for all tabs, drawer additions |
| `alerts/alerts-model.ts` | Live query, severity names, History in the URL |
| `alerts/event-detail-drawer.tsx` | Local time, severity names |
| `api/alert-service.ts`, `api/types-operations.ts` | Poll call, `read-all` type, DTOs |
| `utils/format.ts` | Browser-local formatter |

No backend code or OpenAPI file was changed. Nothing was committed or pushed, earlier uncommitted work is intact, and no next phase was started.
