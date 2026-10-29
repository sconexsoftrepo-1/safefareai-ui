import type { Metadata } from "next";
import { Suspense } from "react";
import { AlertsPage } from "@/components/drive-vision/alerts/alerts-page";
import { LoadingSkeleton } from "@/components/drive-vision/shared/feedback";

export const metadata: Metadata = { title: "Alerts & Events" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingSkeleton variant="table" />}>
      <AlertsPage />
    </Suspense>
  );
}
