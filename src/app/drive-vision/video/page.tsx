import type { Metadata } from "next";
import { Suspense } from "react";
import { VideoWorkspace } from "@/components/drive-vision/video/video-workspace";
import { LoadingSkeleton } from "@/components/drive-vision/shared/feedback";

export const metadata: Metadata = { title: "Historical Video" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingSkeleton variant="chart" />}>
      <VideoWorkspace />
    </Suspense>
  );
}
