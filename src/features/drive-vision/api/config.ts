/**
 * API configuration from NEXT_PUBLIC_ env vars (inlined at build time — see .env.example).
 * Values here are public by design; never add secrets.
 */
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "");
export const API_PREFIX = "/api/v1";

const parsedTimeout = Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS);
export const API_TIMEOUT_MS = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 15_000;

/** Request diagnostics: on in development unless explicitly disabled, never in production. */
export const API_DEBUG = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_API_DEBUG !== "false";

export const DEFAULT_TENANT_CODE = process.env.NEXT_PUBLIC_DEFAULT_TENANT_CODE ?? "";

/** Refresh the access token this long before it expires, so requests don't race expiry. */
export const REFRESH_LEEWAY_MS = 30_000;
