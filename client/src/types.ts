// ============================================================
// 仙台市営バスマップ — データ型定義
// data/ フォルダの各 JSON ファイルに対応する TypeScript interface
// ============================================================

// --- calendar.json ---

/** 1サービスの運行カレンダー情報 */
export interface CalendarEntry {
  /** 曜日ごとの運行フラグ（月〜日） "1" = 運行, "0" = 運休 */
  days: string[];
  /** 運行開始日 (YYYYMMDD) */
  start: string;
  /** 運行終了日 (YYYYMMDD) */
  end: string;
}

/** calendar.json 全体: service_id → CalendarEntry */
export type CalendarData = Record<string, CalendarEntry>;

// --- extra.json ---

/** カレンダー例外日（祝日振替など） */
export interface CalendarDateException {
  /** 対象サービスID */
  service_id: string;
  /** 例外日 (YYYYMMDD) */
  date: string;
  /** 例外タイプ: "1" = 追加運行, "2" = 運休 */
  exception_type: string;
}

/** extra.json 全体 */
export interface ExtraData {
  /** 営業所情報: office_id → 営業所名 */
  offices: Record<string, string>;
  /** カレンダー例外日一覧 */
  calendar_dates: CalendarDateException[];
}

// --- routes.json ---

/** 1路線の基本情報 */
export interface RouteInfo {
  /** 路線番号（短縮名） */
  short_name: string;
  /** 路線カラー（HEX、# なし） */
  color: string;
}

/** routes.json 全体: route_id → RouteInfo */
export type RoutesData = Record<string, RouteInfo>;

// --- stops.json ---

/** 1バス停の情報 */
export interface StopInfo {
  /** バス停名 */
  name: string;
  /** 読み仮名 */
  yomi: string;
  /** 緯度 */
  lat: number;
  /** 経度 */
  lng: number;
  /** のりば番号（空文字の場合あり） */
  platform: string;
}

/** stops.json 全体: stop_id → StopInfo */
export type StopsData = Record<string, StopInfo>;

// --- shapes.json ---

/** 1経路パターンの形状データ */
export interface ShapeData {
  /** 経路座標の配列 [lng, lat][] */
  coordinates: [number, number][];
  /** 各バス停に対応する coordinates 配列内のインデックス */
  stop_indices: number[];
}

/** shapes.json 全体: パターンキー (stop_id をパイプ区切り) → ShapeData */
export type ShapesData = Record<string, ShapeData>;

// --- timetables.json ---

/** 1停車地点の時刻情報 */
export interface TripStop {
  /** 発着時刻 (HH:MM:SS) */
  time: string;
  /** バス停ID */
  stop_id: string;
  /** 遅延秒数（リアルタイム情報がある場合のみ）*/
  delay_seconds?: number;
}

/** 1便（トリップ）の情報 */
export interface TripInfo {
  /** 行先表示 */
  headsign: string;
  /** サービスID（calendar.json のキーに対応） */
  service_id: string;
  /** 営業所ID（extra.json の offices キーに対応） */
  office_id: string;
  /** 経由地（空文字の場合あり） */
  via: string;
  /** 停車バス停の時刻リスト */
  stops: TripStop[];
}

/** timetables.json 全体: route_id → trip_id → TripInfo */
export type TimetablesData = Record<string, Record<string, TripInfo>>;

// --- UI/状態管理用の型 ---

/** 現在パネルで表示している便の情報 */
export interface PanelTrip {
  tripId: string;
  routeId: string;
  highlightId: string | null;
  speedKmh?: number;
  occupancyStatus?: string;
  headsign?: string;
  nextStopId?: string;
  nextStopName?: string;
}

/** 選択中の便に関する最新のリアルタイム情報 */
export interface LiveTripTelemetry {
  tripId: string;
  speedKmh?: number;
  occupancyStatus?: string;
  headsign?: string;
  nextStopId?: string;
  nextStopName?: string;
}

