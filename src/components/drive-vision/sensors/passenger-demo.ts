import type {
  AlcoholDetectionDto,
  BmsRowDto,
  BusBmsDto,
  BusStopsDto,
  ComparisonStopDto,
  PassengerSummaryDto,
  SensorReadingDto,
  SensorReadingsQuery,
  StopComparisonDto,
  StopVisitDto,
} from "@/features/drive-vision/api/types";
import type { ListResult } from "@/features/drive-vision/api/fleet-service";
import { PASSENGER_DEMO_JOURNEY, type DemoAlcoholCheck, type DemoBus, type DemoJourneyInput, type DemoSensorReading, type DemoStopInput } from "./passenger-demo-fixture";

/**
 * Passenger Analytics demo mode (SIMULATED DATA). Off unless NEXT_PUBLIC_PASSENGER_DEMO_MODE is exactly "true".
 *
 * The demo journey is a separate choice in the Sensors screen's Vehicle list, never a registry vehicle. When it is
 * chosen, the four reconciliation tabs read `passengerDemoSource` instead of `sensorService`: the same response shapes
 * built from one fixture, so every tab renders through the existing code. It never calls an API, never writes, and is
 * never used as a fallback for a failed live request. Pure: unit-tested.
 */
export const passengerDemoEnabled = (flag: string | undefined = process.env.NEXT_PUBLIC_PASSENGER_DEMO_MODE) => flag === "true";

/** The Vehicle list value of the demo journey: not a number, so it can never be taken for a vehicle id. */
export const DEMO_CHOICE = "demo";

// ── Derived journey ──────────────────────────────────────────────────────────

/** EXACT / MISMATCH only: the fixture has no critical stop, and the screen has no CRITICAL status. */
export type DemoStopStatus = "EXACT" | "MISMATCH";

export interface DemoBmsRecord {
  time: string;
  stop: string;
  seq: number;
  boarded: number;
  alighted: number;
  /** previous BMS on board + boarded − alighted. */
  onboard: number;
  bmsId: string;
}

export interface DemoStop extends DemoStopInput {
  /** BMS actual on board. */
  bmsActual: number;
  /** Sensor on board. */
  sensorReported: number;
  /** sensorReported − bmsActual. */
  difference: number;
  status: DemoStopStatus;
  bmsOverCapacity: boolean;
  sensorOverCapacity: boolean;
}

export interface DemoComparisonSummary {
  stops: number;
  compared: number;
  exactMatches: number;
  mismatches: number;
  /** Percent, 0–100. */
  matchRate: number;
  meanAbsoluteError: number;
  maxAbsoluteError: number;
  boardedBms: number;
  boardedSensor: number;
  alightedBms: number;
  alightedSensor: number;
}

export interface DemoDashboardSummary {
  busCapacity: number;
  onboardBms: number;
  onboardSensor: number;
  latestDifference: number;
  matchRate: number;
  overCapacityStops: number;
}

export interface DemoPassengerJourney {
  id: string;
  bus: DemoBus;
  alcohol: DemoAlcoholCheck;
  sensorReadings: DemoSensorReading[];
  bmsRecords: DemoBmsRecord[];
  stops: DemoStop[];
  comparison: DemoComparisonSummary;
  dashboard: DemoDashboardSummary;
}

// ── Calculations (shared by every tab) ───────────────────────────────────────

export const nextOnboard = (previous: number, boarded: number, alighted: number) => previous + boarded - alighted;
export const stopDifference = (sensorReported: number, bmsActual: number) => sensorReported - bmsActual;
export const matchRate = (exactMatches: number, comparedStops: number) => (comparedStops > 0 ? (exactMatches / comparedStops) * 100 : 0);
export const meanAbsoluteError = (differences: readonly number[]) => (differences.length ? differences.reduce((s, d) => s + Math.abs(d), 0) / differences.length : 0);
export const maxAbsoluteError = (differences: readonly number[]) => differences.reduce((m, d) => Math.max(m, Math.abs(d)), 0);
/** Stops where either count on board exceeds the capacity. */
export const overCapacityStops = (stops: readonly Pick<DemoStop, "bmsOverCapacity" | "sensorOverCapacity">[]) => stops.filter((s) => s.bmsOverCapacity || s.sensorOverCapacity).length;

