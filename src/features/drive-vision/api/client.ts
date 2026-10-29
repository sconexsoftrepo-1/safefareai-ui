import { API_BASE_URL, API_PREFIX, API_TIMEOUT_MS, REFRESH_LEEWAY_MS } from "./config";
import { ApiError, isApiError, readErrorExtend } from "./errors";
import { logAuth, logRequest } from "./diagnostics";
import { isRefreshExpired, readSession, sessionFromTokens, writeSession, type StoredSession } from "./session";
import { PEER_QUERY_MS, PEER_RESCUE_MS, adoptFromPeers, announceRotation, forgetLineage, knowsPeers, startSessionSync, withRefreshLock } from "./session-sync";
import type { ApiResponse, RefreshRequest, TokenResponse } from "./types";

/**
 * Typed fetch wrapper for the Safe-Fare Fleet BFF. Requests go straight from the browser
 * to API_BASE_URL (the server's CORS policy allows the dev origin), so every call is
 * visible in DevTools → Network with its real URL, method, status, timing and payload.
 *
 * Auth: attaches `Authorization: <tokenType> <accessToken>`, refreshes proactively shortly
 * before expiry, and retries once after a 401. Refreshes are single-flight (per tab, and
 * serialised across tabs) and the refresh call itself is never retried or refreshed, so
 * there's no loop. A rejected refresh ends the session and notifies `onSessionEnded`
 * listeners — unless another tab had already rotated that token and hands over its session.
 */

export type QueryValue = string | number | boolean | null | undefined | ReadonlyArray<string | number>;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Attach the bearer token (default true). Login/refresh/logout pass false. */
  auth?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type SessionEndReason = "expired" | "signed-out";

const sessionEndedListeners = new Set<(reason: SessionEndReason) => void>();

export function onSessionEnded(listener: (reason: SessionEndReason) => void) {
  sessionEndedListeners.add(listener);
  return () => {
    sessionEndedListeners.delete(listener);
  };
}

export function endSession(reason: SessionEndReason) {
  const had = readSession() !== null;
  writeSession(null);
  forgetLineage();
  if (had) logAuth(reason === "expired" ? "session expired — cleared tokens" : "signed out — cleared tokens");
  sessionEndedListeners.forEach((l) => l(reason));
}

function buildUrl(path: string, query?: RequestOptions["query"]) {
  const params = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      // OpenAPI default for query arrays (form, explode=true): repeat the key.
      if (Array.isArray(value)) value.forEach((v) => params.append(key, String(v)));
      else params.append(key, String(value));
    }
  }
  const qs = params.toString();
  const relative = `${API_PREFIX}${path}${qs ? `?${qs}` : ""}`;
  return { url: `${API_BASE_URL}${relative}`, display: relative };
}

async function send<T>(method: HttpMethod, path: string, opts: RequestOptions, session: StoredSession | null): Promise<ApiResponse<T>> {
  const { url, display } = buildUrl(path, opts.query);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (session) headers.Authorization = `${session.tokenType} ${session.accessToken}`;

  const timeout = AbortSignal.timeout(opts.timeoutMs ?? API_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const started = performance.now();

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal,
      cache: "no-store",
    });
  } catch (cause) {
    const kind = timeout.aborted ? "timeout" : opts.signal?.aborted ? "aborted" : "network";
    logRequest({ method, url: display, status: kind, durationMs: performance.now() - started, note: kind === "network" ? String(cause) : undefined });
    throw new ApiError({
      kind,
      message: kind === "network" ? "Network error" : kind === "timeout" ? "Request timed out" : "Request cancelled",
      method,
      path,
      cause,
    });
  }

  const text = await res.text();
  let body: ApiResponse<T> | undefined;
  let parseFailed = false;
  if (text) {
    try {
      body = JSON.parse(text) as ApiResponse<T>;
    } catch {
      parseFailed = true;
    }
  }

  const extend = readErrorExtend(body?.extend);
  const requestId = extend.requestId ?? res.headers.get("X-Request-Id") ?? undefined;
  // HTTP status is authoritative; an error `code` inside a 2xx envelope is treated as an error too.
  const envelopeError = typeof body?.code === "number" && body.code >= 400;
  const failed = !res.ok || envelopeError;

  logRequest({ method, url: display, status: res.status, durationMs: performance.now() - started, errorCode: failed ? extend.errorCode : undefined, requestId });

  if (failed) {
    throw new ApiError({
      kind: "http",
      status: envelopeError && res.ok ? body!.code! : res.status,
      message: body?.msg ?? "",
      errorCode: extend.errorCode,
      fieldErrors: extend.fieldErrors,
      requestId,
      method,
      path,
    });
  }
  if (parseFailed) {
    throw new ApiError({ kind: "parse", status: res.status, message: "Response was not valid JSON", requestId, method, path });
  }
  return body ?? {};
}

// ── Session refresh ──────────────────────────────────────────────────────────

