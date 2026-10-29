import type { Metadata } from "next";
import { SafetyAnalytics } from "@/components/drive-vision/safety/safety-analytics";

export const metadata: Metadata = { title: "Safety Analytics" };

export default function Page() {
  return <SafetyAnalytics />;
}
