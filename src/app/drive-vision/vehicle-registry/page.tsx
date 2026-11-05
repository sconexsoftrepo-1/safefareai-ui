import type { Metadata } from "next";
import { Suspense } from "react";
import { VehicleRegistryPage } from "@/components/drive-vision/vehicle-registry/vehicle-registry-page";
import { LoadingSkeleton } from "@/components/drive-vision/shared/feedback";

export const metadata: Metadata = { title: "Vehicles" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingSkeleton variant="table" />}>
      <VehicleRegistryPage />
    </Suspense>
  );
}
