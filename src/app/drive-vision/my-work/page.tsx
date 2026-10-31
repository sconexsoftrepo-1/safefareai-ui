import type { Metadata } from "next";
import { Suspense } from "react";
import { MyWorkPage } from "@/components/drive-vision/operations/my-work-page";
import { LoadingSkeleton } from "@/components/drive-vision/shared/feedback";

export const metadata: Metadata = { title: "My work" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingSkeleton variant="table" />}>
      <MyWorkPage />
    </Suspense>
  );
}
