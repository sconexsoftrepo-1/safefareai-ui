"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CloudOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bootstrapAuth, signOut, useAuth } from "@/features/drive-vision/store/auth-store";
import { BrandGlyph } from "../app-shell/sidebar";
import { Panel } from "../shared/panel";

/** Centered status card on the canvas — used while the session is checked and on boot errors. */
export function AuthScreenFrame({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-dvh place-items-center bg-canvas px-4 py-10">{children}</div>;
}

/**
 * Protects /drive-vision/*: validates the stored session with GET /me, then renders the
 * shell. Without a valid session it redirects to /login, preserving the current path.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const status = useAuth((s) => s.status);
  const endReason = useAuth((s) => s.endReason);
  const bootError = useAuth((s) => s.bootError);

  useEffect(() => {
    void bootstrapAuth();
  }, []);

  useEffect(() => {
    if (status !== "unauthenticated") return;
    const params = new URLSearchParams({ next: pathname });
    if (endReason === "expired") params.set("reason", "expired");
    router.replace(`/login?${params}`);
  }, [status, endReason, pathname, router]);

  if (status === "authenticated") return <>{children}</>;

  if (status === "error") {
    return (
      <AuthScreenFrame>
        <Panel className="w-full max-w-sm p-6 text-center">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-danger-soft text-danger">
            <CloudOff className="size-5" aria-hidden />
          </div>
          <p className="text-sm font-semibold text-ink">Couldn&apos;t load your session</p>
          <p className="mt-1 text-[13px] text-ink-muted" role="alert">
            {bootError}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void signOut()}>
              Sign out
            </Button>
            <Button size="sm" onClick={() => void bootstrapAuth()}>
              Try again
            </Button>
          </div>
        </Panel>
      </AuthScreenFrame>
    );
  }

  return (
    <AuthScreenFrame>
      <div className="flex flex-col items-center gap-3 text-ink-muted" aria-busy="true">
        <BrandGlyph />
        <span className="flex items-center gap-2 text-[13px]">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {status === "unauthenticated" ? "Redirecting to sign in…" : "Checking your session…"}
        </span>
      </div>
    </AuthScreenFrame>
  );
}
