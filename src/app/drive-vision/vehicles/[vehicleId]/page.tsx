import type { Metadata } from "next";
import { VehicleDetail } from "@/components/drive-vision/vehicles/vehicle-detail";

export const metadata: Metadata = { title: "Vehicle details" };

export default async function Page({ params }: { params: Promise<{ vehicleId: string }> }) {
  const { vehicleId } = await params;
  return <VehicleDetail vehicleId={decodeURIComponent(vehicleId)} />;
}