/** Every derived value of a journey, from its inputs only. Stops are taken in sequence order. */
export function deriveJourney(input: DemoJourneyInput): DemoPassengerJourney {
  const { bus } = input;
  const ordered = [...input.stops].sort((a, b) => a.seq - b.seq);
  let bms = bus.startingPassengers;
  let sensor = bus.startingPassengers;
  const stops: DemoStop[] = ordered.map((s) => {
    bms = nextOnboard(bms, s.bmsIn, s.bmsOut);
    sensor = nextOnboard(sensor, s.sensorIn, s.sensorOut);
    const difference = stopDifference(sensor, bms);
    return {
      ...s,
      bmsActual: bms,
      sensorReported: sensor,
      difference,
      status: difference === 0 ? "EXACT" : "MISMATCH",
      bmsOverCapacity: bms > bus.capacity,
      sensorOverCapacity: sensor > bus.capacity,
    };
  });
  const differences = stops.map((s) => s.difference);
  const exactMatches = stops.filter((s) => s.status === "EXACT").length;
  const sum = (f: (s: DemoStop) => number) => stops.reduce((t, s) => t + f(s), 0);
  const comparison: DemoComparisonSummary = {
    stops: stops.length,
    compared: stops.length,
    exactMatches,
    mismatches: stops.length - exactMatches,
    matchRate: matchRate(exactMatches, stops.length),
    meanAbsoluteError: meanAbsoluteError(differences),
    maxAbsoluteError: maxAbsoluteError(differences),
    boardedBms: sum((s) => s.bmsIn),
    boardedSensor: sum((s) => s.sensorIn),
    alightedBms: sum((s) => s.bmsOut),
    alightedSensor: sum((s) => s.sensorOut),
  };
  const last = stops.at(-1);
  return {
    id: input.id,
    bus,
    alcohol: input.alcohol,
    sensorReadings: [...input.sensorReadings].sort((a, b) => a.time.localeCompare(b.time)),
    bmsRecords: stops.map((s) => ({ time: s.time, stop: s.stop, seq: s.seq, boarded: s.bmsIn, alighted: s.bmsOut, onboard: s.bmsActual, bmsId: s.bmsId })),
    stops,
    comparison,
    dashboard: {
      busCapacity: bus.capacity,
      onboardBms: last?.bmsActual ?? bus.startingPassengers,
      onboardSensor: last?.sensorReported ?? bus.startingPassengers,
      latestDifference: last?.difference ?? 0,
      matchRate: comparison.matchRate,
      overCapacityStops: overCapacityStops(stops),
    },
  };
}

/** The sensor readings agree with the derived sensor progression, stop by stop (same count, same values in order). */
export function readingsMatchStops(j: Pick<DemoPassengerJourney, "sensorReadings" | "stops">): boolean {
  return j.sensorReadings.length === j.stops.length && j.sensorReadings.every((r, i) => r.value === j.stops[i].sensorReported);
}

/** The one derived journey every tab uses (computed once; the fixture is constant, so tabs never get new records). */
export const DEMO_JOURNEY: DemoPassengerJourney = deriveJourney(PASSENGER_DEMO_JOURNEY);

// ── The screen's response shapes, from the derived journey ───────────────────

/** IST wall clock on the journey date → ISO instant (the screen formats it back in IST). */
export const demoInstant = (date: string, time: string) => new Date(`${date}T${time.length === 5 ? `${time}:00` : time}+05:30`).toISOString();

export function demoPassengerSummary(j: DemoPassengerJourney = DEMO_JOURNEY): PassengerSummaryDto {
  const last = j.stops.at(-1);
  const at = last ? demoInstant(j.bus.date, last.time) : null;
  return {
    busCapacity: j.dashboard.busCapacity,
    capacitySource: "VEHICLE",
    latestActualCount: j.dashboard.onboardBms,
    latestActualAt: at,
    latestSensorCount: j.dashboard.onboardSensor,
    latestSensorAt: at,
    latestDifference: j.dashboard.latestDifference,
    latestComparedAt: at,
    actualOverCapacity: !!last?.bmsOverCapacity,
    sensorOverCapacity: !!last?.sensorOverCapacity,
    totalStops: j.comparison.stops,
    comparedStops: j.comparison.compared,
    matchedStops: j.comparison.exactMatches,
    mismatchedStops: j.comparison.mismatches,
    overCapacityStops: j.dashboard.overCapacityStops,
    missingBmsStops: 0,
    missingSensorStops: 0,
    matchRatePct: j.dashboard.matchRate,
    maximumActualPassengerCount: Math.max(...j.stops.map((s) => s.bmsActual)),
    maximumSensorPassengerCount: Math.max(...j.stops.map((s) => s.sensorReported)),
    lastUpdatedAt: at,
    truncated: false,
  };
}

/** Stops and Sensor vs BMS both come from `j.stops`: the same records and statuses on both tabs. */
export function demoStops(j: DemoPassengerJourney = DEMO_JOURNEY): BusStopsDto {
  const stops: StopVisitDto[] = j.stops.map((s) => ({
    stopId: s.seq,
    stopName: s.stop,
    stopVisitTime: demoInstant(j.bus.date, s.time),
    countOfPeople: s.sensorReported,
    bmsStopSequence: s.seq,
    bmsBoarded: s.bmsIn,
    bmsAlighted: s.bmsOut,
    actualCount: s.bmsActual,
    sensorBoarded: s.sensorIn,
    sensorAlighted: s.sensorOut,
    sensorCount: s.sensorReported,
    difference: s.difference,
    busCapacity: j.bus.capacity,
    actualOverCapacity: s.bmsOverCapacity,
    sensorOverCapacity: s.sensorOverCapacity,
    comparisonStatus: s.status,
    notes: [s.note],
  }));
  return { busCapacity: j.bus.capacity, capacitySource: "VEHICLE", visitCount: stops.length, truncated: false, stops };
}

