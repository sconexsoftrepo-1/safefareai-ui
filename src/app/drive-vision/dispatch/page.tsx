import type { Metadata } from "next";
import { Suspense } from "react";
import { DispatchPage } from "@/components/drive-vision/operations/dispatch-page";
import { LoadingSkeleton } from "@/components/drive-vision/shared/feedback";

export const metadata: Metadata = { title: "Dispatch" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingSkeleton variant="table" />}>
      <DispatchPage />
    </Suspense>
  );
}
