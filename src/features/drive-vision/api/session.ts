import type { TokenResponse } from "./types";

/**
 * Token storage for the BFF's bearer-token contract.
 *
 * Tokens live in sessionStorage: scoped to one tab, gone when it closes, survives reload.
 * Anything readable by JS is exposed to XSS, so production hardening should move the
 * refresh token to an httpOnly cookie on the server side; that needs a backend change.
 * Token values must never be logged.
 */
export interface StoredSession {
  accessToken: string;
  tokenType: string;
  /** Epoch ms. */
  accessExpiresAt: number;
  refreshToken: string;
  /** Epoch ms; null when the server didn't say. */
  refreshExpiresAt: number | null;
}

const STORAGE_KEY = "safefare:session:v1";
let cached: StoredSession | null | undefined;

/** Reads `exp` (seconds) from a JWT payload without verifying it — expiry hint only. */
function jwtExpiry(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function sessionFromTokens(tokens: TokenResponse, previous?: StoredSession | null): StoredSession | null {
  if (!tokens.accessToken) return null;
  const now = Date.now();
  const refreshToken = tokens.refreshToken ?? previous?.refreshToken;
  if (!refreshToken) return null;
  return {
    accessToken: tokens.accessToken,
    tokenType: tokens.tokenType || "Bearer",
    accessExpiresAt: jwtExpiry(tokens.accessToken) ?? (tokens.expiresIn ? now + tokens.expiresIn * 1000 : now + 5 * 60_000),
    refreshToken,
    refreshExpiresAt: tokens.refreshToken
      ? (jwtExpiry(tokens.refreshToken) ?? (tokens.refreshExpiresIn ? now + tokens.refreshExpiresIn * 1000 : null))
      : (previous?.refreshExpiresAt ?? null),
  };
}

/**
 * `fresh` bypasses the in-memory copy and re-reads storage — another document sharing this
 * tab's sessionStorage (e.g. a same-origin iframe) may have rotated the tokens.
 */
export function readSession(opts?: { fresh?: boolean }): StoredSession | null {
  if (cached !== undefined && !opts?.fresh) return cached;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as StoredSession) : null;
    cached = parsed && parsed.accessToken && parsed.refreshToken ? parsed : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function writeSession(session: StoredSession | null) {
  cached = session;
  try {
    if (session) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked — the session still works for this page load.
  }
}

export function isRefreshExpired(session: StoredSession) {
  return session.refreshExpiresAt !== null && session.refreshExpiresAt <= Date.now();
}
