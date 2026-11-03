"use client";

import { useState } from "react";
import { VideoOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { DeviceStateDto } from "@/features/drive-vision/api/types";
import { EmptyState } from "../shared/feedback";
import { GPS_VIDEO_API_TOKEN, gpsVideoUrl, videoChannels } from "./gps-video";

/**
 * Popup with the GPS vendor's live camera player for one device (GPSTrackTech, embedded in an iframe).
 * The player URL is built when the popup opens, so each open starts a fresh stream.
 */
export function LiveVideoDialog({ state, cameraCount, onClose }: { state: DeviceStateDto | null; cameraCount?: number | null; onClose: () => void }) {
  return (
    <Dialog open={state !== null} onOpenChange={(o) => !o && onClose()}>
      {/* Always fits the window: the 16:9 player is as wide as the viewport height allows (header ≈ 72px),
          so the header and its close button never end up off-screen. */}
      <DialogContent showCloseButton={false} className="max-h-[94dvh] w-[min(96vw,1180px,calc((94dvh-88px)*16/9))] gap-3 overflow-hidden p-3 sm:max-w-none sm:p-4">
        {state ? <Player key={state.deviceId} state={state} cameraCount={cameraCount} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Player({ state, cameraCount, onClose }: { state: DeviceStateDto; cameraCount?: number | null; onClose: () => void }) {
  // Fixed per open (the vendor URL carries a timestamp); a new device or a reopen remounts this.
  const [openedAt] = useState(() => Date.now());
  const terminalNo = state.terminalNo?.trim() ?? "";
  const name = state.name ?? `Device ${state.deviceId}`;
  const problem = !terminalNo ? "This device has no terminal number, so its cameras can't be opened." : !GPS_VIDEO_API_TOKEN ? "Live video isn't configured: set NEXT_PUBLIC_GPS_VIDEO_API_TOKEN and restart the app." : null;

  return (
    <>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <DialogTitle className="truncate text-[17px] font-semibold text-ink">Live video · {name}</DialogTitle>
          <DialogDescription className="font-mono text-xs text-ink-muted">{terminalNo || "no terminal number"}</DialogDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onClose} aria-label="Close live video">
          <X /> Close
        </Button>
      </div>
      {problem ? (
        <EmptyState icon={VideoOff} title="Live video unavailable" description={problem} className="py-12" />
      ) : (
        <div className="aspect-video w-full overflow-hidden rounded-xl bg-ink">
          <iframe
            title={`Live video for ${name}`}
            src={gpsVideoUrl({ terminalNo, channels: videoChannels(cameraCount), token: GPS_VIDEO_API_TOKEN, now: openedAt })}
            className="size-full border-0"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            referrerPolicy="no-referrer"
          />
        </div>
      )}
    </>
  );
}
