import { useSyncExternalStore } from "react";
import { authService } from "../api/auth-service";
import { onSessionEnded, onSessionRefreshed, type SessionEndReason } from "../api/client";
import { describeApiError, isApiError } from "../api/errors";
import { readSession } from "../api/session";
import type { CurrentUserDto, LoginRequest } from "../api/types";
import { readIdentity, type Identity } from "../access/identity";
import { setTenantSelection } from "../api/tenant-context";

/**
 * Signed-in user state, backed by the BFF (/auth/*, GET /me, GET /me/permissions). Same
 * useSyncExternalStore pattern as preferences. Holds no tokens — those stay in api/session, shared by
 * every API client (the BFF today, the Python service later): one login, one token, one identity.
 *
 * Two server sources, one job each:
 * - `user`     GET /me — profile shown in the UI (name, email, tenant name). Never used to authorise.
 * - `identity` GET /me/permissions — platform flag, tenant, role code, permission codes, screens.
 *              The only input of the access policy. `null` (missing or malformed) means no access.
 *
 * `unknown`   before the stored session has been checked (also the SSR snapshot)
 * `error`     a session exists but /me or /me/permissions couldn't be loaded (network / 5xx) — retryable;
 *             the shell isn't rendered, so nothing is shown with an unverified identity
 */
export type AuthStatus = "unknown" | "authenticated" | "unauthenticated" | "error";

export interface AuthState {
  status: AuthStatus;
  user: CurrentUserDto | null;
  identity: Identity | null;
  /** Why the last session ended, shown on the sign-in screen. */
  endReason: SessionEndReason | null;
  bootError: string | null;
}

const INITIAL_STATE: AuthState = { status: "unknown", user: null, identity: null, endReason: null, bootError: null };
/** Everything tied to a signed-in user; cleared together so no access survives a session. */
const SIGNED_OUT: Pick<AuthState, "user" | "identity" | "bootError"> = { user: null, identity: null, bootError: null };

let state: AuthState = INITIAL_STATE;
const listeners = new Set<() => void>();

function setState(patch: Partial<AuthState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAuth<T>(selector: (s: AuthState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(INITIAL_STATE)
  );
}

export const getAuthState = () => state;

/**
 * An expired session keeps its page in `/login?next=`, so the same user returns to it. Whose page that is goes here,
 * so another account signing in on that URL doesn't inherit it. It is an account id, not a secret, and it stays in
 * this tab. A sign-out clears it, and sign-out sends no `next` at all (AuthGate).
 */
const EXPIRED_OWNER_KEY = "safefare:expired-session-owner:v1";
const ownerOf = (identity: Identity | null) => (identity && identity.userId !== null ? `${identity.tenantId ?? "platform"}:${identity.userId}` : null);

function rememberExpiredOwner(reason: SessionEndReason) {
  try {
    const owner = reason === "expired" ? ownerOf(state.identity) : null;
    if (owner) window.sessionStorage.setItem(EXPIRED_OWNER_KEY, owner);
    else window.sessionStorage.removeItem(EXPIRED_OWNER_KEY);
  } catch {
    // Storage can be blocked. Without the record the requested page still has to pass the access check.
  }
}

/** Whether a `next` left by an expired session may be used by this identity. */
export function mayResumeRoute(identity: Identity | null): boolean {
  try {
    const owner = window.sessionStorage.getItem(EXPIRED_OWNER_KEY);
    return owner === null || owner === ownerOf(identity);
  } catch {
    return true;
  }
}

if (typeof window !== "undefined") {
  onSessionEnded((reason) => {
    rememberExpiredOwner(reason);
    setState({ ...SIGNED_OUT, status: "unauthenticated", endReason: reason });
  });
  onSessionRefreshed(() => void refreshIdentity());
}

/** Loads profile and identity together; the session counts as authenticated only once both arrived. */
async function loadSession() {
  const [user, permissions] = await Promise.all([authService.me(), authService.myPermissions()]);
  // A new session starts platform-wide: no tenant selection survives a sign-in or a session restore.
  setTenantSelection(null);
  setState({ status: "authenticated", user, identity: readIdentity(permissions), bootError: null, endReason: null });
}

let bootstrapping: Promise<void> | null = null;

/** Validates the stored session once per page load with GET /me + GET /me/permissions. Safe to call repeatedly. */
export function bootstrapAuth(): Promise<void> {
  if (state.status === "authenticated") return Promise.resolve();
  if (bootstrapping) return bootstrapping;
  if (!readSession()) {
    if (state.status !== "unauthenticated") setState({ ...SIGNED_OUT, status: "unauthenticated" });
    return Promise.resolve();
  }
  bootstrapping = loadSession()
    .catch((err) => {
      if (isApiError(err) && err.status === 401) return; // listener already moved us to unauthenticated
      setState({ ...SIGNED_OUT, status: "error", bootError: describeApiError(err) });
    })
    .finally(() => {
      bootstrapping = null;
    });
  return bootstrapping;
}

/**
 * Signs in, then loads profile + identity. Throws ApiError so the form can show server field errors.
 * If the token works but the identity can't be loaded, the state becomes the retryable `error`
 * (tokens kept, nothing rendered) and the error is rethrown for the form.
 */
export async function signIn(request: LoginRequest): Promise<void> {
  await authService.login(request);
  try {
    await loadSession();
  } catch (err) {
    if (!(isApiError(err) && err.status === 401)) setState({ ...SIGNED_OUT, status: "error", bootError: describeApiError(err) });
    throw err;
  }
}

/**
 * Re-reads GET /me/permissions (e.g. after a tenant switch or a permission change). On failure the
 * identity is dropped rather than kept stale: the state becomes the retryable `error`.
 */
export async function refreshIdentity(): Promise<void> {
  if (state.status !== "authenticated") return;
  try {
    const identity = readIdentity(await authService.myPermissions());
    // Only a platform identity may carry a selected tenant.
    if (!identity?.platform) setTenantSelection(null);
    setState({ identity });
  } catch (err) {
    if (isApiError(err) && err.status === 401) return;
    setState({ ...SIGNED_OUT, status: "error", bootError: describeApiError(err) });
  }
}

/** Replaces the profile after a confirmed PATCH /me. Authorisation is unaffected (it reads `identity`). */
export function applyCurrentUser(user: CurrentUserDto): void {
  if (state.status === "authenticated") setState({ user });
}

export async function signOut(): Promise<void> {
  await authService.logout().catch(() => {
    // Local session is cleared regardless (see authService.logout); the failure is in the console log.
  });
}
