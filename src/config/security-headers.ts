/**
 * HTTP security headers for every route, applied from next.config.ts (`headers()`).
 * Pure module with no imports, so next.config.ts and the unit tests can both load it.
 *
 * Enforced now (no known dependency they could break):
 * - `X-Frame-Options: SAMEORIGIN` + CSP `frame-ancestors 'self'`: blocks other sites from framing
 *   the app (clickjacking on confirm dialogs). Same-origin frames stay allowed: they're used for
 *   width-constrained responsive checks, and session hand-over already supports them.
 * - `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (the
 *   browser default, made explicit; Google Maps' HTTP-referrer key restriction still receives the origin),
 *   and a Permissions-Policy denying camera / microphone / geolocation / payment / USB, which the
 *   app never uses.
 * - CSP `object-src 'none'; base-uri 'self'`.
 *
 * Report-only for now (`Content-Security-Policy-Report-Only`): the full source allow-list. It has
 * not been observed against a running build with maps and the API, so it only reports violations
 * (in the browser console; no reporting endpoint exists) until a browser pass confirms it. CSP
 * reduces the impact of XSS; it doesn't remove it, and tokens stay readable by any script that
 * does run (sessionStorage — see api/session.ts). HSTS belongs on the TLS-terminating proxy.
 */

/** The only site the app frames: the GPS vendor's live video player. */
export const GPS_VIDEO_FRAME_ORIGIN = "https://y.gpstracktech.com";

export interface SecurityHeaderEnv {
  NODE_ENV?: string;
  NEXT_PUBLIC_API_BASE_URL?: string;
  NEXT_PUBLIC_GOOGLE_MAPS_ENABLED?: string;
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?: string;
  /** Comma-separated extra hosts allowed to serve alert evidence (e.g. a storage host the backend starts using). */
  NEXT_PUBLIC_EVIDENCE_MEDIA_HOSTS?: string;
}

/** The GPS vendor's domain, the one media source the app knows of. Subdomains count. */
export const GPS_VENDOR_DOMAIN = "gpstracktech.com";

/** Hosts allowed to serve alert evidence: the vendor, the BFF, and any configured extras. */
export function evidenceMediaHosts(env: SecurityHeaderEnv): string[] {
  const hosts = new Set([GPS_VENDOR_DOMAIN]);
  const api = originOf(env.NEXT_PUBLIC_API_BASE_URL);
  if (api) hosts.add(new URL(api).hostname.toLowerCase());
  for (const raw of (env.NEXT_PUBLIC_EVIDENCE_MEDIA_HOSTS ?? "").split(",")) {
    const host = raw.trim().toLowerCase();
    if (/^[a-z0-9.-]+$/.test(host)) hosts.add(host);
  }
  return [...hosts];
}

/** The same hosts as CSP sources. Report-only, like the rest of that policy. */
function evidenceSources(env: SecurityHeaderEnv): string[] {
  const api = originOf(env.NEXT_PUBLIC_API_BASE_URL);
  const apiHost = api ? new URL(api).hostname.toLowerCase() : null;
  return evidenceMediaHosts(env).flatMap((h) => (h === apiHost ? [] : [`https://${h}`, `https://*.${h}`]));
}

/** `scheme://host[:port]` of an absolute http(s) URL, or null. */
export function originOf(url: string | undefined): string | null {
  if (!url || !url.trim()) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** Origins the browser fetches data from: the BFF. */
export function connectOrigins(env: SecurityHeaderEnv): string[] {
  const api = originOf(env.NEXT_PUBLIC_API_BASE_URL);
  return api ? [api] : [];
}

/** Same rule as map/google-maps-config.ts: enabled only with the switch on and a key present. */
export function googleMapsEnabled(env: SecurityHeaderEnv): boolean {
  return (env.NEXT_PUBLIC_GOOGLE_MAPS_ENABLED ?? "").trim() === "true" && !!env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
}

/**
 * Sources the Maps JavaScript API needs (Google's CSP guide for the Maps JavaScript API), added only when
 * Google Maps is enabled. Nothing Google-related is allowed while maps are disabled.
 */
export function googleMapsSources(env: SecurityHeaderEnv): { script: string[]; img: string[]; connect: string[]; style: string[]; font: string[] } {
  if (!googleMapsEnabled(env)) return { script: [], img: [], connect: [], style: [], font: [] };
  return {
    script: ["https://*.googleapis.com", "https://*.gstatic.com", "*.google.com", "https://*.ggpht.com", "*.googleusercontent.com"],
    img: ["https://*.googleapis.com", "https://*.gstatic.com", "*.google.com", "*.googleusercontent.com"],
    connect: ["https://*.googleapis.com", "*.google.com", "https://*.gstatic.com"],
    style: ["https://fonts.googleapis.com"],
    font: ["https://fonts.gstatic.com"],
  };
}

const join = (directives: [string, ...string[]][]) => directives.map((d) => d.join(" ")).join("; ");

/** Enforced CSP: only directives with no dependency on page resources. */
export function enforcedCsp(): string {
  return join([
    ["frame-ancestors", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
  ]);
}

/**
 * Full allow-list, report-only. Without per-request nonces (pages are statically rendered), Next's
 * inline bootstrap scripts need 'unsafe-inline'; development also needs 'unsafe-eval' (React debug)
 * and ws: for hot reload. Google Maps sources are added only when Google Maps is enabled.
 */
export function reportOnlyCsp(env: SecurityHeaderEnv): string {
  const dev = env.NODE_ENV === "development";
  const connect = connectOrigins(env);
  const media = evidenceSources(env);
  const gm = googleMapsSources(env);
  return join([
    ["default-src", "'self'"],
    ["script-src", "'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : []), ...gm.script],
    ["style-src", "'self'", "'unsafe-inline'", ...gm.style],
    ["img-src", "'self'", "data:", "blob:", ...connect, ...media, ...gm.img],
    ["media-src", "'self'", "blob:", ...connect, ...media],
    ["font-src", "'self'", "data:", ...gm.font],
    ["connect-src", "'self'", ...connect, ...media, ...gm.connect, ...(dev ? ["ws:", "wss:"] : [])],
    ["worker-src", "'self'", "blob:"],
    ["child-src", "'self'", "blob:"],
    // Live Monitoring's camera popup embeds the GPS vendor's player (components/drive-vision/monitoring/gps-video.ts).
    ["frame-src", GPS_VIDEO_FRAME_ORIGIN],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'self'"],
  ]);
}

export function securityHeaders(env: SecurityHeaderEnv): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: enforcedCsp() },
    { key: "Content-Security-Policy-Report-Only", value: reportOnlyCsp(env) },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ];
}
