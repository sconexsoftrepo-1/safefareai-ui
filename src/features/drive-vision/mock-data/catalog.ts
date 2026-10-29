import type {
  AlarmCategory,
  AlarmTypeCode,
  CommandRisk,
  DeviceProtocol,
  LatLon,
  Severity,
  TerminalModel,
} from "../types";

/**
 * Demo snapshot time. All mock data is generated relative to this instant so the
 * UI is deterministic (no Date.now() during render → no hydration drift).
 * 23 Oct 2026, 15:30 IST.
 */
export const DEMO_NOW = new Date("2026-10-23T10:00:00.000Z");

/** Demo operating region — Hyderabad, India. Used by the mock map projection. */
export const MAP_BOUNDS = { minLat: 17.3, maxLat: 17.52, minLon: 78.3, maxLon: 78.6 } as const;

export interface CityArea extends LatLon {
  name: string;
  /** Short street-style address used for mock reverse-geocoding. */
  street: string;
}

export const CITY_AREAS: readonly CityArea[] = [
  { name: "HITEC City", lat: 17.4474, lon: 78.3762, street: "Cyber Towers Rd" },
  { name: "Gachibowli", lat: 17.4401, lon: 78.3489, street: "ORR Service Rd" },
  { name: "Kondapur", lat: 17.4632, lon: 78.3638, street: "Botanical Garden Rd" },
  { name: "Kukatpally", lat: 17.4849, lon: 78.4138, street: "KPHB Main Rd" },
  { name: "Ameerpet", lat: 17.4375, lon: 78.4482, street: "SR Nagar X Rd" },
  { name: "Begumpet", lat: 17.4447, lon: 78.4664, street: "Prakash Nagar Rd" },
  { name: "Secunderabad", lat: 17.4399, lon: 78.4983, street: "SD Road" },
  { name: "Banjara Hills", lat: 17.4156, lon: 78.4347, street: "Road No. 12" },
  { name: "Mehdipatnam", lat: 17.395, lon: 78.44, street: "Rethibowli Junction" },
  { name: "Charminar", lat: 17.3616, lon: 78.4747, street: "Pathergatti Rd" },
  { name: "Malakpet", lat: 17.3722, lon: 78.5016, street: "Old Malakpet Rd" },
  { name: "Uppal", lat: 17.4058, lon: 78.5591, street: "Uppal Ring Rd" },
  { name: "LB Nagar", lat: 17.3457, lon: 78.5522, street: "Sagar Ring Rd" },
  { name: "Tarnaka", lat: 17.4281, lon: 78.5389, street: "Osmania Univ Rd" },
  { name: "Miyapur", lat: 17.4968, lon: 78.3614, street: "Miyapur X Rd" },
  { name: "Attapur", lat: 17.3713, lon: 78.4312, street: "PVNR Expressway" },
] as const;

/** Simplified road network between area indices (used by the mock map and route generator). */
export const ROAD_LINKS: readonly [number, number][] = [
  [0, 1], [0, 2], [2, 14], [14, 3], [3, 4], [2, 3], [0, 7], [4, 5], [5, 6], [4, 7],
  [7, 8], [8, 15], [15, 9], [9, 10], [10, 12], [12, 11], [11, 13], [13, 6], [6, 10],
  [1, 8], [5, 13], [8, 9],
];


/* ───────────── Alarm dictionary (vendor 5.7 + BFF severity) ───────────── */

export interface AlarmTypeMeta {
  code: AlarmTypeCode;
  label: string;
  category: AlarmCategory;
  baseSeverity: Severity;
  /** Relative frequency in the seed generator. */
  weight: number;
  aiEvent: boolean;
}

