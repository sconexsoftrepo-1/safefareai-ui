import type { Metadata } from "next";
import { Suspense } from "react";
import { WorkforcePage } from "@/components/drive-vision/operations/workforce-page";
import { LoadingSkeleton } from "@/components/drive-vision/shared/feedback";

export const metadata: Metadata = { title: "Workforce" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingSkeleton variant="table" />}>
      <WorkforcePage />
    </Suspense>
  );
}
