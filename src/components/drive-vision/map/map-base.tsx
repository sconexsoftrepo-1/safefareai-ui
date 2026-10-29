import { memo } from "react";
import { CITY_AREAS, ROAD_LINKS } from "@/features/drive-vision/mock-data/catalog";
import type { LatLon } from "@/features/drive-vision/types";
import { blobFrom, curveFrom, MAP_H, MAP_W, project } from "./projection";

/*
 * Static, stylised cartography for the demo region (Hyderabad). Shapes are
 * approximations for visual context only — this is not a navigational map.
 */
const ring = (c: LatLon, rLat: number, rLon: number, n = 9, wobble = 0.18): LatLon[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + Math.sin(i * 2.3) * wobble;
    return { lat: c.lat + Math.sin(a) * rLat * k, lon: c.lon + Math.cos(a) * rLon * k };
  });

const WATER: LatLon[][] = [
  ring({ lat: 17.4239, lon: 78.4738 }, 0.0085, 0.0075, 10, 0.16), // Hussain Sagar
  ring({ lat: 17.4295, lon: 78.3885 }, 0.003, 0.004, 8, 0.2), // Durgam Cheruvu
  ring({ lat: 17.3385, lon: 78.4425 }, 0.004, 0.0045, 8, 0.2), // Mir Alam tank
  ring({ lat: 17.3685, lon: 78.3095 }, 0.012, 0.01, 10, 0.22), // Osman Sagar edge
  ring({ lat: 17.4905, lon: 78.5205 }, 0.0045, 0.0055, 8, 0.2), // Safilguda lake
];

const RIVER: LatLon[] = [
  { lat: 17.372, lon: 78.3 },
  { lat: 17.3735, lon: 78.355 },
  { lat: 17.369, lon: 78.405 },
  { lat: 17.3705, lon: 78.442 },
  { lat: 17.367, lon: 78.474 },
  { lat: 17.3725, lon: 78.503 },
  { lat: 17.381, lon: 78.535 },
  { lat: 17.3875, lon: 78.57 },
  { lat: 17.392, lon: 78.6 },
];

const PARKS: LatLon[][] = [
  ring({ lat: 17.4204, lon: 78.4227 }, 0.004, 0.0045, 8), // KBR park
  ring({ lat: 17.4575, lon: 78.3555 }, 0.005, 0.006, 8), // Botanical garden
  ring({ lat: 17.4166, lon: 78.5285 }, 0.0065, 0.0075, 9), // Osmania University
  ring({ lat: 17.3835, lon: 78.4012 }, 0.0045, 0.0055, 8), // Golconda
  ring({ lat: 17.4585, lon: 78.3255 }, 0.009, 0.0095, 9), // University campus
  ring({ lat: 17.4425, lon: 78.5085 }, 0.003, 0.0035, 7), // Parade grounds
  ring({ lat: 17.348, lon: 78.513 }, 0.0045, 0.006, 8), // Botanical — south
];

/** Highways that leave the frame, for a sense of regional context. */
const HIGHWAYS: LatLon[][] = [
  [{ lat: 17.4399, lon: 78.4983 }, { lat: 17.475, lon: 78.488 }, { lat: 17.52, lon: 78.48 }], // NH44 north
  [{ lat: 17.4058, lon: 78.5591 }, { lat: 17.41, lon: 78.58 }, { lat: 17.418, lon: 78.6 }], // NH163 east
  [{ lat: 17.3457, lon: 78.5522 }, { lat: 17.33, lon: 78.575 }, { lat: 17.3, lon: 78.585 }], // NH65 south-east
  [{ lat: 17.4968, lon: 78.3614 }, { lat: 17.505, lon: 78.33 }, { lat: 17.512, lon: 78.3 }], // NH65 west
  [{ lat: 17.3713, lon: 78.4312 }, { lat: 17.33, lon: 78.425 }, { lat: 17.3, lon: 78.41 }], // airport road
];

/** Inner ring road, drawn as a smooth loop. */
const RING_ROAD = ring({ lat: 17.405, lon: 78.475 }, 0.062, 0.095, 14, 0.05);

const roadPaths = ROAD_LINKS.map(([a, b]) => {
  const A = CITY_AREAS[a];
  const B = CITY_AREAS[b];
  const mid = { lat: (A.lat + B.lat) / 2 + (B.lon - A.lon) * 0.08, lon: (A.lon + B.lon) / 2 - (B.lat - A.lat) * 0.08 };
  return curveFrom([A, mid, B]);
});

export const MapBase = memo(function MapBase() {
  return (
    <g aria-hidden>
      <defs>
        <pattern id="dv-blocks" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(12)">
          <rect width="26" height="26" fill="var(--dv-map-land)" />
          <path d="M0 0H26M0 0V26" stroke="var(--dv-map-block)" strokeWidth="1.2" />
        </pattern>
      </defs>
      <rect x={-MAP_W} y={-MAP_H} width={MAP_W * 3} height={MAP_H * 3} fill="var(--dv-map-land)" />
      <rect x={-MAP_W * 0.1} y={-MAP_H * 0.1} width={MAP_W * 1.2} height={MAP_H * 1.2} fill="url(#dv-blocks)" opacity={0.75} />

      {PARKS.map((p, i) => (
        <path key={`park-${i}`} d={blobFrom(p)} fill="var(--dv-map-park)" />
      ))}
      <path d={curveFrom(RIVER)} fill="none" stroke="var(--dv-map-water)" strokeWidth={7} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {WATER.map((w, i) => (
        <path key={`water-${i}`} d={blobFrom(w)} fill="var(--dv-map-water)" />
      ))}

      {/* Local roads */}
      <path d={blobFrom(RING_ROAD)} fill="none" stroke="var(--dv-map-road-edge)" strokeWidth={7} vectorEffect="non-scaling-stroke" />
      <path d={blobFrom(RING_ROAD)} fill="none" stroke="var(--dv-map-road)" strokeWidth={5} vectorEffect="non-scaling-stroke" />
      {roadPaths.map((d, i) => (
        <path key={`re-${i}`} d={d} fill="none" stroke="var(--dv-map-road-edge)" strokeWidth={6} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      ))}
      {roadPaths.map((d, i) => (
        <path key={`r-${i}`} d={d} fill="none" stroke="var(--dv-map-road)" strokeWidth={4} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      ))}
      {HIGHWAYS.map((h, i) => (
        <g key={`hw-${i}`}>
          <path d={curveFrom(h)} fill="none" stroke="var(--dv-map-arterial-edge)" strokeWidth={8} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <path d={curveFrom(h)} fill="none" stroke="var(--dv-map-arterial)" strokeWidth={6} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </g>
      ))}
    </g>
  );
});

/** Area labels, counter-scaled so text stays a constant on-screen size. */
export function MapLabels({ unitsPerPx }: { unitsPerPx: number }) {
  return (
    <g aria-hidden style={{ pointerEvents: "none" }}>
      {CITY_AREAS.map((a) => {
        const { x, y } = project(a);
        return (
          <text
            key={a.name}
            x={x}
            y={y - 12 * unitsPerPx}
            textAnchor="middle"
            fontSize={10.5 * unitsPerPx}
            fontWeight={600}
            letterSpacing={0.6 * unitsPerPx}
            fill="var(--dv-map-label)"
            stroke="var(--dv-map-land)"
            strokeWidth={3 * unitsPerPx}
            paintOrder="stroke"
            style={{ textTransform: "uppercase" }}
          >
            {a.name}
          </text>
        );
      })}
    </g>
  );
}
