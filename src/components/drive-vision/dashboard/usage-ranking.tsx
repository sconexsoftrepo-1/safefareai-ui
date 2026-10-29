"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "motion/react";
import type { Vehicle } from "@/features/drive-vision/types";
import type { VehicleUsage } from "@/features/drive-vision/selectors";
import { formatDuration, formatKm } from "@/features/drive-vision/utils/format";
import { SegmentedControl } from "../shared/filter-bar";
import { EmptyState } from "../shared/feedback";
import { EASE_OUT } from "../shared/motion";

/** Top vehicles by mileage (vendor 5.6) or driving time (vendor 5.5) in the selected range. */
export function UsageRanking({ usage, vehicles }: { usage: Map<string, VehicleUsage>; vehicles: Vehicle[] }) {
  const [metric, setMetric] = useState<"distanceKm" | "drivingMin">("distanceKm");
  const byId = new Map(vehicles.map((v) => [v.vehicleId, v]));
  const rows = [...usage.values()].sort((a, b) => b[metric] - a[metric]).slice(0, 6);
  const max = rows[0]?.[metric] ?? 1;

  return (
    <div className="px-5 pt-3 pb-5">
      <SegmentedControl
        size="sm"
        label="Ranking metric"
        value={metric}
        onChange={setMetric}
        options={[
          { value: "distanceKm", label: "Mileage" },
          { value: "drivingMin", label: "Driving time" },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState title="No trips in this period" description="Try a longer date range." className="py-8" />
      ) : (
        <ol className="mt-3 space-y-2.5">
          {rows.map((r, i) => {
            const v = byId.get(r.vehicleId);
            const value = r[metric];
            return (
              <li key={r.vehicleId}>
                <Link href={`/drive-vision/vehicles/${r.vehicleId}`} className="group block rounded-lg focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none">
                  <div className="flex items-center gap-2 text-[13px]">
                    <span className="w-4 text-xs text-ink-subtle tabular">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-medium group-hover:underline">{v ? `${v.vehicleName} · ${v.plate}` : "Removed vehicle"}</span>
                    <span className="font-semibold tabular">{metric === "distanceKm" ? formatKm(value) : formatDuration(value)}</span>
                  </div>
                  <div className="mt-1 ml-6 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                    <motion.div
                      className="h-full rounded-full bg-brand"
                      initial={{ width: 0 }}
                      animate={{ width: `${(value / max) * 100}%` }}
                      transition={{ duration: 0.4, ease: EASE_OUT, delay: i * 0.03 }}
                    />
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