let refreshing: Promise<StoredSession> | null = null;

if (typeof window !== "undefined") startSessionSync();

function noSessionError(path: string, method: string) {
  return new ApiError({ kind: "http", status: 401, errorCode: "NO_SESSION", message: "Please sign in to continue.", method, path });
}

const accessUsable = (s: StoredSession) => s.accessExpiresAt - REFRESH_LEEWAY_MS > Date.now();

/**
 * Exchanges the refresh token for new tokens. Concurrent callers in this tab share one
 * request; across tabs the work runs under a Web Lock (see session-sync.ts).
 */
export function refreshSession(reason: string): Promise<StoredSession> {
  if (refreshing) return refreshing;
  const before = readSession();
  if (!before) {
    endSession("expired");
    return Promise.reject(noSessionError("/auth/refresh", "POST"));
  }
  refreshing = withRefreshLock(() => refreshUnderLock(before, reason)).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function refreshUnderLock(before: StoredSession, reason: string): Promise<StoredSession> {
  // While we waited for the lock, a document sharing this storage (e.g. an iframe) may have rotated the tokens.
  let current = readSession({ fresh: true });
  if (!current) {
    endSession("expired");
    throw noSessionError("/auth/refresh", "POST");
  }
  if (current.refreshToken !== before.refreshToken && accessUsable(current)) {
    logAuth("using a session refreshed by another document");
    return current;
  }
  // A tab that missed the "rotated" broadcast (asleep, discarded) checks before spending its token.
  if (knowsPeers()) {
    const handed = await adoptFromPeers(current, PEER_QUERY_MS);
    if (handed) {
      logAuth("adopted a session refreshed in another tab");
      if (accessUsable(handed)) return handed;
      current = handed;
    }
  }
  if (isRefreshExpired(current)) {
    endSession("expired");
    throw noSessionError("/auth/refresh", "POST");
  }

  logAuth(`refreshing access token (${reason})`);
  const used = current;
  const body: RefreshRequest = { refreshToken: used.refreshToken };
  try {
    const res = await send<TokenResponse>("POST", "/auth/refresh", { body, auth: false }, null);
    const next = res.data ? sessionFromTokens(res.data, used) : null;
    if (!next) throw new ApiError({ kind: "parse", status: 200, message: "Refresh response had no access token", method: "POST", path: "/auth/refresh" });
    writeSession(next);
    await announceRotation(used, next);
    return next;
  } catch (err) {
    // Network/timeout → keep tokens; the user may retry.
    if (!isApiError(err) || (err.kind !== "http" && err.kind !== "parse")) throw err;
    // Rejected. If another tab spent this token first (no Web Locks, or a race), it can hand over its session.
    if (err.kind === "http") {
      const handed = await adoptFromPeers(used, PEER_RESCUE_MS);
      if (handed) {
        logAuth("refresh token already rotated by another tab — adopted its session");
        return handed;
      }
    }
    endSession("expired");
    throw err;
  }
}

async function validSession(method: string, path: string): Promise<StoredSession> {
  if (refreshing) return refreshing;
  const session = readSession();
  if (!session) throw noSessionError(path, method);
  if (session.accessExpiresAt - REFRESH_LEEWAY_MS <= Date.now()) return refreshSession("access token near expiry");
  return session;
}

// ── Public API ───────────────────────────────────────────────────────────────

/** The session an authenticated request would use now (refreshed first if near expiry), or null when signed out. */
export async function usableSession(method: HttpMethod, path: string): Promise<StoredSession | null> {
  if (!readSession({ fresh: true })) return null;
  return validSession(method, path);
}

/** Returns the full envelope (data, total, extend). Throws ApiError on any failure. */
export async function apiRequest<T>(method: HttpMethod, path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  if (opts.auth === false) return send<T>(method, path, opts, null);

  const session = await validSession(method, path);
  try {
    return await send<T>(method, path, opts, session);
  } catch (err) {
    if (!isApiError(err) || err.status !== 401 || err.kind !== "http") throw err;
    // Another request may already have rotated the token while this one was in flight.
    const latest = readSession({ fresh: true });
    const retrySession = latest && latest.accessToken !== session.accessToken ? latest : await refreshSession(`401 on ${method} ${path}`);
    try {
      return await send<T>(method, path, opts, retrySession);
    } catch (retryErr) {
      // Rejected even with a fresh token: the session itself is no longer accepted.
      if (isApiError(retryErr) && retryErr.kind === "http" && retryErr.status === 401) endSession("expired");
      throw retryErr;
    }
  }
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, "body">) => apiRequest<T>("GET", path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => apiRequest<T>("POST", path, { ...opts, body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => apiRequest<T>("PUT", path, { ...opts, body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => apiRequest<T>("PATCH", path, { ...opts, body }),
  delete: <T>(path: string, opts?: RequestOptions) => apiRequest<T>("DELETE", path, opts),
};
