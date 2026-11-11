import type { IrisChatReply } from "@/features/drive-vision/api/iris-chat-service";

/**
 * State of the current Iris conversation. Held in memory only: closing the panel keeps it, and a new chat, a
 * tenant switch or another signed-in user discards it. No older history exists on the client, and the chat
 * service has no endpoint to read any.
 */
export interface IrisMessage {
  id: number;
  role: "user" | "assistant";
  /** Plain text for the user, Markdown for the assistant. */
  text: string;
  /** Epoch ms: `created_at` once the server answered, the send time until then. */
  at: number;
}

export interface IrisFailure {
  /** The question that failed; Retry sends exactly this. */
  question: string;
  text: string;
  meta: string | null;
}

export interface IrisChatState {
  /** Set from the first reply and sent with each later message. */
  conversationUuid: string | null;
  messages: IrisMessage[];
  nextId: number;
  pending: boolean;
  failure: IrisFailure | null;
  /** What the last request said about the service; null until one finished. */
  reachable: boolean | null;
}

export type IrisChatAction =
  | { type: "send"; text: string; at: number }
  | { type: "retry" }
  | { type: "reply"; reply: IrisChatReply }
  | { type: "fail"; failure: IrisFailure; reachable: boolean }
  | { type: "reset" };

export const initialIrisChat: IrisChatState = { conversationUuid: null, messages: [], nextId: 1, pending: false, failure: null, reachable: null };

export function irisChatReducer(state: IrisChatState, action: IrisChatAction): IrisChatState {
  switch (action.type) {
    case "send":
      if (state.pending) return state;
      return {
        ...state,
        messages: [...state.messages, { id: state.nextId, role: "user", text: action.text, at: action.at }],
        nextId: state.nextId + 1,
        pending: true,
        failure: null,
      };
    case "retry":
      // The question is already in the thread, so it isn't added again.
      return state.pending || !state.failure ? state : { ...state, pending: true, failure: null };
    case "reply": {
      const { reply } = action;
      const last = state.messages.length - 1;
      return {
        ...state,
        conversationUuid: reply.conversationUuid,
        messages: [
          ...state.messages.map((m, i) => (i === last && m.role === "user" ? { ...m, at: reply.createdAt } : m)),
          { id: state.nextId, role: "assistant" as const, text: reply.assistantMessage, at: reply.createdAt },
        ],
        nextId: state.nextId + 1,
        pending: false,
        failure: null,
        reachable: true,
      };
    }
    case "fail":
      return { ...state, pending: false, failure: action.failure, reachable: action.reachable };
    case "reset":
      return initialIrisChat;
  }
}

/** Time of day, with the date when it isn't today. */
export function formatIrisTime(at: number, now = Date.now()): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return date.toDateString() === new Date(now).toDateString() ? time : `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
}

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Where a link in an assistant message may point: http(s), mailto, or a path inside this app. Anything else
 * (javascript:, data:, protocol-relative, embedded credentials) gives "", which renders as plain text.
 */
export function safeIrisHref(raw: string): string {
  const value = raw.trim();
  // Browsers strip tabs and newlines from URLs, so "/<tab>/evil.example" would become "//evil.example".
  if (!value || /[\s\u0000-\u001f]/.test(value)) return "";
  if (/^\/(?![/\\])/.test(value)) return value;
  try {
    const url = new URL(value);
    return SAFE_PROTOCOLS.has(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}
