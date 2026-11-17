import type { Metadata } from "next";
import { Suspense } from "react";
import { VehicleDetailRoute } from "@/components/drive-vision/vehicles/vehicle-detail-route";
import { LoadingSkeleton } from "@/components/drive-vision/shared/feedback";

export const metadata: Metadata = { title: "Vehicle details" };

/** /drive-vision/vehicles/detail/?vehicleId=469 — the id is read in the browser (useSearchParams needs this Suspense boundary). */
export default function Page() {
  return (
    <Suspense fallback={<LoadingSkeleton variant="card" className="mt-6" />}>
      <VehicleDetailRoute />
    </Suspense>
  );
}
