import { AccessStatePanel } from "@/components/drive-vision/auth/route-guard";

// Rendered inside the drive-vision layout (AuthGate + shell) when a page under /drive-vision calls
// notFound(). Unmatched URLs never reach this file: they render app/not-found.tsx (404.html in a
// static export), which wraps the same shell around the same panel.
export default function DriveVisionNotFound() {
  return <AccessStatePanel reason="unknown-route" />;
}
