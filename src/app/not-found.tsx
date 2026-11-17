import type { Metadata } from "next";
import { DriveVisionAppShell } from "@/components/drive-vision/app-shell/app-shell";
import { AuthGate } from "@/components/drive-vision/auth/auth-gate";
import { AccessStatePanel } from "@/components/drive-vision/auth/route-guard";

export const metadata: Metadata = { title: "Page not found" };

/**
 * Every URL that matches no page. The root not-found is the only one Next renders for unmatched
 * paths, and the one a static export writes to 404.html, so it wraps the same AuthGate + shell as
 * app/drive-vision/layout.tsx (it renders outside that layout). Signed-out visitors go to /login;
 * signed in, RouteGuard shows "Page not found" for paths outside any screen, the access-denied panel
 * for screens the user can't open, and otherwise this panel. No catch-all route is needed.
 */
export default function NotFound() {
  return (
    <AuthGate>
      <DriveVisionAppShell>
        <AccessStatePanel reason="unknown-route" />
      </DriveVisionAppShell>
    </AuthGate>
  );
}
