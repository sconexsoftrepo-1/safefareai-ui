/**
 * Geographic base map (MapLibre GL JS + MapTiler vector tiles).
 *
 * The MapTiler key is public by design: the browser fetches the style and tiles with it, so
 * it must be restricted to this app's origins in the MapTiler dashboard ("Allowed HTTP
 * origins"). Never put a private/service token here. Every map view sends the viewed area
 * (tile coordinates) to MapTiler. See docs/api-integration-checklist.md → Base map.
 */
export const MAPTILER_KEY = (process.env.NEXT_PUBLIC_MAPTILER_KEY ?? "").trim();

/** MapTiler map id, e.g. streets-v4. */
export const MAPTILER_MAP_ID = (process.env.NEXT_PUBLIC_MAPTILER_MAP ?? "").trim() || "streets-v4";

/**
 * Optional full style URL that replaces MapTiler (self-hosted tiles, or a local test style).
 * When set, no MapTiler key is needed or sent.
 */
export const MAP_STYLE_URL = (process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "").trim();

export type BaseMapSource = { kind: "maptiler" | "custom"; styleUrl: string } | { kind: "none" };

export function baseMapSource(): BaseMapSource {
  if (MAP_STYLE_URL) return { kind: "custom", styleUrl: MAP_STYLE_URL };
  if (MAPTILER_KEY) return { kind: "maptiler", styleUrl: `https://api.maptiler.com/maps/${encodeURIComponent(MAPTILER_MAP_ID)}/style.json?key=${encodeURIComponent(MAPTILER_KEY)}` };
  return { kind: "none" };
}

/** Loads MapLibre on demand (it is browser-only and ~800 kB), configuring its worker once. */
export function loadMapLibre() {
  return import("./maplibre-runtime");
}