export const ALARM_TYPES: Record<AlarmTypeCode, AlarmTypeMeta> = {
  fatigue: { code: "fatigue", label: "Drowsiness / fatigue", category: "DSM", baseSeverity: "critical", weight: 7, aiEvent: true },
  phone: { code: "phone", label: "Mobile phone use", category: "DSM", baseSeverity: "high", weight: 10, aiEvent: true },
  smoking: { code: "smoking", label: "Smoking", category: "DSM", baseSeverity: "low", weight: 4, aiEvent: true },
  distraction: { code: "distraction", label: "Distracted driving", category: "DSM", baseSeverity: "medium", weight: 9, aiEvent: true },
  seatbelt: { code: "seatbelt", label: "Seatbelt not fastened", category: "DSM", baseSeverity: "medium", weight: 7, aiEvent: true },
  driver_absent: { code: "driver_absent", label: "Driver absent", category: "DSM", baseSeverity: "medium", weight: 2, aiEvent: true },
  forward_collision: { code: "forward_collision", label: "Forward collision warning", category: "ADAS", baseSeverity: "critical", weight: 5, aiEvent: true },
  lane_departure: { code: "lane_departure", label: "Lane departure", category: "ADAS", baseSeverity: "medium", weight: 11, aiEvent: true },
  pedestrian: { code: "pedestrian", label: "Pedestrian collision warning", category: "ADAS", baseSeverity: "high", weight: 3, aiEvent: true },
  headway: { code: "headway", label: "Headway too close", category: "ADAS", baseSeverity: "medium", weight: 8, aiEvent: true },
  blind_spot: { code: "blind_spot", label: "Blind-spot approach", category: "BSD", baseSeverity: "medium", weight: 5, aiEvent: true },
  overspeed: { code: "overspeed", label: "Overspeeding", category: "General", baseSeverity: "high", weight: 12, aiEvent: false },
  geofence: { code: "geofence", label: "Geofence breach", category: "General", baseSeverity: "medium", weight: 4, aiEvent: false },
  device_offline: { code: "device_offline", label: "Device offline", category: "General", baseSeverity: "low", weight: 3, aiEvent: false },
  sos: { code: "sos", label: "SOS / panic button", category: "General", baseSeverity: "critical", weight: 1, aiEvent: false },
};

export const ALARM_CATEGORIES: { value: AlarmCategory; label: string; vendorTypeId: number }[] = [
  { value: "ADAS", label: "ADAS", vendorTypeId: 2 },
  { value: "DSM", label: "DSM (driver)", vendorTypeId: 4 },
  { value: "BSD", label: "Blind spot", vendorTypeId: 5 },
  { value: "General", label: "General", vendorTypeId: 3 },
];

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

/* ───────────── Device models (vendor 1.6 shape) ───────────── */

export const TERMINAL_MODELS: TerminalModel[] = [
  { name: "JC450 AI Dashcam", protocols: [1], maxCameras: 2 },
  { name: "AD-Plus 2.0 MDVR", protocols: [1], maxCameras: 4 },
  { name: "X3 4G Edge MDVR", protocols: [1, 3], maxCameras: 8 },
  { name: "GT06N Tracker", protocols: [2], maxCameras: 0 },
  { name: "VL502 Telematics", protocols: [2, 3], maxCameras: 0 },
];

export const PROTOCOL_LABELS: Record<DeviceProtocol, string> = {
  1: "JT/T 808",
  2: "GT06",
  3: "V3",
};

export const VEHICLE_TYPES = [
  "Light truck",
  "Heavy truck",
  "Delivery van",
  "City bus",
  "Staff shuttle",
  "Sedan",
  "Pickup",
  "Refrigerated truck",
] as const;

/* ───────────── Device command catalog (vendor 8.x — simulated only) ───────────── */

export type CommandFieldType = "text" | "number" | "select" | "textarea";

export interface CommandField {
  name: string;
  label: string;
  type: CommandFieldType;
  placeholder?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  required?: boolean;
  defaultValue?: string;
  hint?: string;
}

export interface CommandDefinition {
  key: string;
  label: string;
  description: string;
  category: CommandCategoryKey;
  /** Vendor endpoint this will map to after BFF integration — documentation only, never called. */
  vendorRef: string;
  risk: CommandRisk;
  /** Calibration commands are the only ones the vendor accepts while offline (Notes and Risks). */
  acceptsOffline?: boolean;
  requiresCamera?: boolean;
  fields: CommandField[];
}

export type CommandCategoryKey = "query" | "messaging" | "camera" | "reporting" | "safety" | "control" | "sensors";

