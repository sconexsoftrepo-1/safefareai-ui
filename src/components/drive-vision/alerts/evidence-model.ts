import { API_BASE_URL } from "@/features/drive-vision/api/config";
import type { EvidenceRow } from "@/features/drive-vision/api/types";
import { evidenceMediaHosts } from "@/config/security-headers";
import { safeHttpUrl } from "../reports/reports-model";

/**
 * Alert evidence shown in the in-app viewer. Pure: unit-tested.
 *
 * The URL is kept exactly as the server sent it, because a signed URL can stop working if it is re-encoded. It is
 * only ever used as the source of an <img> or <video>, or for a download; nothing here frames it. The API gives no
 * media host list and no download endpoint, so hosts are an allow-list and a download depends on the host's CORS.
 *
 * Three separate things, never merged: the backend's `status` (shown as sent, never changed here), whether there is a
 * usable URL (the only thing that decides Open), and whether the file really loads (only trying can tell). Alert 900
 * has real files on rows still reported PENDING, so a status says nothing about the file.
 */

export type MediaKind = "image" | "video";

/** ready = there is a usable URL, so it can be opened, whatever the status. Every other state explains why not. */
export type EvidenceState = "ready" | "no-link" | "unusable" | "host-not-allowed" | "insecure";

export interface EvidenceItem {
  key: string;
  kind: MediaKind;
  title: string;
  /** Exactly as received. Never log this: it may be signed. */
  url: string | null;
  /** The backend's status, exactly as sent. Null when it sent none, as on alarm rows. */
  status: string | null;
  state: EvidenceState;
  /** What to say beside the Open action when state isn't ready. */
  note: string | null;
  /** The note reports a fault: the row claims to be ready but has no link. */
  noteIsError: boolean;
  contentType: string | null;
  sizeBytes: number | null;
  /** Filename without extension. */
  fileBase: string;
}

export const allowedMediaHosts = () => evidenceMediaHosts({ NEXT_PUBLIC_API_BASE_URL: API_BASE_URL, NEXT_PUBLIC_EVIDENCE_MEDIA_HOSTS: process.env.NEXT_PUBLIC_EVIDENCE_MEDIA_HOSTS });

export function hostAllowed(hostname: string, hosts: readonly string[] = allowedMediaHosts()): boolean {
  const host = hostname.toLowerCase();
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

/** IMAGE or VIDEO from the row's type, then its content type, then the link's extension. Null = not previewable. */
export function mediaKindOf(mediaType: string | null | undefined, contentType: string | null | undefined, url: string | null | undefined): MediaKind | null {
  const declared = (mediaType ?? "").trim().toUpperCase();
  if (declared === "IMAGE") return "image";
  if (declared === "VIDEO") return "video";
  const type = (contentType ?? "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  const ext = extensionOf(url);
  if (ext && IMAGE_EXTENSIONS.has(ext)) return "image";
  if (ext && VIDEO_EXTENSIONS.has(ext)) return "video";
  return null;
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "webm", "mov", "mkv", "avi", "flv", "ts", "h264", "h265"]);

function extensionOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname)?.[1].toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/** Whether a link can be shown, in the page it would be shown on. */
export function linkState(url: string | null | undefined, ctx: { pageProtocol?: string; hosts?: readonly string[] } = {}): { state: EvidenceState; note: string | null } {
  if (!url) return { state: "no-link", note: "No link" };
  // Refuses other schemes and placeholder hosts (the BFF returned https://example.invalid/… on 2026-10-29, #29).
  const safe = safeHttpUrl(url);
  if (!safe) return { state: "unusable", note: "Link not usable" };
  const parsed = new URL(safe);
  if (!hostAllowed(parsed.hostname, ctx.hosts)) return { state: "host-not-allowed", note: `Host not approved: ${parsed.hostname}` };
  if (ctx.pageProtocol === "https:" && parsed.protocol === "http:") return { state: "insecure", note: "Insecure link: a secure page can't load it" };
  return { state: "ready", note: null };
}

const pageProtocol = () => (typeof location === "undefined" ? undefined : location.protocol);

/** Why a row has no link. A file still expected isn't a fault; a row saying it's ready with no link is. */
function missingLink(status: string | null): { note: string; noteIsError: boolean } {
  const s = (status ?? "").toUpperCase();
  if (s === "PENDING") return { note: "Waiting for link", noteIsError: false };
  if (s === "FAILED") return { note: "No link", noteIsError: false };
  return { note: s ? "Link missing" : "No link", noteIsError: s !== "" };
}

