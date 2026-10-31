import {
  Bell,
  BriefcaseBusiness,
  CalendarCheck2,
  ClipboardList,
  FileChartColumn,
  Cctv,
  Gauge,
  LayoutGrid,
  MapPinned,
  Radar,
  Route,
  Settings,
  ShieldCheck,
  SquareTerminal,
  Truck,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { greeting } from "@/features/drive-vision/utils/time";
import { DV_BASE, SCREEN_ROUTES, type ScreenKey } from "@/features/drive-vision/access/access-policy";

export interface NavItem {
  /** Access-policy key; the route comes from SCREEN_ROUTES so the two can't drift. */
  screen: ScreenKey;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Short description used by global search. */
  description: string;
  /** Header subtitle shown under the page title. */
  subtitle: string;
}

export interface NavGroup {
  label: string;
  /** Label in the topbar section switcher (defaults to `label`). */
  short?: string;
  items: NavItem[];
}

export { DV_BASE };

export const NAV_GROUPS: NavGroup[] = [
  {
    // Driver self-service; only shown to the Driver app role (see access-policy DRIVER_SELF_SERVICE_SCREENS).
    label: "My work",
    items: [{ label: "My Work", screen: "myWork", href: SCREEN_ROUTES.myWork, icon: BriefcaseBusiness, description: "My trips, shift, leave and checklist", subtitle: "Your trips, shift, leave, checklist and safety" }],
  },
  {
    label: "Overview",
    items: [{ label: "Fleet Overview", screen: "overview", href: SCREEN_ROUTES.overview, icon: LayoutGrid, description: "Fleet KPIs, trends and reminders", subtitle: "Fleet activity, safety and upcoming work at a glance" }],
  },
  {
    label: "Monitor",
    items: [
      { label: "Live Monitoring", screen: "monitoring", href: SCREEN_ROUTES.monitoring, icon: Radar, description: "Map of live vehicle positions", subtitle: "Live positions, status and alarms across the fleet" },
      { label: "Historical Video", screen: "video", href: SCREEN_ROUTES.video, icon: Cctv, description: "Camera playback and clips", subtitle: "Recorded camera footage by vehicle, channel and time" },
      { label: "Trips & Tracking", screen: "trips", href: SCREEN_ROUTES.trips, icon: Route, description: "Trip history and route playback", subtitle: "Trip history with route playback, stops and events" },
      { label: "Reports", screen: "reports", href: SCREEN_ROUTES.reports, icon: FileChartColumn, description: "Mileage, driving, parking and media reports", subtitle: "Mileage, driving, parking and media reports by device and date" },
    ],
  },
  {
    label: "Fleet",
    items: [
      { label: "Vehicles & Assets", screen: "vehicles", href: SCREEN_ROUTES.vehicles, icon: Truck, description: "Vehicles, devices and groups", subtitle: "Vehicles, tracking devices and groups" },
      { label: "Drivers", screen: "drivers", href: SCREEN_ROUTES.drivers, icon: UserRound, description: "Driver records and assignments", subtitle: "Driver records, licences and vehicle assignments" },
      { label: "Dispatch", screen: "dispatch", href: SCREEN_ROUTES.dispatch, icon: ClipboardList, description: "Trip dispatch, conflicts and swaps", subtitle: "Dispatched trips, conflict checks and driver swaps" },
      { label: "Workforce", screen: "workforce", href: SCREEN_ROUTES.workforce, icon: CalendarCheck2, description: "Availability, shifts, leave and checklists", subtitle: "Driver availability, shifts, leave and pre-trip checklists" },
    ],
  },
  {
    label: "Safety",
    items: [
      { label: "Alerts & Events", screen: "alerts", href: SCREEN_ROUTES.alerts, icon: Bell, description: "Incidents, AI events and alarms", subtitle: "Incident handling, AI events and routine alarms" },
      { label: "Safety Analytics", screen: "safety", href: SCREEN_ROUTES.safety, icon: ShieldCheck, description: "Scores, trends and risk", subtitle: "Event trends and safety scores for drivers and vehicles" },
    ],
  },
  {
    label: "Manage",
    items: [
      { label: "Geofences", screen: "geofences", href: SCREEN_ROUTES.geofences, icon: MapPinned, description: "Zones, lines and rules", subtitle: "Zones, route lines and their alert rules" },
      { label: "Device Commands", screen: "commands", href: SCREEN_ROUTES.commands, icon: SquareTerminal, description: "Device command history and types", subtitle: "Command history and types from the server — sending is off" },
    ],
  },
  {
    label: "Administration",
    short: "Admin",
    items: [
      { label: "Users & Sub-Accounts", screen: "users", href: SCREEN_ROUTES.users, icon: UsersRound, description: "User tree and roles", subtitle: "Account tree, roles and permissions" },
      { label: "Settings", screen: "settings", href: SCREEN_ROUTES.settings, icon: Settings, description: "Preferences", subtitle: "Profile and workspace preferences" },
    ],
  },
];

export function findNavGroup(pathname: string) {
  const item = findNavItem(pathname);
  return NAV_GROUPS.find((g) => g.items.some((i) => i.href === item?.href));
}

/** Routes whose content is a full-height workspace (map/video) — they get a compact page heading. */
export function isWorkspaceRoute(pathname: string) {
  return /\/drive-vision\/(monitoring|video|trips|geofences)(\/|$)/.test(pathname);
}

export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

export function findNavItem(pathname: string) {
  return [...ALL_NAV_ITEMS].sort((a, b) => b.href.length - a.href.length).find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
}

export const BRAND_ICON = Gauge;

export interface PageMeta {
  title: string;
  subtitle: string;
  /** True for nested routes (e.g. a vehicle's detail page) — the header shows the parent section. */
  nested: boolean;
  item?: NavItem;
}

/** Driver-app sections: one route each under My Work (see MENU_ROUTES in the access policy). */
const MY_WORK_SECTIONS: Record<string, { title: string; subtitle: string }> = {
  [`${SCREEN_ROUTES.myWork}/shifts`]: { title: "My Shifts", subtitle: "Your current shift and working hours" },
  [`${SCREEN_ROUTES.myWork}/leave`]: { title: "My Leave", subtitle: "Your leave requests and their status" },
  [`${SCREEN_ROUTES.myWork}/checklist`]: { title: "Shift Checklist", subtitle: "Pre-trip vehicle checklist and your recent submissions" },
  [`${SCREEN_ROUTES.myWork}/safety`]: { title: "My Safety", subtitle: "Your safety score and recent events" },
  [`${SCREEN_ROUTES.myWork}/profile`]: { title: "My Profile", subtitle: "Your contact details and licence" },
};

/** Header title/subtitle for a route — derived from the path so it renders on the server (no flash). */
export function getPageMeta(pathname: string, displayName: string, now: Date): PageMeta {
  const item = findNavItem(pathname);
  if (!item) return { title: "SafeFare AI", subtitle: "AI fleet intelligence", nested: false };
  const section = MY_WORK_SECTIONS[pathname.split(/[?#]/)[0].replace(/\/+$/, "")];
  if (section) return { ...section, nested: false, item };
  const nested = pathname !== item.href;
  if (item.href.endsWith("/overview")) {
    return { title: `${greeting(now)}, ${displayName || "there"}`, subtitle: item.subtitle, nested, item };
  }
  return { title: item.label, subtitle: item.subtitle, nested, item };
}
