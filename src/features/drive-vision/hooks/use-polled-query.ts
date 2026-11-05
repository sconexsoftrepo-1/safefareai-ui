"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { onSessionEnded } from "../api/client";
import { isApiError } from "../api/errors";
import { getTenantSelection, subscribeTenantSelection, tenantScopeKey } from "../api/tenant-context";
import { createPoller, type Poller, type PollerOptions } from "./poller";
import { scopedKey, type ApiQuery } from "./use-api-query";

export interface PolledQuery<T> extends ApiQuery<T> {
  /** The last poll failed and `data` is from an earlier one. */
  stale: boolean;
}

interface Settled<T> {
  key: string;
  data?: T;
  /** Serialized `data`: an identical response changes nothing. */
  json?: string;
  error?: unknown;
  errorId?: string;
  /** Epoch ms of the last change; after a failed poll, of the last success. */
  at: number;
}

const HALTING_STATUSES = new Set([400, 401, 403, 404]);

/**
 * Failures the next poll can't fix: a refused query or permission, or a session the API client couldn't refresh
 * (it has already tried: a poll only sees a 401 when that failed). Network errors, timeouts and 5xx retry.
 */
export const haltsPolling = (error: unknown) => isApiError(error) && error.kind === "http" && HALTING_STATUSES.has(error.status);

const errorId = (error: unknown) => (isApiError(error) ? `${error.kind}:${error.status}:${error.errorCode}` : String(error));

const scopeSnapshot = () => tenantScopeKey(getTenantSelection());
const serverScope = () => "all";

/**
 * `useApiQuery` for live lists. Pass `key = null` to stop. A new key (or tenant, as with useApiQuery) starts a new
 * poller at once and the old one is aborted, so there is one loop per mounted query, also under React Strict Mode.
 * A failed poll keeps the last data on screen. Polls never set `refreshing`: lists must not flash every 5 seconds.
 */
export function usePolledQuery<T>(rawKey: string | null, fetcher: (signal: AbortSignal) => Promise<T>, options: Pick<PollerOptions<T>, "intervalMs" | "env"> = {}): PolledQuery<T> {
  const scope = useSyncExternalStore(subscribeTenantSelection, scopeSnapshot, serverScope);
  const key = scopedKey(scope, rawKey);
  const fetcherRef = useRef(fetcher);
  const pollerRef = useRef<Poller | null>(null);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const { intervalMs, env } = options;

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (key === null) return;
    let lastSuccess: number | null = null;
    const poller = createPoller<T>({
      run: (signal) => fetcherRef.current(signal),
      intervalMs,
      env,
      shouldHalt: haltsPolling,
      onData: (data) => {
        lastSuccess = Date.now();
        const json = JSON.stringify(data);
        setSettled((prev) => (prev?.key === key && prev.json === json && prev.error === undefined ? prev : { key, data, json, at: Date.now() }));
      },
      onError: (error) => {
        const id = errorId(error);
        setSettled((prev) => {
          if (prev?.key !== key) return { key, error, errorId: id, at: Date.now() };
          return prev.errorId === id ? prev : { ...prev, error, errorId: id, at: lastSuccess ?? prev.at };
        });
      },
    });
    pollerRef.current = poller;
    poller.start();
    const unsubscribe = onSessionEnded(() => poller.stop());
    return () => {
      unsubscribe();
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
    };
  }, [key, intervalMs, env]);

  const refetch = useCallback(() => pollerRef.current?.pollNow(), []);

  const current = settled !== null && settled.key === key ? settled : null;
  return {
    data: current?.data,
    error: current?.error,
    loading: key !== null && current === null,
    refreshing: false,
    updatedAt: current?.at ?? null,
    refetch,
    stale: current?.data !== undefined && current.error !== undefined,
  };
}
