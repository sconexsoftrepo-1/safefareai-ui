import type { Metadata } from "next";
import { Suspense } from "react";
import { SensorsPage } from "@/components/drive-vision/sensors/sensors-page";
import { LoadingSkeleton } from "@/components/drive-vision/shared/feedback";

export const metadata: Metadata = { title: "Sensors" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingSkeleton variant="table" />}>
      <SensorsPage />
    </Suspense>
  );
}
