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

function App() {
  // --- データ ---
  const [data, setData] = useState<AppData>({
    stops: {},
    shapes: {},
    timetables: {},
    calendar: {},
    routes: {},
    extra: { offices: {}, calendar_dates: [] },
  });

  // バス詳細データ（selectedTripが選択されたときにサーバーから取得）
  const [tripDetail, setTripDetail] = useState<TripDetailResponse | null>(null);

  // --- 地図インスタンスの参照 (FlyTo用) ---
  const mapRef = useRef<maplibregl.Map | null>(null);

  // --- 状態管理 ---
  const [activeLayer, setActiveLayer] = useState<"pale" | "ortho">("pale");
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [selectedTrip, setSelectedTrip] = useState<PanelTrip | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [zoom, setZoom] = useState(15);

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

    const loadTripDetail = async () => {
      try {
        const detail = await fetchTripDetails(
          selectedTrip.routeId,
          selectedTrip.tripId,
        );
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
        setTripDetail(null);
      }
    };
    loadTripDetail();
  }, [selectedTrip]);

  // selectedStopId が変更されたら、サーバーからそのバス停の時刻表を取得
  useEffect(() => {
    if (!selectedStopId) {
      return;
    }

    const loadStopTimetable = async () => {
      try {
        const timetableData = await fetchStopTimetable(selectedStopId);
        // 取得した時刻表データを data.timetables にマージ
        setData((prev) => ({
          ...prev,
          timetables: {
            ...prev.timetables,
            ...timetableData.timetables,
          },
        }));
      } catch (e) {
        console.error("failed to load stop timetable", e);
      }
    };
    loadStopTimetable();
  }, [selectedStopId]);

  // 地図の移動に合わせて stops のみを fetchStopsByBounds で取得
  const handleBoundsChange = useCallback(
    async (minLat: number, maxLat: number, minLng: number, maxLng: number) => {
      try {
        const stops = await fetchStopsByBounds(minLat, maxLat, minLng, maxLng);
        setData((prev) => ({ ...prev, stops }));
      } catch (e) {
        console.error("failed to fetch stops by bounds", e);
      }
    },
    [],
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
          // 少し遅延させてからバス停を選択（マーカーが描画されるのを待つ）
          setTimeout(() => {
            const firstStopId = Object.keys(stops).find(
              (id) => stops[id].name === stopName,
            );
            if (firstStopId) {
              setSelectedStopId(firstStopId);
              setSelectedTrip(null);
            }
          }, 100);
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
    (tripId: string, routeId: string, highlightId: string | null = null) => {
      setSelectedTrip({ tripId, routeId, highlightId });
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

      <BusPanel
        data={data}
        selectedStopId={selectedStopId}
        selectedTrip={selectedTrip}
        tripDetail={tripDetail}
        zoom={zoom}
        onClose={handleClosePanel}
        onSelectBus={handleBusClick}
        onFlyToStop={handleFlyToStop}
      />

      <MapContainer
        data={data}
        activeLayer={activeLayer}
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
