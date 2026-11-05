# Alert Evidence Media Popup Report

**Status:** implemented. Real vendor media from alert 900 displays and plays. **Download through the app is blocked by the vendor host, and real fullscreen is still not verified.** Nothing is committed.

**Date:** 2026-11-05

## How to read the evidence

| Level | What it means here |
|---|---|
| **Mocked, real files** | The image and video were generated in the browser and really decoded, played and saved. They came from a made-up `media.gpstracktech.com`, answered locally. |
| **Simulated** | A stand-in replaced the browser's fullscreen, so only the app's wiring was tested. |
| **Live** | One unauthenticated request to the vendor's player host, to read its headers. |
| **Real vendor media** | **Alert 900's two real files**, loaded from `y.gpstracktech.com` on 2026-11-05 through the real popup. The API response was mocked from your brief, so no authenticated API call was made. |

## What changed

Open now shows evidence in a popup on top of the alert drawer, with no new tab. Both places that show evidence changed:

| Where | Fields |
|---|---|
| Incidents drawer | `GET /alerts/{id}` → `evidence[]`: `mediaType`, `url`, `status`, `channel`, `contentType`, `sizeBytes` |
| AI and Routine history drawer | `imageUrl`, `videoUrl` on the alarm row |

### Files

| File | Change |
|---|---|
| `alerts/evidence-model.ts` | New: link checks, states, filenames, failure diagnosis, download |
| `alerts/evidence-viewer.tsx` | New: the popup, built on the existing dialog |
| `alerts/incidents.tsx`, `alerts/event-detail-drawer.tsx` | Open buttons and the popup |
| `alerts/alerts-model.ts` | Removed `safeMediaUrl`, now unused |
| `config/security-headers.ts` | Media hosts and their use in the report-only CSP |
| Theme, `globals.css` | `--dv-media-stage`, the dark video background |
| `.env.example` | `NEXT_PUBLIC_EVIDENCE_MEDIA_HOSTS` |
| `tests/alert-evidence-viewer.test.cjs` | New: 52 tests |
| `tests/fixtures/alert-900.json` | New: the supplied alert 900 response |
| `tests/alerts-model.test.cjs`, `tests/final-audit-fixes.test.cjs` | Removed the `safeMediaUrl` test; the CSP test now expects the media hosts |

## The URL availability rule

**A valid URL decides whether evidence can open. The status never does.**

The first version blocked `PENDING` rows. That was wrong: it treated a backend status as a fact about the file. Alert 900 has real, playable files on rows still reported `PENDING`.

| Status | URL | Open | Shown |
|---|---|---|---|
| READY | Present | Enabled | `READY · URL available` |
| PENDING | Present | Enabled; tries to load | `PENDING · URL available` |
| FAILED | Present | Enabled; tries to load | `FAILED · URL available` |
| Any other value | Present | Enabled | Status as sent, `URL available` |
| PENDING | Missing | Disabled | Waiting for link |
| READY | Missing | Disabled | Link missing, as an error |
| FAILED | Missing | Disabled | No link |

Three things are kept apart:

| Fact | Source | Effect |
|---|---|---|
| Processing status | The backend | Shown exactly as sent. Never changed, and never marked READY |
| URL availability | The row's `url`, checked for scheme and host | The only thing that decides Open |
| Whether the file loads | Trying it | Shows the media or the failure |

The status stays visible in the popup, even once the media loads. If loading fails on a `PENDING` or `FAILED` row, the error adds what the server reports. For example: "The server still reports this as PENDING, so the file may not be available yet."

Host validation is unchanged: a `PENDING` row on an unapproved host still can't open. Both drawers share this one rule, and neither has a status check of its own. AI and Routine alarm rows have no status field, so a usable URL has always decided there.

## Download needs a backend change

**Confirmed on the real files.** The vendor host sends no CORS headers, so the app can't save them. Viewing isn't affected, because `<img>` and `<video>` don't need CORS.

Download stays visible. On this host it fails clearly and saves nothing:

- **Image:** "The media server doesn't allow this app to download files, so nothing was saved. Right-click the image and choose Save image as."
- **Video:** the same, ending "Try the ⋮ menu on the player."

Those two suggestions use the browser's own features and bypass nothing. The ⋮ menu's Download option was not clicked in testing, which is why the message says "Try".

