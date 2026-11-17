/**
 * The small part of the Google Maps JavaScript API that GeoMap uses, typed locally so the app needs no
 * extra type package. Shapes follow https://developers.google.com/maps/documentation/javascript/reference.
 */

export interface LatLngLiteral {
  lat: number;
  lng: number;
}

export interface MapsEventListener {
  remove(): void;
}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface LatLngBounds {
  extend(point: LatLngLiteral): LatLngBounds;
}

export interface Point {
  x: number;
  y: number;
}

export interface MapCanvasProjection {
  fromLatLngToDivPixel(latLng: LatLngLiteral): Point | null;
}

export interface MVCArray<T> {
  push(el: T): number;
  getArray(): T[];
  removeAt(i: number): T;
}

export interface GoogleMap {
  controls: MVCArray<HTMLElement>[];
  getDiv(): HTMLElement;
  getZoom(): number | undefined;
  setZoom(zoom: number): void;
  getHeading(): number | undefined;
  getMapTypeId(): string | undefined;
  setMapTypeId(id: string): void;
  panTo(latLng: LatLngLiteral): void;
  panBy(x: number, y: number): void;
  moveCamera(options: { center?: LatLngLiteral; zoom?: number }): void;
  fitBounds(bounds: LatLngBounds, padding?: number | Padding): void;
}

export interface MapOptions {
  center: LatLngLiteral;
  zoom: number;
  mapTypeId: string;
  maxZoom?: number;
  disableDefaultUI?: boolean;
  zoomControl?: boolean;
  zoomControlOptions?: { position: number };
  fullscreenControl?: boolean;
  fullscreenControlOptions?: { position: number };
  mapTypeControl?: boolean;
  streetViewControl?: boolean;
  rotateControl?: boolean;
  cameraControl?: boolean;
  scaleControl?: boolean;
  clickableIcons?: boolean;
  keyboardShortcuts?: boolean;
  gestureHandling?: string;
  tilt?: number;
  headingInteractionEnabled?: boolean;
  tiltInteractionEnabled?: boolean;
  backgroundColor?: string;
}

export interface PolylineOptions {
  path?: LatLngLiteral[];
  strokeColor?: string;
  strokeOpacity?: number;
  strokeWeight?: number;
  zIndex?: number;
  clickable?: boolean;
  map?: GoogleMap | null;
}

export interface Polyline {
  setOptions(options: PolylineOptions): void;
  setPath(path: LatLngLiteral[]): void;
  setMap(map: GoogleMap | null): void;
}

export interface MapPanes {
  overlayMouseTarget: HTMLElement;
}

/** Instance side of google.maps.OverlayView, which GeoMap subclasses for its HTML markers. */
export interface OverlayViewBase {
  setMap(map: GoogleMap | null): void;
  getPanes(): MapPanes | null;
  getProjection(): MapCanvasProjection | null;
  onAdd?(): void;
  draw?(): void;
  onRemove?(): void;
}

export type OverlayViewCtor = (abstract new () => OverlayViewBase) & { preventMapHitsAndGesturesFrom(el: Element): void };

export interface MapsLibrary {
  Map: new (el: HTMLElement, options: MapOptions) => GoogleMap;
  Polyline: new (options?: PolylineOptions) => Polyline;
  OverlayView: OverlayViewCtor;
}

export interface CoreLibrary {
  LatLngBounds: new () => LatLngBounds;
  ControlPosition: Record<"TOP_LEFT" | "TOP_RIGHT" | "LEFT_TOP" | "RIGHT_TOP" | "LEFT_BOTTOM" | "RIGHT_BOTTOM" | "BOTTOM_LEFT", number>;
  event: {
    addListener(instance: object, name: string, handler: (...args: unknown[]) => void): MapsEventListener;
    addListenerOnce(instance: object, name: string, handler: (...args: unknown[]) => void): MapsEventListener;
  };
}

export interface GoogleMapsRuntime {
  maps: MapsLibrary;
  core: CoreLibrary;
}
