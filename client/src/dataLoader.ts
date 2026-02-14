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
const API_BASE =
  "https://sendai-bus-map-api-455968320156.asia-northeast1.run.app/api"; // バックエンド API ベース

/**
 * 指定パスの JSON を fetch して型付きで返す（旧実装：静的ファイル用）
 */
async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${DATA_BASE_URL}/${path}`);
  if (!res.ok) {
    throw new Error(`データの読み込みに失敗しました: ${path} (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/**
 * サーバーAPIから JSON を fetch して型付きで返す
 */
async function fetchApiJson<T>(endpoint: string): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`);
  if (!res.ok) {
    throw new Error(`API呼び出しに失敗しました: ${endpoint} (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/**
 * data/ フォルダから全データを並列に読み込み、型付きで返す
 * 【非推奨】必要なデータだけをAPIから取得することを推奨
 */
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

  return { stops, shapes, timetables, calendar, routes, extra };
}

/**
 * サーバーから必須データ（calendar, routes, extra）を取得
 */
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

/**
 * バックエンドの /api/stops/search を呼んで範囲内の stops を取得する
 */
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

/**
 * バックエンドの /api/buses から現在運行中のバス位置を取得する
 * 範囲指定がある場合はその範囲内のバスのみを取得
 */
export async function fetchBusPositions(
  minLat?: number,
  maxLat?: number,
  minLng?: number,
  maxLng?: number,
): Promise<BusPosition[]> {
  let url = `${API_BASE}/buses`;

  // 範囲指定がある場合はクエリパラメータを追加
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

/**
 * バックエンドの /api/trips/:routeId/:tripId から便詳細を取得する
 * この便が停車する全バス停情報と経路形状を含む
 */
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

/**
 * バックエンドの /api/stops/:stopId/timetable からバス停の時刻表を取得する
 */
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

/**
 * バックエンドの /api/stops から全バス停データを取得する
 */
export async function fetchAllStops(): Promise<StopsData> {
  const url = `${API_BASE}/stops`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`all stops fetch failed (${res.status})`);
  }
  return res.json();
}
