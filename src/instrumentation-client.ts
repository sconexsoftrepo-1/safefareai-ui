import { installHistoryGate } from "@/components/drive-vision/shared/history-guard";

// Runs before hydration, so this popstate listener sits ahead of the App Router's. Stays synchronous and static:
// Next.js only guarantees top-level synchronous code here finishes first.
installHistoryGate(window);
