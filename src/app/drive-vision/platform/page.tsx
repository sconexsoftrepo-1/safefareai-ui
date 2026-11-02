import type { Metadata } from "next";
import { PlatformDashboard } from "@/components/drive-vision/dashboard/platform-dashboard";

export const metadata: Metadata = { title: "Platform Overview" };

export default function PlatformPage() {
  return <PlatformDashboard />;
}
