import { api, endSession, usableSession } from "./client";
import { ApiError } from "./errors";
import { logAuth } from "./diagnostics";
import { sessionFromTokens, writeSession } from "./session";
import type { CurrentUserDto, LoginRequest, MenuNodeDto, MyPermissionsDto, RefreshRequest, TokenResponse } from "./types";

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

  /**
   * GET /api/v1/me/permissions → ApiResponseMyPermissionsDto: the effective identity (platform flag,
   * home / current tenant, role, permission codes, screens + operations). The frontend's single source
   * for authorisation; `null` when the server sends no data (callers fail closed).
   */
  async myPermissions(signal?: AbortSignal): Promise<MyPermissionsDto | null> {
    const res = await api.get<MyPermissionsDto>("/me/permissions", { signal });
    return res.data ?? null;
  },

  /**
   * GET /api/v1/me/menus → ApiResponseListMenuNodeDto (menus visible to the current user).
   * No longer read by the app since V10 (navigation follows GET /me/permissions `screens`); kept for
   * the Screen/Menu Management phase.
   */
  async myMenus(signal?: AbortSignal): Promise<MenuNodeDto[]> {
    const res = await api.get<MenuNodeDto[]>("/me/menus", { signal });
    return res.data ?? [];
  },
};
