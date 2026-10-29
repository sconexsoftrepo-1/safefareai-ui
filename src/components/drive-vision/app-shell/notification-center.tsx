"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UnavailableState } from "../shared/api-states";
import { HEADER_ICON } from "./header-styles";

/**
 * Header bell. The API has no notification feed, unread count or mark-read endpoint (alarm
 * popup settings in /me/preferences configure a client popup, not a feed), so the bell shows no
 * count and says so, rather than the sample notifications it used to show. Alarms are on the
 * Alerts page.
 */
export function NotificationCenter() {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={HEADER_ICON} aria-label="Notifications (not available yet)">
          <Bell className="size-[17px]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={14} className="w-[min(380px,calc(100vw-2rem))] p-0">
        <div className="border-b border-line px-4 py-3">
          <p className="text-sm font-semibold text-ink">Notifications</p>
        </div>
        <UnavailableState title="Notifications aren't available yet" reason="The SafeFare API doesn't provide a notification feed or unread count yet. Alarms and AI events are listed on the Alerts page." className="py-8" />
        <div className="border-t border-line p-1.5">
          <Link href="/drive-vision/alerts" onClick={() => setOpen(false)} className="flex items-center justify-between rounded-xl px-2.5 py-2 text-[13px] font-medium text-ink hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none">
            Open Alerts &amp; Events <ChevronRight className="size-4 text-ink-muted" aria-hidden />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
