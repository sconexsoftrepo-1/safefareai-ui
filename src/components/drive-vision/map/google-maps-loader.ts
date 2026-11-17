import type { CoreLibrary, GoogleMapsRuntime, MapsLibrary } from "./google-maps-types";

/**
 * Loads the Google Maps JavaScript API once, on demand, with Google's dynamic library import
 * (https://developers.google.com/maps/documentation/javascript/load-maps-js-api#dynamic-library-import).
 *
 * `installBootstrap` is the official inline bootstrap loader written out in TypeScript: it defines a
 * `google.maps.importLibrary` stub that adds the API <script> on its first call; the real API then
 * replaces the stub. Only the "maps" and "core" libraries are requested — no Places, Directions,
 * Geocoding or other services.
 *
 * Callers must check `googleMapsConfig()` first: nothing here runs unless Google Maps is enabled
 * and a key is configured, and nothing runs during server rendering or static export.
 */

const SCRIPT_ORIGIN = "https://maps.googleapis.com";
const SCRIPT_MARKER = "data-dv-google-maps";
const CALLBACK = "__ib__";

type ImportLibrary = (name: string) => Promise<unknown>;
interface GoogleGlobal {
  maps?: { importLibrary?: ImportLibrary; [CALLBACK]?: () => void };
}
type MapsWindow = Window & { google?: GoogleGlobal; gm_authFailure?: () => void };

let runtime: Promise<GoogleMapsRuntime> | null = null;
let authFailed = false;
const authListeners = new Set<() => void>();

function installBootstrap(w: MapsWindow, apiKey: string) {
  const g = (w.google ??= {});
  const maps = (g.maps ??= {});
  // Already present: the real API, an earlier bootstrap, or a test double. Never add a second script.
  if (maps.importLibrary) return;
  let pending: Promise<void> | null = null;
  const libraries = new Set<string>();
  const load = () =>
    (pending ??= new Promise<void>((resolve, reject) => {
      // Defer one microtask (as the official bootstrap does) so libraries requested together share one script.
      void Promise.resolve().then(() => addScript(resolve, reject));
    }));
  const addScript = (resolve: () => void, reject: (e: Error) => void) => {
    const doc = w.document;
    const params = new URLSearchParams({ key: apiKey, v: "weekly", libraries: [...libraries].join(","), callback: `google.maps.${CALLBACK}` });
    const script = doc.createElement("script");
    script.src = `${SCRIPT_ORIGIN}/maps/api/js?${params.toString()}`;
    script.async = true;
    script.setAttribute(SCRIPT_MARKER, "");
    maps[CALLBACK] = () => resolve();
    script.onerror = () => {
      // Remove the failed script and the stub so a retry starts from scratch.
      script.remove();
      pending = null;
      delete maps.importLibrary;
      reject(new Error("The Google Maps script could not be loaded."));
    };
    doc.head.append(script);
  };
  const stub: ImportLibrary = (name) => {
    libraries.add(name);
    return load().then(() => {
      const real = maps.importLibrary;
      if (!real || real === stub) throw new Error("Google Maps did not initialise.");
      return real(name);
    });
  };
  maps.importLibrary = stub;
}

function watchAuthFailure(w: MapsWindow) {
  if (w.gm_authFailure) return;
  // Google calls this global when the key is invalid, unauthorised for this referrer, or billing is off.
  w.gm_authFailure = () => {
    authFailed = true;
    authListeners.forEach((fn) => fn());
  };
}

/** Resolves the "maps" and "core" libraries, loading the API at most once per page. */
export function loadGoogleMaps(apiKey: string): Promise<GoogleMapsRuntime> {
  if (typeof window === "undefined") return Promise.reject(new Error("Google Maps can only load in the browser."));
  if (runtime) return runtime;
  const w = window as MapsWindow;
  watchAuthFailure(w);
  installBootstrap(w, apiKey);
  const importLibrary = w.google!.maps!.importLibrary!;
  runtime = Promise.all([importLibrary("maps"), importLibrary("core")]).then(([maps, core]) => ({ maps: maps as MapsLibrary, core: core as CoreLibrary }));
  // A failed load must be retryable.
  runtime.catch(() => {
    runtime = null;
  });
  return runtime;
}

/** True once Google has rejected the key on this page (gm_authFailure). */
export function googleMapsAuthFailed() {
  return authFailed;
}

/** Subscribes to key rejection; returns the unsubscribe function. */
export function onGoogleMapsAuthFailure(fn: () => void): () => void {
  authListeners.add(fn);
  return () => {
    authListeners.delete(fn);
  };
}
