import { useEffect, useRef, useState, useCallback } from "react";
import type maplibregl from "maplibre-gl";
import {
  fetchStopsByBounds,
  loadEssentialData,
  fetchTripDetails,
  fetchStopTimetable,
} from "./dataLoader";
import type { AppData, PanelTrip, TripDetailResponse } from "./types";
import "./App.css";

// コンポーネント
import MapContainer from "./components/MapContainer";
import SearchBox from "./components/SearchBox";
import BusPanel from "./components/BusPanel";
import LayerControl from "./components/LayerControl";

const isDebugEnabledFromSearch = (search: string): boolean => {
  const params = new URLSearchParams(search);
  if (!params.has("debug")) return false;
  const raw = (params.get("debug") || "").trim().toLowerCase();
  if (raw === "" || raw === "1" || raw === "true" || raw === "on") return true;
  return false;
};

const buildDebugModeUrl = (): string => {
  const url = new URL(window.location.href);
  url.searchParams.set("debug", "1");
  return url.toString();
};

function App() {
  // --- データ ---
  const [data, setData] = useState<AppData>({
    stops: {},
    shapes: {},
    timetables: {},
    delays: {},
    calendar: {},
    routes: {},
    extra: { offices: {}, calendar_dates: [] },
  });

  // バス詳細データ（selectedTripが選択されたときにサーバーから取得）
  const [tripDetail, setTripDetail] = useState<TripDetailResponse | null>(null);

  // バス停時刻表の遅延情報（route_id → trip_id → delay_seconds）
  const [stopDelays, setStopDelays] = useState<
    Record<string, Record<string, number>>
  >({});

  // --- 地図インスタンスの参照 (FlyTo用) ---
  const mapRef = useRef<maplibregl.Map | null>(null);

  // --- 状態管理 ---
  const [activeLayer, setActiveLayer] = useState<"pale" | "ortho" | "osm">(
    "osm",
  );
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [selectedTrip, setSelectedTrip] = useState<PanelTrip | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [zoom, setZoom] = useState(15);
  const [isDebugMode, setIsDebugMode] = useState(() =>
    isDebugEnabledFromSearch(window.location.search),
  );
  const [debugModeUrl, setDebugModeUrl] = useState(() => buildDebugModeUrl());
  // このバス停IDの時刻表が1回目のフェッチ完了済か管理する
  // （キャッシュされた旧データで誤スクロールしないため）
  const [timetableReadyForStop, setTimetableReadyForStop] = useState<
    string | null
  >(null);
  const isPanelOpen = !!selectedStopId || !!selectedTrip;

  // ==================== データ読み込み ====================
  // 初期化時に必須データ（calendar, routes, extra）のみを取得
  useEffect(() => {
    const initData = async () => {
      try {
        const essentialData = await loadEssentialData();
        setData((prev) => ({
          ...prev,
          calendar: essentialData.calendar,
          routes: essentialData.routes,
          extra: essentialData.extra,
        }));
      } catch (e) {
        console.error("failed to load essential data", e);
      }
    };
    initData();
  }, []);

  // selectedTrip が変更されたら、サーバーから便詳細（全停車バス停情報+shape）を取得
  useEffect(() => {
    if (!selectedTrip) return;

    let cancelled = false;

    const loadTripDetail = async () => {
      try {
        const detail = await fetchTripDetails(
          selectedTrip.routeId,
          selectedTrip.tripId,
        );
        if (cancelled) return;
        setTripDetail(detail);

        // 取得したバス停情報とtimetables、shapesを data にマージ
        setData((prev) => {
          const patternKey = detail.trip.stops.map((s) => s.stop_id).join("|");
          return {
            ...prev,
            stops: { ...prev.stops, ...detail.stops },
            // 便情報を timetables にマージ
            timetables: {
              ...prev.timetables,
              [detail.route_id]: {
                ...(prev.timetables[detail.route_id] || {}),
                [detail.trip_id]: detail.trip,
              },
            },
            // 経路形状も保存
            shapes: detail.shape
              ? {
                  ...prev.shapes,
                  [patternKey]: detail.shape,
                }
              : prev.shapes,
          };
        });
      } catch (e) {
        console.error("failed to load trip details", e);
        if (!cancelled) {
          setTripDetail(null);
        }
      }
    };

    loadTripDetail();

    const interval = setInterval(loadTripDetail, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedTrip]);

  // selectedStopId が変更されたら、サーバーからそのバス停の時刻表を取得
  useEffect(() => {
    if (!selectedStopId) return;

    let cancelled = false;
    let isFirstLoad = true;

    const loadStopTimetable = async () => {
      try {
        const timetableData = await fetchStopTimetable(selectedStopId);
        if (cancelled) return;
        // 遅延情報を保存
        setStopDelays(timetableData.delays ?? {});
        // 取得した時刻表データを data.timetables にマージ
        setData((prev) => ({
          ...prev,
          delays: timetableData.delays ?? {},
          timetables: {
            ...prev.timetables,
            ...timetableData.timetables,
          },
        }));
        // 最初のフェッチ完了時のみスクロール許可フラグを立てる
        // （10秒ごとの更新では再スクロールしない）
        if (isFirstLoad) {
          isFirstLoad = false;
          setTimetableReadyForStop(selectedStopId);
        }
      } catch (e) {
        console.error("failed to load stop timetable", e);
      }
    };

    loadStopTimetable();

    const interval = setInterval(loadStopTimetable, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedStopId]);

  // 地図の移動に合わせて stops のみを fetchStopsByBounds で取得
  const handleBoundsChange = useCallback(
    async (minLat: number, maxLat: number, minLng: number, maxLng: number) => {
      try {
        const stops = await fetchStopsByBounds(minLat, maxLat, minLng, maxLng);
        setData((prev) => {
          // 新しいバス停情報を設定
          const newStops = { ...stops };

          // 選択中のバス停は必ず保持（画面外でも消えないように）
          if (selectedStopId && prev.stops[selectedStopId]) {
            newStops[selectedStopId] = prev.stops[selectedStopId];
          }

          return { ...prev, stops: newStops };
        });
      } catch (e) {
        console.error("failed to fetch stops by bounds", e);
      }
    },
    [selectedStopId],
  );

  // ==================== 検索でバス停を選択 ====================

  const handleSelectSearchStop = useCallback(
    async (stopName: string, lat: number, lng: number) => {
      const map = mapRef.current;
      if (!map) return;

      // 検索から選択した場合は常に集約表示（ズーム15）にする
      map.flyTo({
        center: [lng, lat],
        zoom: 15,
        essential: true,
      });

      setZoom(15);

      // サーバーから少し広めの範囲でバス停を取得（検索したバス停が必ず含まれるように）
      const offset = 0.001; // 約100m
      try {
        const stops = await fetchStopsByBounds(
          lat - offset,
          lat + offset,
          lng - offset,
          lng + offset,
        );
        setData((prev) => ({ ...prev, stops }));

        // 取得したバス停から、同じ名前のバス停の最初のIDを選択
        const targetStop = Object.values(stops).find(
          (s) => s.name === stopName,
        );
        if (targetStop) {
          const firstStopId = Object.keys(stops).find(
            (id) => stops[id].name === stopName,
          );
          if (firstStopId) {
            // 時刻表データを先読みしてから選択（キャッシュデータで誤スクロールしないため）
            try {
              const timetableData = await fetchStopTimetable(firstStopId);
              // React 18のバッチ処理でこれど3つのセットは1レンダーにまとめられる
              setData((prev) => ({
                ...prev,
                delays: timetableData.delays ?? {},
                timetables: { ...prev.timetables, ...timetableData.timetables },
              }));
              setTimetableReadyForStop(firstStopId);
            } catch (e) {
              console.error("時刻表の先読みに失敗:", e);
            }
            setSelectedStopId(firstStopId);
            setSelectedTrip(null);
          }
        }
      } catch (e) {
        console.error("検索からバス停を選択する際のエラー:", e);
      }
    },
    [],
  );

  // ==================== ハンドラ ====================

  const handleStopClick = useCallback((id: string, currentZoom?: number) => {
    setSelectedStopId(id);
    setSelectedTrip(null);
    setIsSearching(false);
    if (currentZoom !== undefined) {
      setZoom(currentZoom);
    }
  }, []);

  const handleBusClick = useCallback(
    (
      tripId: string,
      routeId: string,
      highlightId: string | null = null,
      speedKmh?: number,
      occupancyStatus?: string,
    ) => {
      setSelectedTrip({
        tripId,
        routeId,
        highlightId,
        speedKmh,
        occupancyStatus,
      });
      setSelectedStopId(null);
      setIsSearching(false);
    },
    [],
  );

  const handleClosePanel = useCallback(() => {
    setSelectedStopId(null);
    setSelectedTrip(null);
    setTripDetail(null);
    setIsSearching(false);
  }, []);

  const handleFlyToStop = useCallback((lng: number, lat: number) => {
    const map = mapRef.current;
    if (!map) return;
    const isMobile = window.innerWidth < 768;
    map.flyTo({
      center: [lng, lat],
      zoom: 17,
      speed: 1.2,
      padding: isMobile
        ? { top: 0, bottom: window.innerHeight * 0.4, left: 0, right: 0 }
        : { top: 0, bottom: 0, left: 400, right: 0 },
    });
    setZoom(17);
  }, []);

  // ==================== is-searching body class ====================

  useEffect(() => {
    if (isSearching) {
      document.body.classList.add("is-searching");
    } else {
      document.body.classList.remove("is-searching");
    }
  }, [isSearching]);

  useEffect(() => {
    const syncDebugState = () => {
      setIsDebugMode(isDebugEnabledFromSearch(window.location.search));
      setDebugModeUrl(buildDebugModeUrl());
    };

    window.addEventListener("popstate", syncDebugState);
    window.addEventListener("hashchange", syncDebugState);
    return () => {
      window.removeEventListener("popstate", syncDebugState);
      window.removeEventListener("hashchange", syncDebugState);
    };
  }, []);

  // ==================== ローディング ====================

  if (!data) {
    return <div className="loading-screen">読み込み中...</div>;
  }

  // ==================== レンダリング ====================

  return (
    <>
      <SearchBox
        onSelectStop={handleSelectSearchStop}
        onSearchStateChange={setIsSearching}
        onFocus={handleClosePanel}
        isOpen={isSearching}
      />

      <LayerControl activeLayer={activeLayer} onLayerChange={setActiveLayer} />

      {isDebugMode && (
        <div id="debug-info-panel" role="status" aria-live="polite">
          <div className="debug-row">
            <span className="debug-label">Debug URL</span>
            <span className="debug-value">{debugModeUrl}</span>
          </div>
          <div className="debug-row">
            <span className="debug-label">Zoom</span>
            <span className="debug-value">{zoom.toFixed(2)}</span>
          </div>
        </div>
      )}

      <BusPanel
        data={data}
        selectedStopId={selectedStopId}
        selectedTrip={selectedTrip}
        tripDetail={tripDetail}
        isDebugMode={isDebugMode}
        stopDelays={stopDelays}
        zoom={zoom}
        timetableReadyForStop={timetableReadyForStop}
        onClose={handleClosePanel}
        onSelectBus={handleBusClick}
        onFlyToStop={handleFlyToStop}
      />

      <a
        id="github-footer-link"
        href="https://github.com/Haruday0/sendai-bus-map-v2"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="GitHubでこのプロジェクトを開く"
        title="GitHubでこのプロジェクトを開く"
      >
        <svg
          className="github-mark"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          aria-hidden
        >
          <path
            fill="currentColor"
            d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.52 7.52 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
          />
        </svg>
        <span>GitHub</span>
      </a>

      <MapContainer
        data={data}
        activeLayer={activeLayer}
        isPanelOpen={isPanelOpen}
        selectedTrip={selectedTrip}
        onStopClick={handleStopClick}
        onBusClick={handleBusClick}
        onMapClick={handleClosePanel}
        onMoveStart={() => setIsSearching(false)}
        onZoomChange={setZoom}
        setMapRef={(map) => (mapRef.current = map)}
        onBoundsChange={handleBoundsChange}
      />
    </>
  );
}

export default App;