/** バス停に到着する便の情報 */
export interface Arrival {
  time: string;
  route_id: string;
  trip_id: string;
  headsign: string;
  via: string;
  platform: string;
  actual_stop_id: string;
  is_past: boolean;
  /** 遅延秒数（リアルタイム情報がある場合のみ）*/
  delay_seconds?: number;
  /** 混雑度合い（GTFS-RT occupancy_status） */
  occupancy_status?: string;
  /** 便全体が運休か */
  is_canceled?: boolean;
  /** このバス停を通過するか */
  is_skipped?: boolean;
}

export interface AlertTargetRoute {
  route_id: string;
  short_name: string;
  color: string;
}

export interface AlertTargetStop {
  stop_id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface AlertTargetTrip {
  route_id: string;
  route_name: string;
  trip_id: string;
  headsign?: string;
}

/** GTFS-RT Alert フィードの運行情報 */
export interface ServiceAlert {
  id: string;
  cause?: string;
  effect?: string;
  header_text?: string;
  description_text?: string;
  url?: string;
  active_from?: number;
  active_to?: number;
  agency_wide?: boolean;
  target_routes?: AlertTargetRoute[];
  target_stops?: AlertTargetStop[];
  target_trips?: AlertTargetTrip[];
}

export interface DisruptedStopInfo {
  stop_id: string;
  name: string;
}

export interface DisruptedTripNotice {
  trip_id: string;
  route_id: string;
  route_name: string;
  route_color: string;
  headsign: string;
  via?: string;
  start_time?: string;
  first_stop_id?: string;
  first_stop_lat?: number;
  first_stop_lng?: number;
  canceled?: boolean;
  skipped_stops?: DisruptedStopInfo[];
}

export interface AlertsOverviewResponse {
  alerts: ServiceAlert[];
  disrupted_trips: DisruptedTripNotice[];
  count: number;
  fetched_at: number;
  realtime_error?: string;
}

/** サーバーから返されるバス位置情報 */
export interface BusPosition {
  trip_id: string;
  route_id: string;
  route_name: string;
  headsign: string;
  position: [number, number]; // [lng, lat]
  speed_kmh?: number;
  occupancy_status?: string;
  color: string;
  delay_seconds?: number;
  next_stop_id?: string;
  next_stop_name?: string;
}

/** サーバーから返される便詳細情報（全停車バス停情報を含む） */
export interface TripDetailResponse {
  trip_id: string;
  route_id: string;
  route_name: string;
  route_color: string;
  trip: TripInfo;
  stops: StopsData; // この便が停車する全バス停情報
  shape: ShapeData | null; // この便の経路形状
  office_name: string;
  /** 各停車地点の遅延秒数（stop_id → delay_seconds） */
  delays?: Record<string, number>;
  /** この便全体の遅延秒数 */
  trip_delay?: number;
  /** この便が運休か */
  canceled?: boolean;
  /** 通過扱いとなった stop_id 一覧 */
  skipped_stops?: string[];
  /** 関連する運行情報 */
  alerts?: ServiceAlert[];
}

/** サーバーから返されるバス停時刻表情報 */
export interface StopTimetableResponse {
  stop_id: string;
  stop_name: string;
  timetables: TimetablesData; // このバス停に停車する便のみ
  /** 各便の遅延秒数（route_id → trip_id → delay_seconds） */
  delays?: Record<string, Record<string, number>>;
  /** 運休となった便（route_id → trip_id → true） */
  canceled_trips?: Record<string, Record<string, boolean>>;
  /** このバス停を通過する便（route_id → trip_id → true） */
  skipped_trips?: Record<string, Record<string, boolean>>;
  /** 関連する運行情報 */
  alerts?: ServiceAlert[];
}

// --- 全データをまとめた型 ---

/** アプリケーション全体で使用するデータの集合 */
export interface AppData {
  stops: StopsData;
  shapes: ShapesData;
  timetables: TimetablesData;
  delays: Record<string, Record<string, number>>;
  calendar: CalendarData;
  routes: RoutesData;
  extra: ExtraData;
}

/** デバッグモード用のダミー状態表示設定 */
export interface DebugMockOptions {
  alert: boolean;
  canceled: boolean;
  skipped: boolean;
}

/** 地図ベースレイヤーの種類 */
export type MapLayerType =
  | "maptiler"
  | "maptiler-light"
  | "maptiler-dark"
  | "osm"
  | "pale"
  | "ortho";