/** One row of GET /alerts/{id}. `evidence.length > 1` adds the row id to the filename so downloads don't collide. */
export function evidenceFromRow(row: EvidenceRow, alertId: number, index: number, multiple: boolean): EvidenceItem | null {
  const kind = mediaKindOf(row.mediaType, row.contentType, row.url);
  if (!kind) return null;
  const status = row.status?.trim() || null;
  const channel = typeof row.channel === "number" ? ` · channel ${row.channel}` : "";
  const link = linkState(row.url, { pageProtocol: pageProtocol() });
  return {
    key: `row-${row.id ?? index}`,
    kind,
    title: `${kind === "image" ? "Image" : "Video"} evidence${channel}`,
    url: row.url ?? null,
    status,
    ...link,
    noteIsError: false,
    ...(link.state === "no-link" ? missingLink(status) : {}),
    contentType: row.contentType ?? null,
    sizeBytes: typeof row.sizeBytes === "number" ? row.sizeBytes : null,
    fileBase: `alert-${alertId}-evidence${multiple ? `-${row.id ?? index + 1}` : ""}`,
  };
}

/** The imageUrl or videoUrl of an alarm row, which carry no metadata. */
export function evidenceFromAlarm(alarm: { id?: number; imageUrl?: string; videoUrl?: string }, kind: MediaKind): EvidenceItem | null {
  const url = kind === "image" ? alarm.imageUrl : alarm.videoUrl;
  if (!url) return null;
  return {
    key: `alarm-${alarm.id ?? "?"}-${kind}`,
    kind,
    title: `${kind === "image" ? "Image" : "Video"} evidence`,
    url,
    status: null,
    ...linkState(url, { pageProtocol: pageProtocol() }),
    noteIsError: false,
    contentType: null,
    sizeBytes: null,
    fileBase: alarm.id !== undefined ? `alert-${alarm.id}-evidence` : "alert-evidence",
  };
}

/** The line beside a row: the backend's status and the link's availability, side by side. */
export const availabilityLabel = (item: Pick<EvidenceItem, "status" | "state">) => [item.status, item.state === "ready" ? "URL available" : null].filter(Boolean).join(" · ");

/** Shown with a failure when the backend hasn't called the file ready: it may simply not be there yet. */
export function statusHint(status: string | null): string | null {
  const s = (status ?? "").toUpperCase();
  if (s === "PENDING") return "The server still reports this as PENDING, so the file may not be available yet.";
  if (s === "FAILED") return "The server reports this as FAILED.";
  return null;
}

// ── Filenames ───────────────────────────────────────────────────────────────

const TYPE_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/ogg": "ogv",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "video/x-msvideo": "avi",
  "video/x-flv": "flv",
  "video/mp2t": "ts",
  "video/h264": "h264",
  "video/h265": "h265",
  "video/hevc": "h265",
};

const bareType = (type: string | null | undefined) => (type ?? "").split(";")[0].trim().toLowerCase();

/** The extension comes from the file itself, then the row, then the link. With none, the file gets none rather than a guess. */
export function evidenceFileName(item: Pick<EvidenceItem, "fileBase" | "contentType" | "url">, responseType?: string | null): string {
  const ext = TYPE_EXTENSION[bareType(responseType)] ?? TYPE_EXTENSION[bareType(item.contentType)] ?? extensionOf(item.url);
  return ext ? `${item.fileBase}.${ext}` : item.fileBase;
}

// ── Why media didn't load ───────────────────────────────────────────────────

export type MediaProblem = "denied" | "not-found" | "expired" | "unsupported" | "network" | "unknown";

export interface MediaFailure {
  problem: MediaProblem;
  title: string;
  detail: string;
}

const noun = (kind: MediaKind) => (kind === "image" ? "image" : "video");

export function mediaFailure(kind: MediaKind, problem: MediaProblem, contentType?: string | null): MediaFailure {
  const type = bareType(contentType);
  const name = noun(kind);
  switch (problem) {
    case "denied":
      return { problem, title: "Access denied or link expired", detail: `The media server refused this ${name}. Signed links expire, so reopening the alert may give a new one.` };
    case "expired":
      return { problem, title: "Link expired", detail: `This ${name} link has expired. Reopening the alert may give a new one.` };
    case "not-found":
      return { problem, title: `${kind === "image" ? "Image" : "Video"} not found`, detail: "The media server doesn't have this file." };
    case "unsupported":
      return { problem, title: "Format not supported", detail: `This browser can't ${kind === "image" ? "display" : "play"} ${type ? `this ${type} file` : `this ${name}`}. It may be damaged, or need another app. Try downloading it.` };
    case "network":
      return { problem, title: "Network problem", detail: `The ${name} couldn't be reached. Check your connection and try again.` };
    default:
      return { problem, title: `Couldn't load this ${name}`, detail: "The link may have expired, the file may be gone, or the connection failed. The media server doesn't let the browser see which." };
  }
}

