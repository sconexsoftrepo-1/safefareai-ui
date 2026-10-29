"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowUpRight, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import { EASE_OUT } from "../shared/motion";
import type { GroupCardData } from "./live-dashboard-model";

/** Pastel entity tones (reference: one soft tint per card, darker silhouette in the same hue). */
const TONES = [
  { bg: "bg-mint", ink: "#3f7a5c", dot: "#9fdcbc" },
  { bg: "bg-peach", ink: "#8a5a45", dot: "#f2b48f" },
  { bg: "bg-sky", ink: "#3d6787", dot: "#9fcbe6" },
  { bg: "bg-butter", ink: "#7d6a3a", dot: "#ecd27f" },
  { bg: "bg-lavender", ink: "#5f4a8a", dot: "#c4a8ec" },
  { bg: "bg-rose", ink: "#8a4a62", dot: "#ecaac0" },
] as const;

type Shape = "truck" | "van" | "bus" | "car";

function shapeFor(vehicleType: string): Shape {
  const t = vehicleType.toLowerCase();
  if (t.includes("bus") || t.includes("shuttle")) return "bus";
  if (t.includes("van") || t.includes("pickup")) return "van";
  if (t.includes("truck")) return "truck";
  return "car";
}

/** Minimal flat vehicle silhouette for the card header. */
function VehicleIllustration({ shape, ink, dot }: { shape: Shape; ink: string; dot: string }) {
  return (
    <svg viewBox="0 0 220 110" className="h-full w-full" aria-hidden>
      <circle cx="186" cy="26" r="10" fill={dot} />
      <rect x="10" y="94" width="200" height="3" rx="1.5" fill={ink} opacity="0.12" />
      {shape === "truck" ? (
        <g>
          <rect x="44" y="34" width="96" height="54" rx="6" fill={ink} opacity="0.9" />
          <path d="M142 52h26l16 18v18h-42z" fill={ink} opacity="0.7" />
          <rect x="150" y="57" width="16" height="12" rx="2" fill="white" opacity="0.55" />
        </g>
      ) : shape === "bus" ? (
        <g>
          <rect x="34" y="32" width="150" height="56" rx="12" fill={ink} opacity="0.88" />
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} x={46 + i * 25} y="42" width="18" height="16" rx="3" fill="white" opacity="0.55" />
          ))}
          <rect x="168" y="42" width="10" height="30" rx="3" fill="white" opacity="0.4" />
        </g>
      ) : shape === "van" ? (
        <g>
          <path d="M48 40a8 8 0 0 1 8-8h70l34 26v30H48z" fill={ink} opacity="0.88" />
          <path d="M128 40h-2v18h30z" fill="white" opacity="0.5" />
          <rect x="60" y="44" width="54" height="12" rx="3" fill="white" opacity="0.3" />
        </g>
      ) : (
        <g>
          <path d="M52 66l18-24a10 10 0 0 1 8-4h52a10 10 0 0 1 8 4l18 24h4a8 8 0 0 1 8 8v14H40V74a8 8 0 0 1 8-8z" fill={ink} opacity="0.88" />
          <path d="M80 46h22v18H70zM108 46h22l12 18h-34z" fill="white" opacity="0.5" />
        </g>
      )}
      {(shape === "bus" ? [64, 160] : shape === "truck" ? [66, 118, 166] : [72, 146]).map((x) => (
        <g key={x}>
          <circle cx={x} cy="88" r="10" fill={ink} />
          <circle cx={x} cy="88" r="4" fill="white" opacity="0.7" />
        </g>
      ))}
    </svg>
  );
}

/**
 * Group cards from GET /groups joined with the device list and alarms in range.
 * Online share and distance need per-device status / mileage the API doesn't define, so they show "—".
 */
export function FleetGroups({ cards }: { cards: GroupCardData[] }) {
  return (
    <ul className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @5xl:grid-cols-3">
      {cards.map((c, i) => {
        const tone = TONES[i % TONES.length];
        return (
          <motion.li
            key={c.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: EASE_OUT, delay: 0.1 + (i % 3) * 0.05 }}
            className="group/card flex flex-col rounded-card border border-line/60 bg-surface p-2.5 shadow-card transition-[box-shadow,transform,border-color] duration-[180ms] ease-dv hover:-translate-y-0.5 hover:border-line/80 hover:shadow-hover"
          >
            <Link href={`/drive-vision/vehicles?group=${c.id}`} className="block rounded-inner focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none" aria-label={`${c.name}: view vehicles`}>
              <div className={cn("h-[98px] overflow-hidden rounded-inner px-6 pt-2.5", tone.bg)}>
                <VehicleIllustration shape={shapeFor(c.name)} ink={tone.ink} dot={tone.dot} />
              </div>
            </Link>
            <div className="flex items-start justify-between gap-3 px-2 pt-3.5">
              <div className="min-w-0">
                <p className="flex items-center gap-1 truncate text-[15px] font-semibold text-ink">
                  {c.name}
                  <ArrowUpRight className="size-3.5 shrink-0 text-ink-subtle opacity-0 transition-opacity duration-150 group-hover/card:opacity-100" aria-hidden />
                </p>
                <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-ink-muted">
                  <Cpu className="size-3 shrink-0" aria-hidden /> {c.deviceCount} device{c.deviceCount === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-1.5 px-2 pt-3">
              {[
                ["Devices", String(c.deviceCount), undefined],
                ["Events", c.events === null ? "—" : String(c.events), c.events === null ? "Alarm data unavailable" : undefined],
                ["Distance", "—", "Per-vehicle distance is not provided by the API"],
              ].map(([label, value, note]) => (
                <div key={label} className="min-w-0 rounded-[10px] bg-surface-muted/80 px-2.5 py-2" title={note}>
                  <dt className="text-[10.5px] text-ink-muted">{label}</dt>
                  <dd className="truncate text-[13px] font-semibold tabular">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="pb-1.5" />
          </motion.li>
        );
      })}
    </ul>
  );
}
