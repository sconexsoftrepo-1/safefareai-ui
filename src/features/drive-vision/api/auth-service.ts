import { api, endSession, usableSession } from "./client";
import { ApiError } from "./errors";
import { logAuth } from "./diagnostics";
import { sessionFromTokens, writeSession } from "./session";
import type { CurrentUserDto, LoginRequest, MenuNodeDto, RefreshRequest, TokenResponse } from "./types";

/** Auth + current-user endpoints (Phase 1). */
export const authService = {
  /** POST /api/v1/auth/login → ApiResponseTokenResponse. Stores the session on success. */
  async login(request: LoginRequest, signal?: AbortSignal): Promise<TokenResponse> {
    const res = await api.post<TokenResponse>("/auth/login", request, { auth: false, signal });
    const session = res.data ? sessionFromTokens(res.data) : null;
    if (!session) throw new ApiError({ kind: "parse", status: 200, message: "Sign-in response had no tokens", method: "POST", path: "/auth/login" });
    writeSession(session);
    logAuth("signed in — session stored");
    return res.data!;
  },

  /**
   * POST /api/v1/auth/logout with the refresh token. Local tokens are cleared even when the
   * request fails (server down, token already revoked), so the user is always signed out here.
   *
   * Sent with the bearer token: the BFF answers 401 "Authentication required" without it
   * (observed 2026-10-27), and the spec's global `bearerAuth` isn't overridden for this
   * operation. The body's refresh token comes from the same session the request is sent with,
   * refreshed first when needed, so a rotation can't leave a stale token in the body.
   */
  async logout(): Promise<void> {
    try {
      const session = await usableSession("POST", "/auth/logout");
      if (session) {
        const body: RefreshRequest = { refreshToken: session.refreshToken };
        await api.post<unknown>("/auth/logout", body);
      }
    } finally {
      endSession("signed-out");
    }
  },

  /** GET /api/v1/me → ApiResponseCurrentUserDto. */
  async me(signal?: AbortSignal): Promise<CurrentUserDto> {
    const res = await api.get<CurrentUserDto>("/me", { signal });
    return res.data ?? {};
  },

  /** GET /api/v1/me/menus → ApiResponseListMenuNodeDto (menus visible to the current user). */
  async myMenus(signal?: AbortSignal): Promise<MenuNodeDto[]> {
    const res = await api.get<MenuNodeDto[]>("/me/menus", { signal });
    return res.data ?? [];
  },
};
