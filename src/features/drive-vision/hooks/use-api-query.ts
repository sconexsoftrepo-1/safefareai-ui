"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getTenantSelection, subscribeTenantSelection, tenantScopeKey } from "../api/tenant-context";

/**
 * Minimal data-fetching hook for API reads.
 * - Dedupes identical in-flight requests (React strict mode double-mount, sibling components).
 * - Ignores responses for a superseded key or an unmounted component (no stale overwrites).
 * - `refetch` keeps the current data on screen while the new request runs.
 * Pass `key = null` to skip fetching. The fetcher must depend only on what the key encodes.
 * - Tenant isolation (Phase 5): every key is prefixed with the Safe-Fare Admin's tenant scope ("all" or
 *   "t:<id>"). A tenant switch changes every key, so old-tenant data is hidden at once, the new tenant is
 *   fetched, and a late response from the previous tenant can never be shown.
 */
export interface ApiQuery<T> {
  data: T | undefined;
  error: unknown;
  /** No result yet for the current key. */
  loading: boolean;
  /** Re-requesting while showing the previous result for the same key. */
  refreshing: boolean;
  /** Epoch ms of the last successful response (or of the first error if none succeeded). */
  updatedAt: number | null;
  refetch: () => void;
}

const inflight = new Map<string, Promise<unknown>>();

interface Settled<T> {
  key: string;
  token: string;
  data?: T;
  error?: unknown;
  at: number;
}

const scopeSnapshot = () => tenantScopeKey(getTenantSelection());
const serverScope = () => "all";

/** The tenant-scoped form of a query key (exported for tests). */
export const scopedKey = (scope: string, key: string | null) => (key === null ? null : `${scope}|${key}`);

export function useApiQuery<T>(rawKey: string | null, fetcher: () => Promise<T>): ApiQuery<T> {
  const scope = useSyncExternalStore(subscribeTenantSelection, scopeSnapshot, serverScope);
  const key = scopedKey(scope, rawKey);
  const fetcherRef = useRef(fetcher);
  const [nonce, setNonce] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (key === null) return;
    let active = true;
    const token = `${key}#${nonce}`;
    let promise = inflight.get(token) as Promise<T> | undefined;
    if (!promise) {
      promise = fetcherRef.current().finally(() => inflight.delete(token));
      inflight.set(token, promise);
    }
    promise.then(
      (data) => active && setSettled({ key, token, data, at: Date.now() }),
      // A failed refetch keeps the last good data (and its time) for the same key, so polling
      // screens can show "last updated …" with the error instead of going blank.
      (error) => active && setSettled((prev) => (prev?.key === key ? { ...prev, token, error } : { key, token, error, at: Date.now() }))
    );
    return () => {
      active = false;
    };
  }, [key, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  const sameKey = settled !== null && settled.key === key;
  const current = sameKey && settled.token === `${key}#${nonce}`;
  return {
    data: sameKey ? settled.data : undefined,
    error: current ? settled.error : undefined,
    loading: key !== null && !sameKey,
    refreshing: sameKey && !current,
    updatedAt: sameKey ? settled.at : null,
    refetch,
  };
}
