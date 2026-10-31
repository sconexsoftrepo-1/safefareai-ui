"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CircleSlash, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { decideRoute, homeScreen, landingRedirect } from "@/features/drive-vision/access/access-policy";
import { useAccess } from "@/features/drive-vision/access/use-access";
import { signOut, useAuth } from "@/features/drive-vision/store/auth-store";
import { ALL_NAV_ITEMS } from "../navigation/nav-config";
import { Panel } from "../shared/panel";

/**
 * Renders the page only when the signed-in user's access policy grants its screen (see
 * features/drive-vision/access). Denied pages never mount, so they send no API requests.
 * This is a UI guard only — the BFF must authorise every request on its own.
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const status = useAuth((s) => s.status);
  const access = useAccess();
  const decision = decideRoute(status, access, pathname);
  // The default landing (Overview) is fleet-only; send e.g. a driver to their own home screen instead.
  const landing = decision.kind === "forbidden" ? landingRedirect(access, pathname) : null;
  useEffect(() => {
    if (landing) router.replace(landing);
  }, [landing, router]);
  if (landing) return null;

  // AuthGate owns the unauthenticated / checking / session-error states and never renders the shell for them.
  if (decision.kind !== "forbidden") return decision.kind === "allow" ? <>{children}</> : null;
  return <AccessStatePanel reason={decision.reason} />;
}

/**
 * The branded "not found" / "no access" panel. Also rendered by app/drive-vision/not-found.tsx for
 * paths under an allowed screen that match no page (e.g. /drive-vision/vehicles/1/x).
 */
export function AccessStatePanel({ reason }: { reason: "unknown-route" | "no-role" | "no-access" }) {
  const access = useAccess();
  const home = homeScreen(access);
  const homeItem = home ? ALL_NAV_ITEMS.find((i) => i.screen === home) : undefined;
  const unknownRoute = reason === "unknown-route";
  const noRole = reason === "no-role";

  return (
    <Panel className="mx-auto mt-6 w-full max-w-md p-6 text-center" role="alert">
      <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-surface-muted text-ink-muted">
        {unknownRoute ? <CircleSlash className="size-5" aria-hidden /> : <Lock className="size-5" aria-hidden />}
      </div>
      <h1 className="text-base font-semibold text-ink">{unknownRoute ? "Page not found" : noRole ? "No access for this account yet" : "You don't have access to this page"}</h1>
      <p className="mt-1.5 text-[13px] text-ink-muted">
        {unknownRoute
          ? "This address doesn't match a SafeFare AI page you can open."
          : noRole
            ? "Your account signed in, but its role isn't enabled in SafeFare AI yet. Ask an administrator to confirm your access."
            : "Your account's permissions don't include this page."}
      </p>
      {!unknownRoute ? (
        <p className="mt-2 font-mono text-[11px] break-all text-ink-subtle">Role: {access.roleCode ?? "none returned by the server"}</p>
      ) : null}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {homeItem ? (
          <Button asChild size="sm">
            <Link href={homeItem.href}>Go to {homeItem.label}</Link>
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </Panel>
  );
}
