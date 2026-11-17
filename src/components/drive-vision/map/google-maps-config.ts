/**
 * Google Maps activation switch.
 *
 * The Maps JavaScript API loads only when BOTH are set at build time:
 *   NEXT_PUBLIC_GOOGLE_MAPS_ENABLED=true
 *   NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=<browser key restricted to the app's HTTP referrers>
 * Otherwise no script is created, importLibrary() is never called and no map provider is contacted;
 * GeoMap shows a "Google Maps is currently disabled." placeholder instead.
 *
 * The key is a public browser key (Google sends it with every map request), so it must be restricted
 * to this app's referrers and to the Maps JavaScript API in Google Cloud Console. Never log it.
 */

export type MapTypeId = "roadmap" | "satellite" | "hybrid";

/** The three supported views, in selector order. Roadmap is the default. */
export const MAP_TYPES: readonly { id: MapTypeId; label: string }[] = [
  { id: "roadmap", label: "Roadmap" },
  { id: "satellite", label: "Satellite" },
  { id: "hybrid", label: "Hybrid" },
];

export const DEFAULT_MAP_TYPE: MapTypeId = "roadmap";

export interface GoogleMapsEnv {
  NEXT_PUBLIC_GOOGLE_MAPS_ENABLED?: string;
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?: string;
}

export type GoogleMapsConfig = { enabled: true; apiKey: string } | { enabled: false; reason: "disabled" | "missing-key" };

/** Pure: decides from the given values whether Google Maps may load. */
export function resolveGoogleMapsConfig(env: GoogleMapsEnv): GoogleMapsConfig {
  if ((env.NEXT_PUBLIC_GOOGLE_MAPS_ENABLED ?? "").trim() !== "true") return { enabled: false, reason: "disabled" };
  const apiKey = (env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "").trim();
  if (!apiKey) return { enabled: false, reason: "missing-key" };
  return { enabled: true, apiKey };
}

/**
 * The build's configuration. The two variables are read by their literal names so Next.js inlines
 * them at build time (static export has no runtime environment).
 */
export function googleMapsConfig(): GoogleMapsConfig {
  return resolveGoogleMapsConfig({
    NEXT_PUBLIC_GOOGLE_MAPS_ENABLED: process.env.NEXT_PUBLIC_GOOGLE_MAPS_ENABLED,
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
  });
}
