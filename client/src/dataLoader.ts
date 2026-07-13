import type {
  AppData,
  BusPosition,
  CalendarData,
  ExtraData,
  RoutesData,
  ShapesData,
  StopsData,
  TimetablesData,
} from "./types";

const DATA_BASE_URL = "/data";
const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${DATA_BASE_URL}/${path}`);
  if (!res.ok) {
    throw new Error(`データの読み込みに失敗しました: ${path} (${res.status})`);
  }
  return res.json() as Promise<T>;
}

async function fetchApiJson<T>(endpoint: string): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`);
  if (!res.ok) {
    throw new Error(`API呼び出しに失敗しました: ${endpoint} (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function loadAllData(): Promise<AppData> {
  const [stops, shapes, timetables, calendar, routes, extra] =
    await Promise.all([
      fetchJson<StopsData>("stops.json"),
      fetchJson<ShapesData>("shapes.json"),
      fetchJson<TimetablesData>("timetables.json"),
      fetchJson<CalendarData>("calendar.json"),
      fetchJson<RoutesData>("routes.json"),
      fetchJson<ExtraData>("extra.json"),
    ]);

  return { stops, shapes, timetables, delays: {}, calendar, routes, extra };
}

export async function loadEssentialData(): Promise<{
  calendar: CalendarData;
  routes: RoutesData;
  extra: ExtraData;
}> {
  const [calendar, routes, extra] = await Promise.all([
    fetchApiJson<CalendarData>("/calendar"),
    fetchApiJson<RoutesData>("/routes"),
    fetchApiJson<ExtraData>("/extra"),
  ]);

  return { calendar, routes, extra };
}

export async function fetchStopsByBounds(
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number,
): Promise<StopsData> {
  const url = `${API_BASE}/stops/search?minLat=${minLat}&maxLat=${maxLat}&minLng=${minLng}&maxLng=${maxLng}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`stops search failed (${res.status})`);
  }
  const data = await res.json();
  // { count: number, stops: StopsData }
  return data.stops as StopsData;
}

export async function fetchBusPositions(
  minLat?: number,
  maxLat?: number,
  minLng?: number,
  maxLng?: number,
): Promise<BusPosition[]> {
  let url = `${API_BASE}/buses`;

  if (
    minLat !== undefined &&
    maxLat !== undefined &&
    minLng !== undefined &&
    maxLng !== undefined
  ) {
    url += `?minLat=${minLat}&maxLat=${maxLat}&minLng=${minLng}&maxLng=${maxLng}`;
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`buses fetch failed (${res.status})`);
  }
  const data = await res.json();
  // { count: number, buses: BusPosition[], timestamp: number }
  return data.buses as BusPosition[];
}

export async function fetchTripDetails(
  routeId: string,
  tripId: string,
): Promise<import("./types").TripDetailResponse> {
  const url = `${API_BASE}/trips/${encodeURIComponent(routeId)}/${encodeURIComponent(tripId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`trip details fetch failed (${res.status})`);
  }
  return res.json();
}

export async function fetchStopTimetable(
  stopId: string,
): Promise<import("./types").StopTimetableResponse> {
  const url = `${API_BASE}/stops/${encodeURIComponent(stopId)}/timetable`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`stop timetable fetch failed (${res.status})`);
  }
  return res.json();
}

export async function fetchAllStops(): Promise<StopsData> {
  const url = `${API_BASE}/stops`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`all stops fetch failed (${res.status})`);
  }
  return res.json();
}
