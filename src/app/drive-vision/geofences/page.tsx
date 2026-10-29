import type { Metadata } from "next";
import { GeofencesPage } from "@/components/drive-vision/geofences/geofences-page";

export const metadata: Metadata = { title: "Geofences" };

export default function Page() {
  return <GeofencesPage />;
}
