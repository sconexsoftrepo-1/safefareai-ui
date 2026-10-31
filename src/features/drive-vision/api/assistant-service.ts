import { api } from "./client";
import { toList, type ListResult } from "./fleet-service";
import type { AnswerDto, AskRequest, AssistantPrompt, SearchHit } from "./types";

/** Global search (search-controller) and the fleet assistant (assistant-controller). */
export const assistantService = {
  /**
   * GET /api/v1/search {q*, limit} → ApiResponseMapStringListHit. Result groups are whatever
   * keys the server returns; the UI renders them as-is and doesn't assume a fixed set.
   */
  async search(q: string, limit: number | undefined, signal?: AbortSignal): Promise<Record<string, SearchHit[]>> {
    const data = (await api.get<Record<string, SearchHit[]>>("/search", { query: { q, limit }, signal })).data;
    return data && typeof data === "object" ? data : {};
  },

  /** GET /api/v1/assistant/prompts → ApiResponseListPrompt. */
  async prompts(signal?: AbortSignal): Promise<ListResult<AssistantPrompt>> {
    return toList(await api.get<AssistantPrompt[]>("/assistant/prompts", { signal }));
  },

  /** POST /api/v1/assistant/ask → ApiResponseAnswerDto. */
  async ask(body: AskRequest, signal?: AbortSignal): Promise<AnswerDto> {
    return (await api.post<AnswerDto>("/assistant/ask", body, { signal })).data ?? {};
  },
};