export const COMMAND_CATEGORIES: { key: CommandCategoryKey; label: string; description: string }[] = [
  { key: "query", label: "Query & wake", description: "Read device properties or wake a sleeping unit" },
  { key: "messaging", label: "Messaging", description: "Text and voice to the driver terminal" },
  { key: "camera", label: "Camera", description: "On-demand and timed photos" },
  { key: "reporting", label: "Reporting", description: "Intervals, time zone and work mode" },
  { key: "safety", label: "Safety thresholds", description: "Overspeed, ADAS, DMS and blind-spot settings" },
  { key: "control", label: "Vehicle control", description: "High-risk outputs, odometer and resets" },
  { key: "sensors", label: "Sensor calibration", description: "Fuel and temperature probes" },
];

const channelOptions = Array.from({ length: 4 }, (_, i) => ({ value: String(i + 1), label: `Channel ${i + 1}` }));

export const COMMAND_DEFINITIONS: CommandDefinition[] = [
  {
    key: "properties",
    label: "Query device properties",
    description: "Ask the terminal for model, ICCID, GNSS module and firmware versions.",
    category: "query",
    vendorRef: "8.1 GET /command/propertiesQuery → 8.2 getResult",
    risk: "standard",
    fields: [],
  },
  {
    key: "wake",
    label: "Wake device",
    description: "Wake a sleeping device (required before live video when ACC is off).",
    category: "query",
    vendorRef: "8.3 GET /command/wakenDevice",
    risk: "standard",
    fields: [],
  },
  {
    key: "text",
    label: "Send text to device",
    description: "Display a text message on the in-cab terminal.",
    category: "messaging",
    vendorRef: "8.5 GET /command/textDownload",
    risk: "standard",
    fields: [{ name: "text", label: "Message", type: "textarea", placeholder: "Please call dispatch at the next stop", required: true, hint: "Max 120 characters" }],
  },
  {
    key: "photo",
    label: "Take photo now",
    description: "Capture an immediate photo on a channel and resolution.",
    category: "camera",
    vendorRef: "8.12 GET /command/instantShot",
    risk: "standard",
    requiresCamera: true,
    fields: [
      { name: "channel", label: "Channel", type: "select", options: channelOptions, defaultValue: "1", required: true },
      {
        name: "resolution",
        label: "Resolution",
        type: "select",
        options: [
          { value: "1", label: "320×240" },
          { value: "4", label: "1280×720" },
          { value: "8", label: "1920×1080" },
        ],
        defaultValue: "4",
        required: true,
      },
    ],
  },
  {
    key: "timed-photo",
    label: "Timed photo",
    description: "Take photos at a regular interval on selected channels.",
    category: "camera",
    vendorRef: "8.13 POST /command/timingPhotoSet",
    risk: "standard",
    requiresCamera: true,
    fields: [
      { name: "channel", label: "Channel", type: "select", options: channelOptions, defaultValue: "1", required: true },
      { name: "interval", label: "Interval (seconds)", type: "number", min: 10, max: 3600, defaultValue: "60", required: true },
    ],
  },
  {
    key: "report-interval",
    label: "Report interval (ACC on/off)",
    description: "How often the device reports position with ignition on and off.",
    category: "reporting",
    vendorRef: "8.11 GET /command/backParamSet",
    risk: "standard",
    fields: [
      { name: "accOn", label: "ACC-on interval (s)", type: "number", min: 5, max: 600, defaultValue: "10", required: true },
      { name: "accOff", label: "ACC-off interval (s)", type: "number", min: 60, max: 86400, defaultValue: "300", required: true },
    ],
  },
  {
    key: "timezone",
    label: "Time zone",
    description: "Set the device time zone offset.",
    category: "reporting",
    vendorRef: "8.16 GET /command/timezoneSet",
    risk: "standard",
    fields: [
      {
        name: "offset",
        label: "UTC offset",
        type: "select",
        options: ["5:30", "4:00", "0:00", "-5:00", "8:00"].map((v) => ({ value: v, label: `UTC${v.startsWith("-") ? "" : "+"}${v}` })),
        defaultValue: "5:30",
        required: true,
      },
    ],
  },
  {
    key: "overspeed",
    label: "Overspeed setting",
    description: "Speed limit and how long it must be exceeded before an alarm.",
    category: "safety",
    vendorRef: "8.10 GET /command/travelParamSet",
    risk: "elevated",
    fields: [
      { name: "speed", label: "Speed limit (km/h)", type: "number", min: 20, max: 160, defaultValue: "80", required: true },
      { name: "duration", label: "Duration (s)", type: "number", min: 1, max: 60, defaultValue: "10", required: true },
    ],
  },
  {
    key: "dms",
    label: "DMS thresholds",
    description: "Fatigue, phone, smoking and distraction alarm speed thresholds.",
    category: "safety",
    vendorRef: "8.7 POST /command/dmsParamSet",
    risk: "elevated",
    requiresCamera: true,
    fields: [
      { name: "fatigueSpeed", label: "Fatigue alarm above (km/h)", type: "number", min: 0, max: 60, defaultValue: "30", required: true },
      { name: "phoneSpeed", label: "Phone alarm above (km/h)", type: "number", min: 0, max: 60, defaultValue: "20", required: true },
      { name: "volume", label: "Alert volume (0–8)", type: "number", min: 0, max: 8, defaultValue: "6", required: true },
    ],
  },
  {
    key: "adas",
    label: "ADAS thresholds",
    description: "Forward collision, lane departure and headway sensitivity.",
    category: "safety",
    vendorRef: "8.6 POST /command/adasParamSet",
    risk: "elevated",
    requiresCamera: true,
    fields: [
      { name: "fcwSpeed", label: "FCW active above (km/h)", type: "number", min: 0, max: 80, defaultValue: "30", required: true },
      { name: "ldwSpeed", label: "Lane departure above (km/h)", type: "number", min: 30, max: 100, defaultValue: "60", required: true },
      { name: "headway", label: "Headway alarm (s)", type: "number", min: 1, max: 5, defaultValue: "2", required: true },
    ],
  },
  {
    key: "bsd",
    label: "Blind-spot thresholds",
    description: "Rear and side-rear time thresholds (1–10 s).",
    category: "safety",
    vendorRef: "8.15 GET /command/bsdParamSet",
    risk: "elevated",
    requiresCamera: true,
    fields: [
      { name: "rear", label: "Rear threshold (s)", type: "number", min: 1, max: 10, defaultValue: "3", required: true },
      { name: "sideRear", label: "Side-rear threshold (s)", type: "number", min: 1, max: 10, defaultValue: "2", required: true },
    ],
  },
  {
    key: "odometer",
    label: "Mileage reset",
    description: "Set the odometer value on the device. Audited.",
    category: "control",
    vendorRef: "8.8 GET /command/vehicleOdometerReadSet",
    risk: "high",
    fields: [{ name: "km", label: "Odometer (km)", type: "number", min: 0, max: 2000000, required: true }],
  },
  {
    key: "oil-electric",
    label: "Cut / restore oil & power",
    description: "Immobilise or restore the vehicle, or reset the terminal. High risk.",
    category: "control",
    vendorRef: "8.9 GET /command/oilElectricSet",
    risk: "high",
    fields: [
      {
        name: "oilSetType",
        label: "Action",
        type: "select",
        options: [
          { value: "1", label: "Disconnect oil & electricity" },
          { value: "2", label: "Restore oil & electricity" },
          { value: "3", label: "Terminal reset" },
        ],
        required: true,
      },
    ],
  },
  {
    key: "fuel",
    label: "Fuel sensor calibration",
    description: "Upload a fuel tank calibration scale. Accepted while offline.",
    category: "sensors",
    vendorRef: "8.20 POST /command/fuelSet",
    risk: "standard",
    acceptsOffline: true,
    fields: [
      { name: "tank", label: "Tank capacity (L)", type: "number", min: 10, max: 1000, defaultValue: "200", required: true },
      { name: "scale", label: "Scale points", type: "number", min: 2, max: 50, defaultValue: "10", required: true },
    ],
  },
  {
    key: "temperature",
    label: "Temperature alarm range",
    description: "High / low limits for a cold-chain probe. Accepted while offline.",
    category: "sensors",
    vendorRef: "8.21 POST /command/temperatureSet",
    risk: "standard",
    acceptsOffline: true,
    fields: [
      { name: "low", label: "Low limit (°C)", type: "number", min: -40, max: 20, defaultValue: "2", required: true },
      { name: "high", label: "High limit (°C)", type: "number", min: -20, max: 60, defaultValue: "8", required: true },
    ],
  },
];
