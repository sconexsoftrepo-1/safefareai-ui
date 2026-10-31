import { useSyncExternalStore } from "react";
import { authService } from "../api/auth-service";
import { onSessionEnded, type SessionEndReason } from "../api/client";
import { describeApiError, isApiError } from "../api/errors";
import { readSession } from "../api/session";
import type { CurrentUserDto, LoginRequest, MenuNodeDto } from "../api/types";

/**
 * Signed-in user state, backed by the BFF (/auth/*, /me, /me/menus). Same
 * useSyncExternalStore pattern as fleet-store / preferences. Holds no tokens —
 * those stay in api/session.
 *
 * `unknown`   before the stored session has been checked (also the SSR snapshot)
 * `error`     a stored session exists but /me couldn't be reached (network / 5xx) — retryable
 */
export type AuthStatus = "unknown" | "authenticated" | "unauthenticated" | "error";

export interface AuthState {
  status: AuthStatus;
  user: CurrentUserDto | null;
  /** null until loaded. */
  menus: MenuNodeDto[] | null;
  menusError: string | null;
  /** Why the last session ended, shown on the sign-in screen. */
  endReason: SessionEndReason | null;
  bootError: string | null;
}

const INITIAL_STATE: AuthState = { status: "unknown", user: null, menus: null, menusError: null, endReason: null, bootError: null };

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

if (typeof window !== "undefined") {
  onSessionEnded((reason) => setState({ status: "unauthenticated", user: null, menus: null, menusError: null, endReason: reason, bootError: null }));
}

async function loadMenus() {
  try {
    const menus = await authService.myMenus();
    setState({ menus, menusError: null });
  } catch (err) {
    if (isApiError(err) && err.status === 401) return; // session ended — handled by the listener
    setState({ menusError: describeApiError(err) });
  }
}

/** Re-requests GET /me/menus after a failure (the error is cleared while it runs). */
export function retryMenus(): Promise<void> {
  if (state.status !== "authenticated") return Promise.resolve();
  setState({ menusError: null });
  return loadMenus();
}

async function loadProfile() {
  const user = await authService.me();
  setState({ status: "authenticated", user, bootError: null, endReason: null });
  void loadMenus();
}

let bootstrapping: Promise<void> | null = null;

/** Validates the stored session once per page load with GET /me. Safe to call repeatedly. */
export function bootstrapAuth(): Promise<void> {
  if (state.status === "authenticated") return Promise.resolve();
  if (bootstrapping) return bootstrapping;
  if (!readSession()) {
    if (state.status !== "unauthenticated") setState({ status: "unauthenticated" });
    return Promise.resolve();
  }
  bootstrapping = loadProfile()
    .catch((err) => {
      if (isApiError(err) && err.status === 401) return; // listener already moved us to unauthenticated
      setState({ status: "error", bootError: describeApiError(err) });
    })
    .finally(() => {
      bootstrapping = null;
    });
  return bootstrapping;
}

/** Throws ApiError so the form can show server field errors. */
export async function signIn(request: LoginRequest): Promise<void> {
  const tokens = await authService.login(request);
  setState({ status: "authenticated", user: tokens.user ?? null, endReason: null, bootError: null, menus: null, menusError: null });
  // Confirm the new token on an authenticated call and pick up the latest profile.
  try {
    await loadProfile();
  } catch (err) {
    // Token rejected straight away → surface it. Otherwise keep the user from the login response.
    if (isApiError(err) && err.status === 401) throw err;
  }
}

/** Replaces the profile after a confirmed PATCH /me (role and permissions come from the server response). */
export function applyCurrentUser(user: CurrentUserDto): void {
  if (state.status === "authenticated") setState({ user });
}

export async function signOut(): Promise<void> {
  await authService.logout().catch(() => {
    // Local session is cleared regardless (see authService.logout); the failure is in the console log.
  });
}
