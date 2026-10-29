import type { Metadata } from "next";
import { Suspense } from "react";
import { TripsPage } from "@/components/drive-vision/trips/trips-page";
import { LoadingSkeleton } from "@/components/drive-vision/shared/feedback";

export const metadata: Metadata = { title: "Trips & Tracking" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingSkeleton variant="table" />}>
      <TripsPage />
    </Suspense>
  );
}
