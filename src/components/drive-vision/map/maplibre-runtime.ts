import { setWorkerUrl } from "maplibre-gl";

// MapLibre v6 is ESM-only; bundlers need the worker URL spelled out (MapLibre docs → Next.js).
setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());

export * from "maplibre-gl";
