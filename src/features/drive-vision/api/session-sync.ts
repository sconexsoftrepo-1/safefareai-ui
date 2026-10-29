import { logAuth } from "./diagnostics";
import { readSession, writeSession, type StoredSession } from "./session";

/**
 * Cross-tab coordination for refresh-token rotation.
 *
 * The BFF rotates refresh tokens and rejects an old one once it has been used (observed:
 * second use → 401). Tabs keep separate sessionStorage, but "Duplicate tab" (and a restored
 * or discarded tab) starts from a copy of the same tokens, so two tabs can hold one refresh
 * token. Whichever refreshes second would be signed out.
 *
 * - Web Locks serialise refreshes across all same-origin tabs, so two tabs never send the
 *   same refresh token at once. Without Web Locks (old browsers, insecure origins) refreshes
 *   run unserialised and only the hand-over below protects them.
 * - BroadcastChannel hands a rotated session to the tabs that still hold the old token:
 *   "rotated" is pushed after every refresh; a tab that missed it (asleep, discarded) asks
 *   "query" before refreshing, and again if its refresh is rejected. A tab answers only for
 *   tokens it has itself moved past, so tabs signed in as someone else never receive it.
 *
 * Messages carry tokens fingerprinted (SHA-256 prefix) for matching and the new session
 * itself. BroadcastChannel is same-origin and in-memory only — the same exposure as the
 * sessionStorage the tokens already live in. Nothing here is logged.
 */

const CHANNEL_NAME = "safefare:auth:v1";
const LOCK_NAME = "safefare:auth-refresh";
/** Wait before refreshing, for a tab that already rotated our token. Only when peers exist. */
export const PEER_QUERY_MS = 300;
/** Wait after a rejected refresh, before treating the session as expired. */
export const PEER_RESCUE_MS = 1_000;
const MAX_RETIRED = 16;

type Message =
  | { type: "hello" }
  | { type: "here" }
  | { type: "query"; id: string; from: string }
  | { type: "answer"; id: string; from: string; session: StoredSession; retired: string[] }
  | { type: "rotated"; from: string; session: StoredSession; retired: string[] };

let channel: BroadcastChannel | null | undefined;
let peersSeen = false;
/** Fingerprints of refresh tokens this tab has moved past, newest last. */
let retired: string[] = [];
const pendingQueries = new Map<string, (msg: Extract<Message, { type: "answer" }>) => void>();

function isSession(value: unknown): value is StoredSession {
  const s = value as StoredSession | null;
  return (
    !!s &&
    typeof s.accessToken === "string" &&
    s.accessToken.length > 0 &&
    typeof s.refreshToken === "string" &&
    s.refreshToken.length > 0 &&
    typeof s.tokenType === "string" &&
    typeof s.accessExpiresAt === "number" &&
    (s.refreshExpiresAt === null || typeof s.refreshExpiresAt === "number")
  );
}

/** Non-cryptographic fallback (cyrb53) for origins without SubtleCrypto; used for matching only. */
function cyrb53(str: string) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `c${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}`;
}

async function fingerprint(token: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return cyrb53(token);
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

function remember(fingerprints: string[]) {
  retired = [...retired.filter((f) => !fingerprints.includes(f)), ...fingerprints].slice(-MAX_RETIRED);
}

function post(msg: Message) {
  try {
    getChannel()?.postMessage(msg);
  } catch {
    // Channel closed — coordination is best effort.
  }
}

/** Stores a session handed over by another tab, remembering the token it replaces. */
async function adopt(previous: StoredSession, next: StoredSession, peerRetired: string[]) {
  const from = await fingerprint(previous.refreshToken);
  writeSession(next);
  remember([...peerRetired.filter((f) => typeof f === "string"), from]);
}

async function onMessage(msg: Message) {
  switch (msg?.type) {
    case "hello":
      peersSeen = true;
      post({ type: "here" });
      return;
    case "here":
      peersSeen = true;
      return;
    case "query": {
      peersSeen = true;
      const current = readSession();
      if (current && typeof msg.from === "string" && retired.includes(msg.from)) {
        post({ type: "answer", id: msg.id, from: msg.from, session: current, retired: [...retired] });
      }
      return;
    }
    case "answer":
      pendingQueries.get(msg.id)?.(msg);
      return;
    case "rotated": {
      peersSeen = true;
      const current = readSession();
      if (!current || !isSession(msg.session) || !Array.isArray(msg.retired)) return;
      if ((await fingerprint(current.refreshToken)) !== msg.from || readSession() !== current) return;
      await adopt(current, msg.session, msg.retired);
      logAuth("adopted a session refreshed in another tab");
      return;
    }
  }
}

function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return (channel = null);
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (e: MessageEvent<Message>) => void onMessage(e.data);
    channel.postMessage({ type: "hello" } satisfies Message);
  } catch {
    channel = null;
  }
  return channel;
}

/** Joins the channel so this tab can answer and receive hand-overs. Safe to call repeatedly. */
export function startSessionSync() {
  getChannel();
}

/** True once another tab of this app has been heard from. */
export function knowsPeers() {
  return peersSeen;
}

/** Runs `fn` while holding the cross-tab refresh lock (or directly if Web Locks are unavailable). */
export async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return fn();
  return locks.request(LOCK_NAME, fn);
}

/**
 * Asks other tabs for a session that replaced `current`'s refresh token. Adopts and returns
 * it, or null if nobody answers within `timeoutMs`.
 */
export async function adoptFromPeers(current: StoredSession, timeoutMs: number): Promise<StoredSession | null> {
  if (!getChannel()) return null;
  const from = await fingerprint(current.refreshToken);
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const answer = await new Promise<Extract<Message, { type: "answer" }> | null>((resolve) => {
    const timer = setTimeout(() => {
      pendingQueries.delete(id);
      resolve(null);
    }, timeoutMs);
    pendingQueries.set(id, (msg) => {
      if (msg.from !== from || !isSession(msg.session) || !Array.isArray(msg.retired) || msg.session.refreshToken === current.refreshToken) return;
      clearTimeout(timer);
      pendingQueries.delete(id);
      resolve(msg);
    });
    post({ type: "query", id, from });
  });
  if (!answer) return null;
  await adopt(current, answer.session, answer.retired);
  return answer.session;
}

/** Records a completed refresh and pushes the new session to tabs still holding the old token. */
export async function announceRotation(previous: StoredSession, next: StoredSession) {
  const from = await fingerprint(previous.refreshToken);
  remember([from]);
  post({ type: "rotated", from, session: next, retired: [...retired] });
}

/** Forget this tab's token history — on sign-out/expiry, so a later sign-in is never handed to old peers. */
export function forgetLineage() {
  retired = [];
}
