/**
 * HTTP security headers for every route, applied from next.config.ts (`headers()`).
 * Pure module with no imports, so next.config.ts and the unit tests can both load it.
 *
 * Enforced now (no known dependency they could break):
 * - `X-Frame-Options: SAMEORIGIN` + CSP `frame-ancestors 'self'`: blocks other sites from framing
 *   the app (clickjacking on confirm dialogs). Same-origin frames stay allowed: they're used for
 *   width-constrained responsive checks, and session hand-over already supports them.
 * - `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (the
 *   browser default, made explicit; MapTiler's allowed-origin check still receives the origin),
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

export interface SecurityHeaderEnv {
  NODE_ENV?: string;
  NEXT_PUBLIC_API_BASE_URL?: string;
  NEXT_PUBLIC_MAPTILER_KEY?: string;
  NEXT_PUBLIC_MAP_STYLE_URL?: string;
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

const MAPTILER_ORIGIN = "https://api.maptiler.com";

/** Origins the browser fetches from: the BFF and the base-map provider (style, tiles, glyphs, sprites). */
export function connectOrigins(env: SecurityHeaderEnv): string[] {
  const origins = new Set<string>();
  const api = originOf(env.NEXT_PUBLIC_API_BASE_URL);
  if (api) origins.add(api);
  const customStyle = originOf(env.NEXT_PUBLIC_MAP_STYLE_URL);
  if (customStyle) origins.add(customStyle);
  // MapTiler is used only when no custom style is set (see map/base-map-config.ts).
  else if (env.NEXT_PUBLIC_MAPTILER_KEY?.trim()) origins.add(MAPTILER_ORIGIN);
  return [...origins];
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
 * and ws: for hot reload. MapLibre runs its worker from /_next/static and may use blob: workers.
 */
export function reportOnlyCsp(env: SecurityHeaderEnv): string {
  const dev = env.NODE_ENV === "development";
  const connect = connectOrigins(env);
  return join([
    ["default-src", "'self'"],
    ["script-src", "'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", "blob:", ...connect],
    ["font-src", "'self'", "data:"],
    ["connect-src", "'self'", ...connect, ...(dev ? ["ws:", "wss:"] : [])],
    ["worker-src", "'self'", "blob:"],
    ["child-src", "'self'", "blob:"],
    ["frame-src", "'none'"],
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