export function demoComparison(j: DemoPassengerJourney = DEMO_JOURNEY): StopComparisonDto {
  const c = j.comparison;
  const stops: ComparisonStopDto[] = j.stops.map((s) => ({
    stopId: s.seq,
    stopName: s.stop,
    stopVisitTime: demoInstant(j.bus.date, s.time),
    bms: { stopSequence: s.seq, boarded: s.bmsIn, alighted: s.bmsOut, actualCount: s.bmsActual, passengerCount: s.bmsActual },
    sensor: { boarded: s.sensorIn, alighted: s.sensorOut, sensorCount: s.sensorReported, count: s.sensorReported },
    difference: { count: s.difference, boarded: s.sensorIn - s.bmsIn, alighted: s.sensorOut - s.bmsOut },
    comparisonStatus: s.status,
    capacity: { busCapacity: j.bus.capacity, actualOverCapacity: s.bmsOverCapacity, sensorOverCapacity: s.sensorOverCapacity },
    notes: [s.note],
  }));
  return {
    busCapacity: j.bus.capacity,
    capacitySource: "VEHICLE",
    truncated: false,
    stops,
    summary: {
      visits: c.stops,
      visitsWithBms: c.stops,
      compared: c.compared,
      exactMatches: c.exactMatches,
      mismatches: c.mismatches,
      overCapacityStops: j.dashboard.overCapacityStops,
      missingBmsStops: 0,
      missingSensorStops: 0,
      matchRatePct: c.matchRate,
      meanAbsoluteError: c.meanAbsoluteError,
      maxAbsoluteError: c.maxAbsoluteError,
      bmsTotalBoarded: c.boardedBms,
      sensorTotalBoarded: c.boardedSensor,
      bmsTotalAlighted: c.alightedBms,
      sensorTotalAlighted: c.alightedSensor,
    },
  };
}

/** A BMS row with its demo BMS device label ("BMS-001"); `bmsId` (a numeric record id) stays unset. */
export type BmsTableRow = BmsRowDto & { bmsLabel?: string };

export function demoBms(j: DemoPassengerJourney = DEMO_JOURNEY): BusBmsDto & { rows: BmsTableRow[] } {
  const rows: BmsTableRow[] = j.bmsRecords.map((r) => ({
    stopId: r.seq,
    stopSequence: r.seq,
    stopName: r.stop,
    stopVisitTime: demoInstant(j.bus.date, r.time),
    passengersBoarded: r.boarded,
    passengersAlighted: r.alighted,
    passengerCount: r.onboard,
    bmsLabel: r.bmsId,
  }));
  return { rowCount: rows.length, truncated: false, rows };
}

export function demoReadings(j: DemoPassengerJourney = DEMO_JOURNEY, query: Pick<SensorReadingsQuery, "pageNumber" | "pageSize"> = {}): ListResult<SensorReadingDto> {
  const all: SensorReadingDto[] = j.sensorReadings.map((r) => ({
    sensorId: r.sensor,
    sensorName: r.type,
    timestamp: demoInstant(j.bus.date, r.time),
    sensorData: r.data,
    numericValue: r.value,
    activeStatus: r.active,
  }));
  const size = query.pageSize && query.pageSize > 0 ? query.pageSize : all.length || 1;
  const page = query.pageNumber && query.pageNumber > 0 ? query.pageNumber : 1;
  return { items: all.slice((page - 1) * size, page * size), total: all.length, source: null };
}

export function demoAlcohol(j: DemoPassengerJourney = DEMO_JOURNEY): AlcoholDetectionDto {
  return { detectionStatus: j.alcohol.status, alcoholDetected: null, sensorId: j.alcohol.sensor, sensorData: j.alcohol.value, timestamp: j.alcohol.time };
}

/**
 * Same method names and arguments as the read methods of `sensorService`, so the screen swaps the source and nothing
 * else. Device id and window are ignored: the demo journey has neither a real device nor live data.
 */
export const passengerDemoSource = {
  passengerSummary: async () => demoPassengerSummary(),
  comparison: async () => demoComparison(),
  stops: async () => demoStops(),
  bms: async () => demoBms(),
  readings: async (_id: number | null, query: SensorReadingsQuery) => demoReadings(DEMO_JOURNEY, query),
  alcohol: async () => demoAlcohol(),
};

/** "11 November 2026" — the journey date as shown. */
export function demoDateLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${d} ${months[m - 1]} ${y}`;
}
