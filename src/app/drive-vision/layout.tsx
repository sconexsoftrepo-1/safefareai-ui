import type { Metadata } from "next";
import { DriveVisionAppShell } from "@/components/drive-vision/app-shell/app-shell";
import { AuthGate } from "@/components/drive-vision/auth/auth-gate";

export const metadata: Metadata = {
  title: {
    default: "SafeFare AI",
    template: "%s · SafeFare AI",
  },
};

export default function DriveVisionLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthGate>
      <DriveVisionAppShell>{children}</DriveVisionAppShell>
    </AuthGate>
  );
}
