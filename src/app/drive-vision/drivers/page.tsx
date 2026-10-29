import type { Metadata } from "next";
import { Suspense } from "react";
import { DriversPage } from "@/components/drive-vision/drivers/drivers-page";
import { LoadingSkeleton } from "@/components/drive-vision/shared/feedback";

export const metadata: Metadata = { title: "Drivers" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingSkeleton variant="table" />}>
      <DriversPage />
    </Suspense>
  );
}