type Fetcher = (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status" | "headers">>;

/**
 * <img> and <video> don't expose the HTTP status of a failure, so one small request asks. If CORS hides the answer the
 * result is "unknown" and the message says so, rather than guessing a reason.
 */
export async function diagnoseMedia(url: string, kind: MediaKind, fetcher: Fetcher, online = true): Promise<MediaFailure> {
  if (!online) return mediaFailure(kind, "network");
  const controller = new AbortController();
  try {
    const res = await fetcher(url, { method: "GET", mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", headers: { Range: "bytes=0-0" }, signal: controller.signal });
    const type = res.headers.get("Content-Type");
    controller.abort();
    if (res.status === 401 || res.status === 403) return mediaFailure(kind, "denied");
    if (res.status === 404) return mediaFailure(kind, "not-found");
    if (res.status === 410) return mediaFailure(kind, "expired");
    // The server has the file, so what failed was reading it.
    return mediaFailure(kind, res.ok ? "unsupported" : "unknown", type);
  } catch {
    return mediaFailure(kind, "unknown");
  }
}

/** HTMLMediaElement.error.code. 4 covers both bad formats and failed requests, so it has to be diagnosed. */
export function videoErrorProblem(code: number | undefined): MediaProblem | "diagnose" | null {
  if (code === 1) return null;
  if (code === 2) return "network";
  if (code === 3) return "unsupported";
  return "diagnose";
}

/** False only when the content type is known and the browser says it can't play it. */
export function videoPlayable(contentType: string | null | undefined, canPlayType: (type: string) => string): boolean {
  const type = (contentType ?? "").trim();
  return !type || bareType(type) === "application/octet-stream" || canPlayType(type) !== "";
}

// ── Download ────────────────────────────────────────────────────────────────

/** Above this a file isn't held in memory; streaming to disk needs a browser with a save picker. */
export const MAX_IN_MEMORY_BYTES = 200 * 1024 * 1024;

export type DownloadResult = { status: "saved" | "started" | "cancelled"; fileName: string } | { status: "failed"; reason: "blocked" | "refused" | "too-large"; message: string };

/** The vendor host sends no CORS headers (checked on real files, 2026-11-05). The browser's own save isn't subject to that. */
export const downloadBlockedMessage = (kind: MediaKind) => `The media server doesn't allow this app to download files, so nothing was saved. ${kind === "image" ? "Right-click the image and choose Save image as." : "Try the ⋮ menu on the player."}`;
const TOO_LARGE = "This file is too large to download in this browser. A backend download endpoint is needed.";

export interface DownloadDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  origin: string;
  /** Saves through a temporary <a download>. */
  saveLink: (href: string, fileName: string) => void;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  /** File System Access API, where the browser has it: writes to disk without holding the file in memory. */
  showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array>> }>;
}

const sameOrigin = (url: string, origin: string) => {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
};

/**
 * Same-origin links download directly. A cross-origin <a download> ignores the attribute and would navigate the app
 * away, so those need a CORS fetch; if the host refuses, that is reported and nothing is claimed.
 */
export async function downloadEvidence(item: Pick<EvidenceItem, "fileBase" | "contentType" | "url" | "sizeBytes" | "kind">, deps: DownloadDeps): Promise<DownloadResult> {
  const url = item.url;
  if (!url) return { status: "failed", reason: "refused", message: "This evidence has no link." };
  if (sameOrigin(url, deps.origin)) {
    const fileName = evidenceFileName(item);
    deps.saveLink(url, fileName);
    return { status: "started", fileName };
  }
  const controller = new AbortController();
  let res: Response;
  try {
    res = await deps.fetch(url, { method: "GET", mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal });
  } catch {
    return { status: "failed", reason: "blocked", message: downloadBlockedMessage(item.kind) };
  }
  if (!res.ok) return { status: "failed", reason: "refused", message: res.status === 401 || res.status === 403 || res.status === 410 ? "The media server refused the download. The link may have expired." : `The media server returned ${res.status}, so nothing was saved.` };

  const fileName = evidenceFileName(item, res.headers.get("Content-Type"));
  const length = Number(res.headers.get("Content-Length")) || item.sizeBytes || 0;
  const large = item.kind === "video" || length > MAX_IN_MEMORY_BYTES;

  if (large && deps.showSaveFilePicker && res.body) {
    try {
      const handle = await deps.showSaveFilePicker({ suggestedName: fileName });
      await res.body.pipeTo(await handle.createWritable());
      return { status: "saved", fileName };
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") {
        controller.abort();
        return { status: "cancelled", fileName };
      }
      if ((err as { name?: string }).name !== "SecurityError") return { status: "failed", reason: "refused", message: "The download stopped before it finished. Any partial file should be deleted." };
      // The picker needs a recent click and may have lost it during the request: fall through to memory.
    }
  }
  if (length > MAX_IN_MEMORY_BYTES) {
    controller.abort();
    return { status: "failed", reason: "too-large", message: TOO_LARGE };
  }
  const objectUrl = deps.createObjectURL(await res.blob());
  try {
    deps.saveLink(objectUrl, fileName);
  } finally {
    // Later, not now: the browser reads the blob after the click.
    setTimeout(() => deps.revokeObjectURL(objectUrl), 30_000);
  }
  return { status: "started", fileName };
}
