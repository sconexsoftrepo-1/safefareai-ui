/**
 * Live camera view from the GPS vendor (GPSTrackTech video player), embedded in a popup on Live Monitoring.
 * The player takes the device's terminal number, the camera channels and a vendor API token in its URL.
 *
 * The token comes from NEXT_PUBLIC_GPS_VIDEO_API_TOKEN. Like every NEXT_PUBLIC_ value it is built into the
 * browser bundle and travels in the player URL, so anyone using the app can read it: use a token the vendor
 * restricts to video playback.
 */
export const GPS_VIDEO_ORIGIN = "https://y.gpstracktech.com";
const GPS_VIDEO_WS = "wss://y.gpstracktech.com/videows/";
export const GPS_VIDEO_API_TOKEN = (process.env.NEXT_PUBLIC_GPS_VIDEO_API_TOKEN ?? "").trim();
const DEFAULT_CHANNELS = [1, 2, 3, 4];

/** Camera channels 1..cameraCount, or the vendor's default four when the count is unknown. */
export function videoChannels(cameraCount: number | null | undefined): number[] {
  return typeof cameraCount === "number" && cameraCount > 0 ? Array.from({ length: Math.min(cameraCount, 16) }, (_, i) => i + 1) : DEFAULT_CHANNELS;
}

/** The vendor player URL for one device (same parameters as the vendor's own real-time video page). */
export function gpsVideoUrl({ terminalNo, channels, token, now }: { terminalNo: string; channels: number[]; token: string; now: number }): string {
  const enc = (v: unknown) => encodeURIComponent(JSON.stringify(v)).replace(/%2C/g, ",").replace(/%3A/g, ":").replace(/%5B/g, "[").replace(/%5D/g, "]").replace(/%2F/g, "/");
  const param = enc({ device: terminalNo, channel: channels, protocolType: 1, codetype: 1, datatype: 0 });
  const config = enc({ url: GPS_VIDEO_WS, apiToken: token, apiName: "", lang: "en" });
  return `${GPS_VIDEO_ORIGIN}/#/videoapi/real?param=${param}&config=${config}&controls=play,fullscreen,record,mute,screenshot,HD&videoFormat=98&isSleep=0&countdown=0&t=${now}`;
}
