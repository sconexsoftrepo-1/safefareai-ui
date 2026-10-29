import type { Metadata } from "next";
import { Suspense } from "react";
import { LiveMonitoring } from "@/components/drive-vision/monitoring/live-monitoring";
import { LoadingSkeleton } from "@/components/drive-vision/shared/feedback";

export const metadata: Metadata = { title: "Live Monitoring" };

export default function MonitoringPage() {
  return (
    <Suspense fallback={<LoadingSkeleton variant="table" />}>
      <LiveMonitoring />
    </Suspense>
  );
}
