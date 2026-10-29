import { AccessStatePanel } from "@/components/drive-vision/auth/route-guard";

// Rendered inside the drive-vision layout (AuthGate + shell), so it shows only after sign-in and
// only where RouteGuard allows the path; unknown top-level paths get the same panel from RouteGuard.
export default function DriveVisionNotFound() {
  return <AccessStatePanel reason="unknown-route" />;
}
