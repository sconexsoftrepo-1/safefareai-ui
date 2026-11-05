// Alert evidence popup. MOCKED: no real vendor media was available, so every URL below is made up and every fetch is a stub.
// The API rules are checked here; the popup itself is checked in the browser run (docs/alert-evidence-media-popup-report.md).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createRealm } = require("./helpers/load-ts.cjs");

const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));
const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const realm = createRealm({ AbortController, URL, process: { env: { NEXT_PUBLIC_API_BASE_URL: "http://185.193.19.156:9096", NEXT_PUBLIC_EVIDENCE_MEDIA_HOSTS: " media.example.test , bad host!, " } } }, { "lucide-react": new Proxy({}, { get: () => "icon" }) });
const m = realm.require("components/drive-vision/alerts/evidence-model");
const sec = realm.require("config/security-headers");
const VIEWER = "components/drive-vision/alerts/evidence-viewer.tsx";
const INCIDENTS = "components/drive-vision/alerts/incidents.tsx";
const DRAWER = "components/drive-vision/alerts/event-detail-drawer.tsx";

const VENDOR = "https://media.gpstracktech.com/ev/44/image.JPG?Expires=170&Signature=a%2Bb%3D&x=1+2";
const row = (extra = {}) => ({ id: 44, mediaType: "IMAGE", url: VENDOR, status: "READY", ...extra });

// ── Links ───────────────────────────────────────────────────────────────────

test("a signed URL is kept exactly as received, not re-encoded", () => {
  assert.equal(m.evidenceFromRow(row(), 1, 0, false).url, VENDOR);
  const odd = "https://media.gpstracktech.com/a b/c.mp4?sig=x y";
  assert.equal(m.evidenceFromAlarm({ id: 1, videoUrl: odd }, "video").url, odd);
});

test("the vendor, its subdomains, the API host and configured hosts are allowed", () => {
  for (const h of ["gpstracktech.com", "y.gpstracktech.com", "MEDIA.GPSTRACKTECH.COM", "185.193.19.156", "media.example.test", "a.media.example.test"]) assert.equal(m.hostAllowed(h), true, h);
});

test("anything else is refused, including look-alike hosts", () => {
  for (const h of ["evil.com", "gpstracktech.com.evil.com", "notgpstracktech.com", "bad host!"]) assert.equal(m.hostAllowed(h), false, h);
});

test("an unapproved host opens nothing and names the host, so it can be added", () => {
  same(m.linkState("https://cdn.other.test/a.jpg"), { state: "host-not-allowed", note: "Host not approved: cdn.other.test" });
});

test("non-web and placeholder links are unusable", () => {
  for (const u of ["javascript:alert(1)", "data:image/png;base64,AA", "/relative.jpg", "https://example.invalid/a.jpg"]) assert.equal(m.linkState(u).state, "unusable", u);
});

test("an http link can't load on a secure page, and says so", () => {
  assert.equal(m.linkState("http://y.gpstracktech.com/a.jpg", { pageProtocol: "https:" }).state, "insecure");
  assert.equal(m.linkState("http://y.gpstracktech.com/a.jpg", { pageProtocol: "http:" }).state, "ready");
});

// ── Evidence types and states ───────────────────────────────────────────────

test("IMAGE and VIDEO come from mediaType, then content type, then the link", () => {
  assert.equal(m.mediaKindOf("IMAGE", null, null), "image");
  assert.equal(m.mediaKindOf("video", null, null), "video");
  assert.equal(m.mediaKindOf(null, "video/mp4", null), "video");
  assert.equal(m.mediaKindOf(null, null, "https://a.test/x.png?sig=1"), "image");
  assert.equal(m.mediaKindOf("AUDIO", "audio/mpeg", "https://a.test/x.mp3"), null, "not previewable");
});

test("a ready row can open, and keeps the row's metadata", () => {
  const item = m.evidenceFromRow(row({ channel: 2, contentType: "image/png", sizeBytes: 10 }), 1, 0, false);
  same([item.state, item.title, item.contentType, item.sizeBytes], ["ready", "Image evidence · channel 2", "image/png", 10]);
});

test("each piece of evidence has its own key, so switching remounts the viewer", () => {
  const a = m.evidenceFromRow(row({ id: 1 }), 1, 0, true);
  const b = m.evidenceFromRow(row({ id: 2, mediaType: "VIDEO" }), 1, 1, true);
  assert.notEqual(a.key, b.key);
  assert.match(read(VIEWER), /<Viewer key=\{item\.key\}/);
});

// ── Filenames ───────────────────────────────────────────────────────────────

