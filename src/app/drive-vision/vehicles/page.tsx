import type { Metadata } from "next";
import { Suspense } from "react";
import { VehiclesPage } from "@/components/drive-vision/vehicles/vehicles-page";
import { LoadingSkeleton } from "@/components/drive-vision/shared/feedback";

export const metadata: Metadata = { title: "Vehicles & Assets" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingSkeleton variant="table" />}>
      <VehiclesPage />
    </Suspense>
  );
}
