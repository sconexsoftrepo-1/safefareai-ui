import type { ApiErrorExtend, ApiFieldError } from "./types";

/**
 * `http`      server answered with an error status (or an error `code` in the envelope)
 * `network`   request never got a response (offline, DNS, CORS rejection, connection refused)
 * `timeout`   no response within API_TIMEOUT_MS
 * `aborted`   cancelled by the caller (e.g. component unmounted)
 * `parse`     response body was not the JSON envelope we expected
 */
export type ApiErrorKind = "http" | "network" | "timeout" | "aborted" | "parse";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** HTTP status; 0 when no response was received. */
  readonly status: number;
  /** Server `extend.errorCode`, e.g. INVALID_CREDENTIALS, VALIDATION_FAILED, UNAUTHENTICATED. */
  readonly errorCode?: string;
  readonly fieldErrors: ApiFieldError[];
  /** Correlation id from `extend.requestId` or the X-Request-Id header — quote it when reporting backend issues. */
  readonly requestId?: string;
  readonly method: string;
  readonly path: string;

  constructor(init: {
    kind: ApiErrorKind;
    message: string;
    status?: number;
    errorCode?: string;
    fieldErrors?: ApiFieldError[];
    requestId?: string;
    method: string;
    path: string;
    cause?: unknown;
  }) {
    super(init.message, { cause: init.cause });
    this.name = "ApiError";
    this.kind = init.kind;
    this.status = init.status ?? 0;
    this.errorCode = init.errorCode;
    this.fieldErrors = init.fieldErrors ?? [];
    this.requestId = init.requestId;
    this.method = init.method;
    this.path = init.path;
  }

  get isUnauthorized() {
    return this.status === 401;
  }
  get isForbidden() {
    return this.status === 403;
  }
  get isValidation() {
    return this.status === 400 || this.errorCode === "VALIDATION_FAILED";
  }

  /** Server field errors keyed by field name (first message wins). */
  fieldErrorMap(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const fe of this.fieldErrors) if (!(fe.field in map)) map[fe.field] = fe.message;
    return map;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

export function readErrorExtend(extend: unknown): ApiErrorExtend {
  if (!extend || typeof extend !== "object") return {};
  const e = extend as Record<string, unknown>;
  return {
    errorCode: typeof e.errorCode === "string" ? e.errorCode : undefined,
    requestId: typeof e.requestId === "string" ? e.requestId : undefined,
    fieldErrors: Array.isArray(e.fieldErrors)
      ? e.fieldErrors.filter((f): f is ApiFieldError => !!f && typeof f.field === "string" && typeof f.message === "string")
      : undefined,
  };
}

/** "HTTP 503 · DATA_UNAVAILABLE · ref 1234…" — what to quote when reporting a backend issue. */
export function apiErrorMeta(err: unknown) {
  if (!isApiError(err)) return null;
  return [err.status ? `HTTP ${err.status}` : err.kind, err.errorCode, err.requestId ? `ref ${err.requestId}` : null].filter(Boolean).join(" · ");
}

/** User-facing message for any error thrown by the API layer. Prefers the server's own `msg`. */
export function describeApiError(err: unknown): string {
  if (!isApiError(err)) return "Something went wrong. Please try again.";
  switch (err.kind) {
    case "network":
      return "Can't reach the SafeFare server. Check your connection — if it persists, the server may be down or blocking this origin (CORS).";
    case "timeout":
      return "The server took too long to respond. Please try again.";
    case "aborted":
      return "The request was cancelled.";
    case "parse":
      return `Unexpected response from the server (HTTP ${err.status}).`;
    case "http":
      if (err.message) return err.message;
      if (err.status === 401) return "Your session is not valid. Please sign in again.";
      if (err.status === 403) return "You don't have permission to do that.";
      if (err.status >= 500) return "The server ran into a problem. Please try again shortly.";
      return `Request failed (HTTP ${err.status}).`;
  }
}