test("the extension comes from the file, then the row, then the link; it is never assumed", () => {
  const item = { fileBase: "alert-7-evidence", contentType: "image/png", url: "https://a.test/x.jpg" };
  assert.equal(m.evidenceFileName(item, "image/webp; charset=x"), "alert-7-evidence.webp");
  assert.equal(m.evidenceFileName(item), "alert-7-evidence.png");
  assert.equal(m.evidenceFileName({ ...item, contentType: null }), "alert-7-evidence.jpg");
  assert.equal(m.evidenceFileName({ ...item, contentType: "application/octet-stream", url: "https://a.test/x" }), "alert-7-evidence");
  assert.equal(m.evidenceFileName({ ...item, contentType: "video/hevc" }), "alert-7-evidence.h265");
});

test("several pieces of evidence on one alert get separate filenames", () => {
  assert.equal(m.evidenceFromRow(row(), 7, 0, false).fileBase, "alert-7-evidence");
  assert.equal(m.evidenceFromRow(row(), 7, 0, true).fileBase, "alert-7-evidence-44");
});

// ── Failures ────────────────────────────────────────────────────────────────

const response = (status, type = null) => async () => ({ ok: status >= 200 && status < 300, status, headers: { get: () => type } });
const diagnose = async (fetcher, kind = "image", online = true) => (await m.diagnoseMedia("https://a.test/x", kind, fetcher, online)).problem;

test("a failed load is explained from the real status", async () => {
  assert.equal(await diagnose(response(403)), "denied");
  assert.equal(await diagnose(response(401)), "denied");
  assert.equal(await diagnose(response(404)), "not-found");
  assert.equal(await diagnose(response(410)), "expired");
  assert.equal(await diagnose(response(500)), "unknown");
});

test("the file exists but won't display: unsupported, naming the actual content type", async () => {
  const f = await m.diagnoseMedia("https://a.test/x", "video", response(206, "video/hevc"), true);
  same([f.problem, f.detail.includes("video/hevc")], ["unsupported", true]);
});

