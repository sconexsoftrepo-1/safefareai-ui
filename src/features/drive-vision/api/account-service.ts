import { api } from "./client";
import type { ChangePasswordRequest, CurrentUserDto, PreferencesDto, UpdateMeRequest } from "./types";

/** The signed-in user's own profile, preferences and password (/me/*). Never logs request bodies. */
export const accountService = {
  /** PATCH /api/v1/me → ApiResponseCurrentUserDto. Send only the fields being changed. */
  async updateMe(body: UpdateMeRequest): Promise<CurrentUserDto> {
    return (await api.patch<CurrentUserDto>("/me", body)).data ?? {};
  },

  /** GET /api/v1/me/preferences → ApiResponsePreferencesDto. */
  async preferences(signal?: AbortSignal): Promise<PreferencesDto> {
    return (await api.get<PreferencesDto>("/me/preferences", { signal })).data ?? {};
  },

  /** PUT /api/v1/me/preferences → ApiResponsePreferencesDto. Full replace: pass the loaded object with edits applied. */
  async savePreferences(body: PreferencesDto): Promise<PreferencesDto> {
    return (await api.put<PreferencesDto>("/me/preferences", body)).data ?? {};
  },

  /** POST /api/v1/me/password → ApiResponseVoid. */
  async changePassword(body: ChangePasswordRequest): Promise<void> {
    await api.post<unknown>("/me/password", body);
  },
};
