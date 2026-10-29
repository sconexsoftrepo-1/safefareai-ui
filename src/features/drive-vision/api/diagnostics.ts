import { API_DEBUG } from "./config";

/**
 * Development-only request log. Prints method, URL (path + query), status, duration,
 * server error code and request id. Deliberately never prints headers or bodies, so
 * passwords and tokens can't leak into the console — use the Network tab for payloads.
 */
export function logRequest(entry: {
  method: string;
  url: string;
  status: number | "network" | "timeout" | "aborted";
  durationMs: number;
  errorCode?: string;
  requestId?: string;
  note?: string;
}) {
  if (!API_DEBUG) return;
  const ok = typeof entry.status === "number" && entry.status >= 200 && entry.status < 300;
  const parts = [`[api] ${entry.method} ${entry.url} → ${entry.status}`, `${Math.round(entry.durationMs)} ms`];
  if (entry.errorCode) parts.push(entry.errorCode);
  if (entry.requestId) parts.push(`req ${entry.requestId}`);
  if (entry.note) parts.push(entry.note);
  const line = parts.join(" · ");
  if (ok) console.info(line);
  else console.warn(line);
}

/** Auth lifecycle events (refresh, expiry, logout) — no token values. */
export function logAuth(message: string) {
  if (!API_DEBUG) return;
  console.info(`[auth] ${message}`);
}
