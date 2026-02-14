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
}

/** サーバーから返されるバス位置情報 */
export interface BusPosition {
  trip_id: string;
  route_id: string;
  route_name: string;
  headsign: string;
  position: [number, number]; // [lng, lat]
  color: string;
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
}

/** サーバーから返されるバス停時刻表情報 */
export interface StopTimetableResponse {
  stop_id: string;
  stop_name: string;
  timetables: TimetablesData; // このバス停に停車する便のみ
}

// --- 全データをまとめた型 ---

/** アプリケーション全体で使用するデータの集合 */
export interface AppData {
  stops: StopsData;
  shapes: ShapesData;
  timetables: TimetablesData;
  calendar: CalendarData;
  routes: RoutesData;
  extra: ExtraData;
}
