import { ApiError, isApiError } from "./errors";
import { PYTHON_API_PATHS, pythonFetch, pythonPath } from "./python-client";

/**
 * Iris chat client (browser side), calling the Python API DIRECTLY (python-client.ts; temporary demo integration).
 *
 * Deliberately not the `api` client: that one attaches the tenant header and the Safe-Fare token and talks to the
 * BFF. Iris receives neither: no Authorization header, no cookies, no tenant. Only the documented ChatRequest
 * fields are sent (readChatRequest). The Python host must allow this site's origin (CORS).
 *
 * Contract: <Python API>/openapi.json ("Iris AI" 1.0.0), `ChatRequest` / `ChatResponse`.
 */
export const IRIS_CHAT_ENDPOINT = PYTHON_API_PATHS.irisChat;
export const IRIS_HEALTH_ENDPOINT = PYTHON_API_PATHS.irisHealth;

/** ChatRequest.message maxLength. */
export const IRIS_MAX_MESSAGE = 10_000;

const REQUEST_TIMEOUT_MS = 60_000;
const HEALTH_TIMEOUT_MS = 10_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isConversationUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export interface IrisChatReply {
  conversationUuid: string;
  userMessage: string;
  /** Markdown from the server. */
  assistantMessage: string;
  /** Epoch ms of `created_at`. */
  createdAt: number;
}

/**
 * Epoch ms of a server timestamp, or null. The service sends UTC without a zone suffix, with microseconds
 * ("2026-11-06T04:57:23.174000"); `new Date()` alone would read that as local time.
 */
export function parseIrisTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(" ", "T").replace(/(\.\d{3})\d+/, "$1");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return null;
  const ms = Date.parse(/(?:z|[+-]\d{2}(?::?\d{2})?)$/i.test(text) ? text : `${text}Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** The reply, or null when any required ChatResponse field is missing or unusable. */
export function parseIrisChatResponse(body: unknown): IrisChatReply | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const createdAt = parseIrisTimestamp(b.created_at);
  if (!isConversationUuid(b.conversation_uuid) || typeof b.user_message !== "string" || createdAt === null) return null;
  if (typeof b.assistant_message !== "string" || !b.assistant_message.trim()) return null;
  return { conversationUuid: b.conversation_uuid, userMessage: b.user_message, assistantMessage: b.assistant_message, createdAt };
}

/** The fields the contract defines, or null when the request doesn't satisfy it. Anything else is dropped. */
export function readChatRequest(raw: unknown): { message: string; conversation_uuid?: string } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { message, conversation_uuid: uuid } = raw as Record<string, unknown>;
  if (typeof message !== "string" || !message.trim() || message.length > IRIS_MAX_MESSAGE) return null;
  if (uuid === undefined || uuid === null) return { message };
  return isConversationUuid(uuid) ? { message, conversation_uuid: uuid } : null;
}

function parseFailure(status: number, message: string) {
  return new ApiError({ kind: "parse", status, message, method: "POST", path: IRIS_CHAT_ENDPOINT });
}

export const irisChatService = {
  /** Sends one message. `conversationUuid` continues that conversation; null starts a new one. */
  async send({ message, conversationUuid }: { message: string; conversationUuid: string | null }, signal?: AbortSignal): Promise<IrisChatReply> {
    const body = readChatRequest(conversationUuid ? { message, conversation_uuid: conversationUuid } : { message });
    if (!body) throw new ApiError({ kind: "http", status: 400, message: "", method: "POST", path: IRIS_CHAT_ENDPOINT });
    let res: Response;
    let text: string;
    try {
      res = await pythonFetch(pythonPath(PYTHON_API_PATHS.irisChat), { method: "POST", body, signal, timeoutMs: REQUEST_TIMEOUT_MS });
      text = await res.text();
    } catch (cause) {
      if (isApiError(cause)) throw cause;
      throw new ApiError({ kind: signal?.aborted ? "aborted" : "network", message: "", method: "POST", path: IRIS_CHAT_ENDPOINT, cause });
    }
    // The server's error text is never shown: describeIrisError picks the wording from the status.
    if (!res.ok) throw new ApiError({ kind: "http", status: res.status, message: "", method: "POST", path: IRIS_CHAT_ENDPOINT });

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw parseFailure(res.status, "Response was not valid JSON");
    }
    const reply = parseIrisChatResponse(json);
    if (!reply) throw parseFailure(res.status, "Response is missing required fields");
    // An answer from another conversation must not land in this one.
    if (conversationUuid && reply.conversationUuid.toLowerCase() !== conversationUuid.toLowerCase()) {
      throw parseFailure(res.status, "Response belongs to a different conversation");
    }
    return reply;
  },

  /** True when GET /health answers 2xx. Unreachable, blocked by CORS or not configured → false. */
  async health(signal?: AbortSignal): Promise<boolean> {
    try {
      const res = await pythonFetch(pythonPath(PYTHON_API_PATHS.irisHealth), { signal, timeoutMs: HEALTH_TIMEOUT_MS });
      return res.ok;
    } catch {
      return false;
    }
  },
};

/** User-facing message for a failed chat request. Contains no server text. */
export function describeIrisError(err: unknown): string {
  if (!isApiError(err)) return "Iris couldn't answer. Please try again.";
  switch (err.kind) {
    case "network":
      return "Can't reach Iris. The service may be down, or its CORS settings don't allow this site.";
    case "timeout":
      return "Iris took too long to respond. Please try again.";
    case "aborted":
      return "The request was cancelled.";
    case "parse":
      return "Iris sent a response that couldn't be read. Please try again.";
    case "http":
      if (err.status === 400 || err.status === 413 || err.status === 422) return "Iris couldn't accept that message. Check it and try again.";
      if (err.status === 401 || err.status === 403) return "You don't have access to Iris right now.";
      if (err.status === 404) return "The Iris service wasn't found. Please try again later.";
      if (err.status === 429) return "Iris is receiving too many requests. Please wait a moment and try again.";
      if (err.errorCode === "not_configured") return "Iris isn't configured for this site.";
      if (err.status >= 500) return `Iris is unavailable right now (HTTP ${err.status}). Please try again shortly.`;
      return "Iris couldn't answer. Please try again.";
  }
}

/** The failure says the service is down, as opposed to rejecting this one request. */
export const isIrisOutage = (err: unknown) => isApiError(err) && (err.kind === "network" || err.kind === "timeout" || err.status >= 500);