test("the wording fits the media: an image is displayed, a video is played", () => {
  assert.match(m.mediaFailure("image", "unsupported", "image/png").detail, /can't display this image\/png file/);
  assert.match(m.mediaFailure("video", "unsupported", "video/hevc; codecs=x").detail, /can't play this video\/hevc file/);
  assert.match(m.mediaFailure("video", "unsupported").detail, /can't play this video\./);
});

test("when CORS hides the status, the message says so rather than guessing", async () => {
  const blocked = async () => {
    throw new TypeError("Failed to fetch");
  };
  const f = await m.diagnoseMedia("https://a.test/x", "image", blocked, true);
  assert.equal(f.problem, "unknown");
  assert.match(f.detail, /doesn't let the browser see which/);
});

test("offline is a network problem, with no request sent", async () => {
  let called = false;
  assert.equal(await diagnose(async () => ((called = true), {}), "image", false), "network");
  assert.equal(called, false);
});

test("the probe sends no credentials or referrer, and asks for one byte", async () => {
  let init;
  await m.diagnoseMedia(VENDOR, "image", async (u, i) => ((init = i), { ok: true, status: 206, headers: { get: () => null } }), true);
  same([init.credentials, init.referrerPolicy, init.headers.Range], ["omit", "no-referrer", "bytes=0-0"]);
});

test("video error codes: abort is ignored, network and decode are direct, 4 needs a diagnosis", () => {
  same([1, 2, 3, 4, undefined].map(m.videoErrorProblem), [null, "network", "unsupported", "diagnose", "diagnose"]);
});

test("a format the browser rejects isn't pretended to be playable", () => {
  assert.equal(m.videoPlayable("video/hevc", () => ""), false);
  assert.equal(m.videoPlayable("video/mp4", () => "maybe"), true);
  assert.equal(m.videoPlayable(null, () => ""), true, "unknown: let the browser try");
  assert.equal(m.videoPlayable("application/octet-stream", () => ""), true);
});

// ── Download ────────────────────────────────────────────────────────────────

function deps(fetcher, extra = {}) {
  const log = { saved: [], revoked: [], created: 0 };
  return {
    log,
    fetch: fetcher,
    origin: "http://localhost:3000",
    saveLink: (href, name) => log.saved.push([href, name]),
    createObjectURL: () => (log.created++, "blob:x"),
    revokeObjectURL: (u) => log.revoked.push(u),
    ...extra,
  };
}
const file = (headers = {}, status = 200, body = null) => {
  const res = new Response(body ?? "data", { status, headers });
  return async () => res;
};
const image = { kind: "image", fileBase: "alert-7-evidence", contentType: null, url: "https://media.gpstracktech.com/a?sig=1", sizeBytes: null };
const video = { ...image, kind: "video", url: "https://media.gpstracktech.com/b.mp4?sig=1" };

test("same-origin media downloads directly, without fetching it", async () => {
  const d = deps(async () => assert.fail("no fetch"));
  const r = await m.downloadEvidence({ ...image, url: "http://localhost:3000/a.png" }, d);
  same([r.status, d.log.saved], ["started", [["http://localhost:3000/a.png", "alert-7-evidence.png"]]]);
});

test("a cross-origin file allowed by CORS downloads through a blob, named from its real type", async () => {
  const d = deps(file({ "Content-Type": "image/webp" }));
  same(await m.downloadEvidence(image, d), { status: "started", fileName: "alert-7-evidence.webp" });
  same(d.log.saved, [["blob:x", "alert-7-evidence.webp"]]);
});

test("the request keeps the signed URL exactly, with no credentials", async () => {
  let got;
  await m.downloadEvidence({ ...image, url: VENDOR }, deps(async (u, i) => ((got = [u, i.credentials, i.referrerPolicy]), new Response("x"))));
  same(got, [VENDOR, "omit", "no-referrer"]);
});

test("CORS refusing the download fails visibly and claims nothing", async () => {
  const d = deps(async () => {
    throw new TypeError("Failed to fetch");
  });
  const r = await m.downloadEvidence(image, d);
  same([r.status, r.reason, r.message], ["failed", "blocked", m.downloadBlockedMessage("image")]);
  same(d.log.saved, []);
});

test("an expired link fails visibly", async () => {
  const r = await m.downloadEvidence(image, deps(file({}, 403)));
  same([r.status, r.reason], ["failed", "refused"]);
  assert.match(r.message, /expired/);
});

test("a cross-origin link is never handed to a plain <a download>, which would navigate the app away", async () => {
  const d = deps(file({}));
  await m.downloadEvidence(image, d);
  assert.ok(d.log.saved.every(([href]) => href.startsWith("blob:")));
});

test("video streams to disk where the browser can, without holding it in memory", async () => {
  const chunks = [];
  const picker = async () => ({ createWritable: async () => new WritableStream({ write: (c) => chunks.push(c) }) });
  const d = deps(file({ "Content-Type": "video/mp4", "Content-Length": "4" }), { showSaveFilePicker: picker });
  same(await m.downloadEvidence(video, d), { status: "saved", fileName: "alert-7-evidence.mp4" });
  assert.equal(d.log.created, 0, "no blob");
  assert.equal(chunks.length > 0, true);
});

test("cancelling the save dialog is not a failure", async () => {
  const picker = async () => {
    throw Object.assign(new Error("x"), { name: "AbortError" });
  };
  assert.equal((await m.downloadEvidence(video, deps(file({}), { showSaveFilePicker: picker }))).status, "cancelled");
});

test("a file too large for memory, with no way to stream it, fails visibly and loads nothing", async () => {
  const d = deps(file({ "Content-Length": String(m.MAX_IN_MEMORY_BYTES + 1) }));
  const r = await m.downloadEvidence(video, d);
  same([r.status, r.reason, d.log.created], ["failed", "too-large", 0]);
});

// ── The popup's wiring ──────────────────────────────────────────────────────

test("no Open action for IMAGE or VIDEO opens a new tab any more", () => {
  assert.doesNotMatch(read(DRAWER), /target="_blank"|window\.open/);
  assert.doesNotMatch(read(VIEWER), /target="_blank"|window\.open|<iframe/);
  const incidents = read(INCIDENTS);
  assert.match(incidents, /item\?\.state === "ready" \? \(\s*<button type="button" onClick=\{\(\) => setViewing\(item\)\}/);
  assert.equal([...incidents.matchAll(/target="_blank"/g)].length, 1, "only the fallback for types the viewer can't show");
  assert.match(incidents, /\) : url \? \(\s*<a href=\{url\} target="_blank"/);
});

test("the popup is inside the drawer, so the drawer and its state stay behind it", () => {
  assert.match(read(INCIDENTS), /<EvidenceViewer item=\{viewing\} context=\{alarmLabel\(alert, typeById\)\} onClose=\{\(\) => setViewing\(null\)\} \/>/);
  assert.match(read(DRAWER), /<EvidenceViewer item=\{viewing\} context=\{alarmLabel\(alarm, typeById\)\} onClose=\{\(\) => setViewing\(null\)\} \/>/);
});

test("only one popup: one state value, and it holds the URL it opened with", () => {
  for (const f of [INCIDENTS, DRAWER]) assert.equal([...read(f).matchAll(/useState<EvidenceItem \| null>/g)].length, 1, f);
});

test("the media element uses the response URL, with native controls and no autoplay", () => {
  const v = read(VIEWER);
  assert.match(v, /src=\{item\.url!\}\s+controls\s+playsInline\s+preload="metadata"/);
  assert.doesNotMatch(v, /autoPlay/);
  assert.match(v, /max-h-full max-w-full object-contain/, "the image isn't cropped");
  assert.equal([...v.matchAll(/referrerPolicy="no-referrer"/g)].length, 1);
});

test("closing stops playback and releases the file, and Strict Mode's remount can restore it", () => {
  const v = read(VIEWER);
  assert.match(v, /el\.pause\(\);\s*el\.removeAttribute\("src"\);\s*el\.load\(\);/);
  assert.match(v, /if \(el && !el\.getAttribute\("src"\)\) el\.src = item\.url!;/);
});

test("fullscreen uses the API on the stage, leaves it on close, and copes without it", () => {
  const v = read(VIEWER);
  assert.match(v, /stage\.current\?\.requestFullscreen\(\)/);
  assert.match(v, /document\.fullscreenElement === el\) void document\.exitFullscreen\(\)/);
  assert.match(v, /document\.fullscreenEnabled === true/);
  assert.match(v, /This browser doesn't support fullscreen/);
  assert.match(v, /onEscapeKeyDown=\{\(e\) => document\.fullscreenElement && e\.preventDefault\(\)\}/);
});

test("focus returns to the Open button, through the shared hook", () => {
  const v = read(VIEWER);
  assert.match(v, /const restoreFocus = useReturnFocus\(item !== null\);/);
  assert.match(v, /onCloseAutoFocus=\{restoreFocus\}/);
});

test("nothing logs a media URL or stores credentials", () => {
  for (const f of [VIEWER, "components/drive-vision/alerts/evidence-model.ts"]) assert.doesNotMatch(read(f), /console\.|localStorage|sessionStorage/, f);
});

test("the report-only CSP knows the media hosts, and adds no wildcard beyond them", () => {
  const csp = sec.reportOnlyCsp({ NEXT_PUBLIC_API_BASE_URL: "http://185.193.19.156:9096", NEXT_PUBLIC_EVIDENCE_MEDIA_HOSTS: "media.example.test" });
  for (const d of ["img-src", "media-src", "connect-src"]) {
    const line = csp.split("; ").find((x) => x.startsWith(d));
    assert.match(line, /https:\/\/\*\.gpstracktech\.com/, d);
    assert.match(line, /https:\/\/\*\.media\.example\.test/, d);
  }
  assert.doesNotMatch(csp, /(^|\s)https:(\s|;|$)|(^|\s)\*(\s|;|$)/, "no bare scheme or star");
  assert.doesNotMatch(sec.enforcedCsp(), /gpstracktech/, "the enforced policy is unchanged");
});

// ── Alert 900: a URL decides Open, the status is only a label ───────────────
// The response below is the reference fixture from the brief. Automated tests here are mocked; the real files were checked
// separately (see the report).

const alert900 = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "alert-900.json"), "utf8")).data;
const items900 = alert900.evidence.map((e, i) => m.evidenceFromRow(e, alert900.alert.id, i, true));
const UI_RULE = /item\?\.state === "ready" \? \(\s*<button type="button" onClick=\{\(\) => setViewing\(item\)\}/;

test("#1 alert 900's PENDING image, with a URL, can open", () => {
  same([items900[0].kind, items900[0].state, items900[0].status], ["image", "ready", "PENDING"]);
});

test("#2 alert 900's PENDING video, with a URL, can open", () => {
  same([items900[1].kind, items900[1].state, items900[1].status], ["video", "ready", "PENDING"]);
});

test("#3 #4 READY with a URL can open, for image and video", () => {
  for (const mediaType of ["IMAGE", "VIDEO"]) assert.equal(m.evidenceFromRow(row({ mediaType, status: "READY" }), 1, 0, false).state, "ready", mediaType);
});

test("#5 PENDING without a URL can't open, and isn't reported as a fault", () => {
  for (const url of [null, undefined, ""]) {
    const item = m.evidenceFromRow(row({ status: "PENDING", url }), 1, 0, false);
    same([item.state, item.note, item.noteIsError], ["no-link", "Waiting for link", false]);
  }
});

test("READY without a URL can't open, and is shown as an error", () => {
  const item = m.evidenceFromRow(row({ status: "READY", url: null }), 1, 0, false);
  same([item.state, item.note, item.noteIsError], ["no-link", "Link missing", true]);
});

test("#6 FAILED with a URL can be attempted, and keeps saying FAILED", () => {
  const item = m.evidenceFromRow(row({ status: "FAILED" }), 1, 0, false);
  same([item.state, item.status, m.availabilityLabel(item)], ["ready", "FAILED", "FAILED · URL available"]);
  assert.equal(m.evidenceFromRow(row({ status: "FAILED", url: null }), 1, 0, false).state, "no-link");
});

test("no status value blocks a usable URL", () => {
  for (const status of ["PENDING", "READY", "FAILED", "UNAVAILABLE", "NONE", "EXPIRED", "SOMETHING_NEW", "", null, undefined]) assert.equal(m.evidenceFromRow(row({ status }), 1, 0, false).state, "ready", String(status));
});

test("#12 the backend's status is never changed, and both facts are shown", () => {
  for (let i = 0; i < 2; i++) {
    assert.equal(items900[i].status, alert900.evidence[i].status);
    assert.equal(items900[i].url, alert900.evidence[i].url, "exact URL");
  }
  assert.equal(m.availabilityLabel(items900[0]), "PENDING · URL available");
  assert.equal(m.availabilityLabel(m.evidenceFromRow(row({ status: "PENDING", url: null }), 1, 0, false)), "PENDING");
  for (const f of [VIEWER, INCIDENTS, DRAWER, "components/drive-vision/alerts/evidence-model.ts"]) assert.doesNotMatch(read(f), /status: "READY"|status = "READY"|\.status = /, f);
});

test("host validation still applies: a PENDING row on an unapproved host can't open", () => {
  assert.equal(m.evidenceFromRow(row({ status: "PENDING", url: "https://cdn.other.test/a.jpg" }), 1, 0, false).state, "host-not-allowed");
  assert.equal(m.evidenceFromRow(row({ status: "READY", url: "https://example.invalid/a.jpg" }), 1, 0, false).state, "unusable");
});

test("the type comes from the API's mediaType first, not the file's extension", () => {
  assert.equal(m.mediaKindOf("VIDEO", null, "https://a.test/x.jpg"), "video");
  assert.equal(m.mediaKindOf("IMAGE", "video/mp4", "https://a.test/x.mp4"), "image");
});

test("#7 403 and 404 on a pending file say so, and add that it may not be there yet", async () => {
  assert.equal((await m.diagnoseMedia(items900[0].url, "image", response(404), true)).problem, "not-found");
  assert.equal((await m.diagnoseMedia(items900[1].url, "video", response(403), true)).problem, "denied");
  assert.match(m.statusHint("PENDING"), /still reports this as PENDING/);
  assert.match(m.statusHint("FAILED"), /FAILED/);
  for (const s of ["READY", "COMPLETE", null]) assert.equal(m.statusHint(s), null, String(s));
  assert.equal([...read(VIEWER).matchAll(/hint=\{statusHint\(item\.status\)\}/g)].length, 2, "image and video");
});

test("#8 both media types offer a retry after a failure", () => {
  const v = read(VIEWER);
  assert.equal([...v.matchAll(/onRetry=\{retry\}/g)].length, 2);
  assert.match(v, /Try again/);
});

test("#9 #10 the same popup opens from both drawers, and the row button depends only on the item", () => {
  const incidents = read(INCIDENTS);
  assert.match(incidents, UI_RULE);
  assert.match(read(DRAWER), /m\.state === "ready" \? \(/);
  for (const f of [INCIDENTS, DRAWER]) assert.doesNotMatch(read(f), /PENDING|"pending"/, `${f} has no status rule of its own`);
  assert.equal(fs.readdirSync(path.join(SRC, "components/drive-vision/alerts")).filter((x) => /viewer|popup/i.test(x)).length, 1, "one popup");
});

test("a row with no link shows a disabled Open, and the viewer shows the backend's status", () => {
  assert.match(read(INCIDENTS), /<button type="button" disabled [^>]*data-testid="evidence-open-disabled">/);
  assert.match(read(VIEWER), /data-testid="evidence-status">[\s\S]*?\{item\.status\}/);
});

test("#11 download on the real vendor host: no CORS, so it fails visibly, says what to try, and saves nothing", async () => {
  for (const [i, tip] of [[0, /Save image as/], [1, /⋮ menu on the player/]]) {
    const d = deps(async () => {
      throw new TypeError("Failed to fetch");
    });
    const r = await m.downloadEvidence(items900[i], d);
    same([r.status, r.reason, d.log.saved], ["failed", "blocked", []]);
    assert.match(r.message, tip);
    assert.match(r.message, /nothing was saved/);
  }
});
