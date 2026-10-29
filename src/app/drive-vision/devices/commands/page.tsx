import type { Metadata } from "next";
import { DeviceCommands } from "@/components/drive-vision/devices/device-commands";

export const metadata: Metadata = { title: "Device Commands" };

export default function Page() {
  return <DeviceCommands />;
}
