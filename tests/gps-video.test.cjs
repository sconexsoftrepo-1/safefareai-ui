// Live camera popup (Live Monitoring): the GPSTrackTech player URL. Synthetic token; nothing is fetched.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createRealm } = require("./helpers/load-ts.cjs");

const realm = createRealm({ process: { env: {} } });
const v = realm.require("components/drive-vision/monitoring/gps-video");
const read = (rel) => fs.readFileSync(path.join(__dirname, "..", "src", rel), "utf8");

test("GV url: same format as the vendor's real-time video link (device, channels, token, timestamp)", () => {
  const url = v.gpsVideoUrl({ terminalNo: "71080050829", channels: [1, 2, 3, 4], token: "test-token-0000", now: 1793708295282 });
  assert.equal(
    url,
    "https://y.gpstracktech.com/#/videoapi/real?param=%7B%22device%22:%2271080050829%22,%22channel%22:[1,2,3,4],%22protocolType%22:1,%22codetype%22:1,%22datatype%22:0%7D&config=%7B%22url%22:%22wss://y.gpstracktech.com/videows/%22,%22apiToken%22:%22test-token-0000%22,%22apiName%22:%22%22,%22lang%22:%22en%22%7D&controls=play,fullscreen,record,mute,screenshot,HD&videoFormat=98&isSleep=0&countdown=0&t=1793708295282"
  );
});

test("GV channels: 1..cameraCount, else the vendor default four", () => {
  assert.equal(JSON.stringify(v.videoChannels(2)), JSON.stringify([1, 2]));
  assert.equal(JSON.stringify(v.videoChannels(undefined)), JSON.stringify([1, 2, 3, 4]));
  assert.equal(JSON.stringify(v.videoChannels(0)), JSON.stringify([1, 2, 3, 4]));
});

test("GV wiring: no token in the source; the popup opens on a user pick; the old new-tab button is gone", () => {
  for (const f of ["components/drive-vision/monitoring/gps-video.ts", "components/drive-vision/monitoring/live-video-dialog.tsx", "components/drive-vision/monitoring/live-monitoring.tsx"]) {
    assert.doesNotMatch(read(f), /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, `${f} has no hard-coded token`);
  }
  assert.equal(v.GPS_VIDEO_API_TOKEN, "", "read from NEXT_PUBLIC_GPS_VIDEO_API_TOKEN (unset here)");
  const page = read("components/drive-vision/monitoring/live-monitoring.tsx");
  assert.doesNotMatch(page, /GPS Track Tech|target="_blank"/);
  assert.match(page, /if \(next !== null\) setVideoId\(next\);/);
  assert.match(read("config/security-headers.ts"), /\["frame-src", GPS_VIDEO_FRAME_ORIGIN\]/);
});
