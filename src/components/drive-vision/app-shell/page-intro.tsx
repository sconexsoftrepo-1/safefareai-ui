"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/features/drive-vision/hooks/use-preferences";
import { useAuth } from "@/features/drive-vision/store/auth-store";
import { getPageMeta, isWorkspaceRoute } from "../navigation/nav-config";
import { Breadcrumbs } from "./breadcrumbs";
import { EASE_OUT } from "../shared/motion";

/**
 * Page title block above the content (reference: large "Good morning…" heading with a
 * muted one-line description). Map/video workspaces get a compact single-row variant so
 * the operational surface keeps its height.
 */
export function PageIntro() {
  const pathname = usePathname();
  const prefs = usePreferences();
  // Signed-in user from GET /me; the stored preference name is only a fallback.
  const displayName = useAuth((s) => s.user?.displayName) || prefs.displayName;
  const [now] = useState(() => new Date());
  const meta = getPageMeta(pathname, displayName, now);
  const compact = isWorkspaceRoute(pathname);

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE_OUT }}
      className={cn("min-w-0", compact ? "mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 pt-1" : "mb-4 pt-2")}
    >
      <h1 className={cn("font-semibold tracking-[-0.025em] text-ink", compact ? "text-[22px] leading-8" : "text-[26px] leading-tight sm:text-[30px]")}>{meta.title}</h1>
      <div className={cn("min-w-0 text-[13.5px] text-ink-muted", compact ? "truncate" : "mt-1")}>{meta.nested ? <Breadcrumbs /> : meta.subtitle}</div>
    </motion.div>
  );
}
