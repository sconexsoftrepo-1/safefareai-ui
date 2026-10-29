import type { Metadata } from "next";
import { FleetOverview } from "@/components/drive-vision/dashboard/fleet-overview";

export const metadata: Metadata = { title: "Fleet Overview" };

export default function OverviewPage() {
  return <FleetOverview />;
}