See [Backend changes needed](#backend-changes-needed).

## Other media hosts

`gpstracktech.com` and its subdomains, the API host, and `NEXT_PUBLIC_EVIDENCE_MEDIA_HOSTS` are allowed. The real host, `y.gpstracktech.com`, is covered, so **no configuration is needed for alert 900**. Any other host shows "Host not approved: <host>" until it is added and the app is rebuilt.

## Image popup

- Centred, aspect ratio kept, not cropped, fitted to the space.
- Zoom in, zoom out, fit to screen, from 100% to 400%.
- States: loading, loaded, not found, access denied, network problem, format not supported, and an honest unknown. Each error has Try again.

## Video popup

- Native `<video>` with `controls`, `playsInline` and `preload="metadata"`. No autoplay.
- Native controls give play, pause, seek and volume. A separate speed control offers 0.5× to 2×.
- Dark background. States: connecting, ready, playing, paused, buffering, finished.
- If `contentType` is known and the browser says it can't play it, the popup says so and names the type.
- Closing stops playback and releases the file.

## Link safety

- **The URL stays exactly as sent.** The old drawer code re-encoded links, which can break a signature.
- The media element is only ever an `<img>` or `<video>`. Nothing new is framed.
- Refused: other schemes, placeholder hosts, unapproved hosts, and `http` links on an `https` page.
- URLs aren't logged or stored, and no app token is sent. Images and fetches send no referrer. A `<video>` can't set that, so it sends the app's origin.

| Row | Result |
|---|---|
| No URL | Disabled Open, with a note |
| Unusable link | Disabled Open, "Link not usable" |
| Unapproved host | Disabled Open, naming the host |
| Type the viewer can't show, such as audio | Keeps its existing new-tab link, so nothing is lost |

Each row opens on its own, so several images or videos on one alert work.

## Why a failure is sometimes vague

`<img>` and `<video>` don't reveal HTTP status. After a failure the app makes one small request to find out.

- If the host allows it, the message is exact: not found, or access denied.
- If CORS hides it, the message says the server doesn't let the browser see the reason.

**On the real vendor host, CORS hides it.** So a failed load there can't say 403 or 404. The message says the link may have expired, the file may be gone, or the connection failed, and Try again is offered. It can't be more exact without the CORS change below.

A signed link that expires usually returns 403, so denied and expired are worded together. Alert 900's URLs carry no signature or expiry parameter.

## Fullscreen

Uses the Fullscreen API on the media and toolbar area, so the controls stay available.

- The button only changes on the browser's `fullscreenchange` event, so it can't show the wrong state.
- In fullscreen, Escape leaves fullscreen and does not close the popup.
- Closing the popup leaves fullscreen.
- Without the API, the button is disabled and explains why. iPhones use their native video fullscreen.

**Not verified in a real browser.** In this automated Edge, `requestFullscreen()` never finished, even on a bare element with none of this code, both headless and in a visible window. The iPhone path also wasn't run.

## Download

| Case | Behaviour |
|---|---|
| Same-origin file | Direct download |
| Cross-origin, CORS allowed | Fetched, then saved through a Blob URL, which is revoked afterwards |
| Video, in a browser with a save dialog | Streams to disk, so it isn't held in memory |
| Over 200 MB with no way to stream | Fails with a clear message and loads nothing |
| Size unknown, no save dialog | Held in memory: a risk for large videos |
| CORS refuses | Clear message; nothing is claimed |
| Link expired or refused | Clear message |

- A plain `<a download>` isn't used cross-origin, because the browser ignores the attribute and would navigate the app away.
- The filename extension comes from the file, then the row, then the link. With none, there is no extension rather than a guess.
- Alerts with several items add the row id, such as `alert-501-evidence-2.webm`.
- "Download started" means the browser accepted the file. The app can't see it finish.
- Native video controls may offer their own Download in the ⋮ menu.

## Supported formats

The browser decides.

| Format | Result |
|---|---|
| Real alert 900 image: JPEG | Displays |
| Real alert 900 video: MP4, **H.264**, no audio track | Plays |
| PNG, WebM | Tested with generated files |
| H.265 | This Edge reports it can't play it. If it appears, the popup says "Format not supported" with the type |

One alert is only one sample, so another device could record differently. The video has no sound because the file has no audio track.

## CORS findings

Checked on alert 900's real files, 2026-11-05:

| Check | Image | Video |
|---|---|---|
| `GET` with `Origin`, `Range: bytes=0-0` | 206 | 206 |
| `Content-Type` | `image/jpeg` | `video/mp4` |
| Size | 296,145 bytes | 1,125,176 bytes |
| `Access-Control-Allow-Origin` | **Absent** | **Absent** |
| Preflight `OPTIONS` | **403** | **403** |
| `Accept-Ranges` | `bytes` | `bytes` |
| `Content-Disposition` | Absent | Absent |

**Effects:** viewing and seeking work. Download through the app doesn't, and failure reasons stay general.

## Backend changes needed

Not made, and no endpoint was invented.

**Needed for Download, one of:**

1. **CORS on the media host:** allow GET from the app's origin, and expose `Content-Type` and `Content-Length`. This also gives exact 403 and 404 messages. Videos then stream to disk where the browser supports it.
2. **An authenticated backend download endpoint** that streams the file with `Content-Disposition: attachment`. It wouldn't depend on the vendor, but failure messages would stay general unless CORS is also added.

**Worth confirming:**

3. **Why these rows stay `PENDING`.** Alert 900's files were on the vendor by 2026-11-04 04:21 UTC, and the row still reports `PENDING`. The status may not be updating, or `PENDING` may mean something else. The screen no longer depends on it.
4. **The list of row `status` values.** The contract only shows `PENDING`.
5. **`contentType` and `sizeBytes` on evidence rows.** They allow a clear format message before loading.
6. **Whether vendor links stay valid.** Alert 900's links have no expiry parameter, but that doesn't prove they are permanent.
7. **Whether other devices record H.265.** One H.264 file doesn't settle it.

## Tests and results

| Check | Result |
|---|---|
| Full test suite | **862 tests: 860 pass, 0 fail, 2 todo** |
| `tests/alert-evidence-viewer.test.cjs` | 52 pass |
| TypeScript, lint, production build | Pass |
| Contract checks (`v10-contract`, `access-v10`) | 102 of 102 pass |
| Mocked browser run (headless Edge, production build) | All scenarios behaved as expected, except that fullscreen was simulated |
| Real vendor media run | Image and video worked; Download was refused by the host, as expected |

The 2 `todo` tests are from an earlier round.

### Real vendor media (alert 900)

Run through the real popup on the production build. Results are in `results-real-vendor.json`.

| Check | Result |
|---|---|
| Rows | `IMAGE · PENDING · URL available`, `VIDEO · PENDING · URL available`, both with Open enabled |
| Image | Displayed, 1280×720, exact URL |
| Video | 720×576, 10.98 s, exact URL, no autoplay |
| Playback | Played and advanced, with no error |
| Status in the popup | `PENDING` on both, unchanged |
| Download, image and video | Refused, with the clear message; nothing saved |
| New tabs from the app | 0 |
| Drawer afterwards | Still open, same page URL |

**No screenshots of real media were saved**, because it is real fleet footage and may show real people. The run records measurements only. The codec was read from a temporary copy of the video, which was deleted straight away.

### Regression tests for this change

| # | Requirement | Result | Level |
|---|---|---|---|
| 1 | PENDING image with URL: Open enabled | Pass | Real file and unit test |
| 2 | PENDING video with URL: Open enabled | Pass | Real file and unit test |
| 3 | READY image with URL | Pass | Mocked |
| 4 | READY video with URL | Pass | Mocked |
| 5 | PENDING without URL: disabled | Pass | Mocked |
| 6 | FAILED with URL: can be attempted | Pass | Mocked |
| 7 | 403 and 404 | Pass, with the PENDING explanation | Mocked. Real host hides the status |
| 8 | Network failure, then Retry | Pass: failed, then loaded | Mocked |
| 9 | Image popup | Pass | Real file |
| 10 | Video popup | Pass | Real file |
| 11 | Download | Refusal on real host; success on a CORS-enabled mock | Real and mocked |
| 11 | Fullscreen | Wiring only | **Simulated** |
| 12 | Backend status unchanged | Pass | Real file and unit test |
| 13 | No new tabs | Pass: 0 from the app | Real file and mocked |
| 14 | Drawer stays open behind | Pass | Real file and mocked |

### Original test list

| # | Requirement | Result | Level |
|---|---|---|---|
| I1 | Image Open opens the popup | Pass | Mocked, real file |
| I2 | Shows the actual URL | Pass: the exact signed string | Mocked, real file |
| I3 | No new tab | Pass: the app opened 0 tabs | Mocked, real file |
| I4 | Fullscreen | Wiring passes | **Simulated** |
| I5 | Download | Pass: file on disk, 32,900 bytes | Mocked, real file |
| I6 | Missing URL | Pass: no popup | Mocked |
| I7 | Failed load | Pass: 404, corrupt file, hidden status | Mocked |
| I8 | Close returns to the drawer | Pass | Mocked, real file |
| V1 | Video Open opens the popup | Pass | Mocked, real file |
| V2 | Uses the response URL | Pass | Mocked, real file |
| V3 | Player controls | Pass: playback, pause and speed | Mocked, real file |
| V4 | Fullscreen | Wiring passes | **Simulated** |
| V5 | Download | Pass: file on disk, 102,199 bytes | Mocked, real file |
| V6 | Unsupported format | Pass: names `video/hevc` | Mocked |
| V7 | Expired or inaccessible | Pass: 403 | Mocked |
| V8 | Close releases resources | Pass: paused, source removed | Mocked, real file |
| G1 | Drawer stays open | Pass | Mocked, real file |
| G2 | Selection and scroll kept | Pass: scroll 120 before and after, same URL | Mocked, real file |
| G3 | Escape closes | Pass: popup only | Mocked, real file |
| G4 | Background blocked | Pass | Mocked, real file |
| G5 | Focus returns | Pass | Mocked, real file |
| G6 | No unwanted tabs | Pass: Edge's own downloads panel opened, not the app | Mocked, real file |
| G7 | Image to video | Pass | Mocked, real file |
| G8 | Mobile layout | Pass: fits at 375 and 320 px; also 768 and 1440 px | Mocked, real file |

The AI and Routine history drawer was checked for opening video and for Escape. The rest of the list ran on the Incidents drawer, and both use the same popup.

**Also checked:** the streaming path uses unit tests only, because a save dialog can't be answered in this environment. Background clicks close the popup, and clicking the media doesn't.

**Development mode.** React Strict Mode would have left video blank in `next dev`. That is fixed, but the browser run used the production build, so this path has a source check only. Please try one video in `next dev`.

## Screenshots

In `docs/evidence/screenshots/alert-evidence-popup/`. All of these are mocked. The script is `cdp-evidence-popup.cjs.txt`, with results in `results.json`. The real media script is `cdp-evidence-real-vendor.cjs.txt`.

| File | Shows |
|---|---|
| `01-drawer-1440x900.png` | The drawer: status and `URL available` beside each row |
| `02-image-popup-1440x900.png` | Image popup |
| `03-image-downloaded-1440x900.png` | Download confirmation |
| `04-video-playing-1440x900.png` | Video playing |
| `05-download-blocked-1440x900.png` | Download refused by CORS |
| `06-image-not-found-1440x900.png` | Image not found |
| `07-video-expired-1440x900.png` | Access denied or expired |
| `08-video-unsupported-1440x900.png` | Format not supported |
| `09-pending-image-open-1440x900.png` | A PENDING row open, keeping its status |
| `10-pending-not-found-1440x900.png` | A PENDING row whose file is missing |
| `layout-*` | Image and video at 768, 375 and 320 px |

There are no fullscreen screenshots, because real fullscreen couldn't be captured.

## Remaining limitations

- **Download on the vendor host** doesn't work through the app until the backend change is made.
- **Exact failure reasons** aren't available on the vendor host, because CORS hides the status.
- **Real fullscreen** is not verified. It works only as wiring in testing.
- **One real sample.** Only alert 900's two files were tested, so other devices or tenants may differ.
- **No real failure was tested:** expired and missing real links were not available.
- **The AI and Routine drawer** wasn't run with real media. It shares the same popup.
- **Only Edge** was used. Safari and Firefox were not tested.
- **A media host needing a bearer token** wouldn't work, because `<img>` and `<video>` can't send one.
- **The CSP change** is report-only, like the rest of that policy.

## Manual checks still needed

1. Try Fullscreen, then Escape, in Chrome or Edge, and on a phone.
2. Try one video in `next dev`.
3. Check that the ⋮ menu on the player offers Download for vendor videos.
4. Open a real alert in the AI or Routine history drawer.

Nothing was committed, pushed, reset or discarded. Backend code, API contracts and evidence URLs were not changed.
