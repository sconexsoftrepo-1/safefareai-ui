import type { Metadata } from "next";
import { NewVehicle } from "@/components/drive-vision/vehicles/new-vehicle";

export const metadata: Metadata = { title: "Add vehicle" };

export default function Page() {
  return <NewVehicle />;
}
