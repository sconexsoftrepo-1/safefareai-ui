import type { LatLon, VehicleState } from "@/features/drive-vision/types";

/** A vehicle (or playback cursor) drawn on the map at its reported coordinate. */
export interface MapMarker extends LatLon {
  id: string;
  /** Sample-data state; kept for callers that still pass it. */
  state?: VehicleState;
  /** Marker colour (live data colours by report age). */
  color?: string;
  /** Spoken status for the marker's accessible name. */
  statusLabel?: string;
  /** Draw the heading arrow without a "moving" state. */
  showHeading?: boolean;
  heading?: number;
  label: string;
  alarm?: boolean;
}

/** A polyline drawn from real route points. */
export interface MapRoute {
  id: string;
  points: LatLon[];
  color?: string;
  /** 0–1: portion already played; drawn darker. */
  progress?: number;
  dim?: boolean;
}

/** A point marker: trip start/end, stop, or alarm location. */
export interface MapPin extends LatLon {
  id: string;
  kind: "start" | "end" | "stop" | "alarm";
  title: string;
  glyph?: string;
}
