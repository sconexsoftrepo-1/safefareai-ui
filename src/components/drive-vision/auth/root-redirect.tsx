"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AuthScreenFrame } from "./auth-gate";
import { BrandGlyph } from "../app-shell/sidebar";

/**
 * `/` → `/drive-vision`, on the client so the root can be a static file. The destination is the same for
 * everyone: /drive-vision's AuthGate checks the session and RouteGuard picks the user's own landing page
 * (landingRedirect) once permissions have loaded, so nothing about the user is decided here.
 */
export function RootRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/drive-vision");
  }, [router]);

  return (
    <AuthScreenFrame>
      <div className="flex flex-col items-center gap-3 text-ink-muted" aria-busy="true">
        <BrandGlyph />
        <span className="flex items-center gap-2 text-[13px]">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Opening SafeFare AI…
        </span>
      </div>
    </AuthScreenFrame>
  );
}
