"use client";

import { useSearchParams } from "next/navigation";
import { VehicleDetail } from "./vehicle-detail";

/**
 * Reads `?vehicleId=` on the client for app/drive-vision/vehicles/detail (a static route, so the
 * app can be exported without one page per device). Nothing is fetched at build time: VehicleDetail
 * loads the device in the browser, and a missing or non-numeric id shows its "Vehicle not found" panel.
 * Keyed by id so switching vehicles remounts the detail, as the old /vehicles/[vehicleId] segment did.
 */
export function VehicleDetailRoute() {
  const vehicleId = useSearchParams().get("vehicleId") ?? "";
  return <VehicleDetail key={vehicleId} vehicleId={vehicleId} />;
}
