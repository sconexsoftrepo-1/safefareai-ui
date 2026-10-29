"use client";

import { useSyncExternalStore } from "react";

/**
 * Harmless per-browser UI preferences (no credentials or secrets). Persisted to
 * localStorage when available; every access is guarded because storage can be
 * blocked (private mode, previews). Account-level preferences live on the server (GET/PUT /me/preferences, see settings/).
 */
export interface Preferences {
  displayName: string;
  reduceMotion: boolean;
  dashboardModules: Record<DashboardModule, boolean>;
  assistantEnabled: boolean;
  /** Navigation rail shows labels when true; compact icon rail by default (reference design). */
  sidebarExpanded: boolean;
}

export type DashboardModule = "metrics" | "status" | "trend" | "activity" | "mileage" | "reminders" | "quickLinks";

export const DASHBOARD_MODULE_LABELS: Record<DashboardModule, string> = {
  metrics: "Key metrics",
  status: "Online / offline distribution",
  trend: "Alarm & AI event trend",
  activity: "Recent fleet activity",
  mileage: "Top mileage & driving time",
  reminders: "Expiry & maintenance reminders",
  quickLinks: "Quick links",
};

export const DEFAULT_PREFERENCES: Preferences = {
  displayName: "Sconex Operations",
  reduceMotion: false,
  dashboardModules: { metrics: true, status: true, trend: true, activity: true, mileage: true, reminders: true, quickLinks: true },
  assistantEnabled: true,
  sidebarExpanded: false,
};

const STORAGE_KEY = "drive-vision:preferences:v1";
let current: Preferences = DEFAULT_PREFERENCES;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Preferences>;
      current = { ...DEFAULT_PREFERENCES, ...parsed, dashboardModules: { ...DEFAULT_PREFERENCES.dashboardModules, ...parsed.dashboardModules } };
    }
  } catch {
    // Storage unavailable — keep defaults.
  }
}

export function updatePreferences(patch: Partial<Preferences>) {
  current = { ...current, ...patch };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Ignore — preferences still apply for this session.
  }
  listeners.forEach((l) => l());
}

export function resetPreferences() {
  updatePreferences(DEFAULT_PREFERENCES);
}

function subscribe(listener: () => void) {
  load();
  listeners.add(listener);
  // Notify once after hydration so stored values replace defaults.
  queueMicrotask(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULT_PREFERENCES
  );
}
