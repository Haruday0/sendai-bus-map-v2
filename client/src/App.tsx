import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import type * as maplibregl from "maplibre-gl";
import {
  Badge,
  Button,
  Checkbox,
  Disclosure,
  Label,
  Separator,
  Slider,
  Surface,
} from "@heroui/react";
import {
  fetchAlertsOverview,
  fetchAllStops,
  fetchStopsByBounds,
  loadEssentialData,
  fetchTripDetails,
  fetchStopTimetable,
} from "./dataLoader";
import { getPanelMapPadding } from "./utils";
import type {
  AlertsOverviewResponse,
  AppData,
  DebugMockOptions,
  DisruptedTripNotice,
  LiveTripTelemetry,
  MapLayerType,
  PanelTrip,
  ServiceAlert,
  StopsData,
  TripDetailResponse,
  TimetablesData,
} from "./types";
import "./App.css";

// コンポーネント
import MapContainer from "./components/MapContainer";
import SearchBox from "./components/SearchBox";
import BusPanel from "./components/BusPanel";
import LayerControl from "./components/LayerControl";
import ThemeToggleButton from "./components/ThemeToggleButton";
import AboutModal from "./components/AboutModal";
import ServiceAlertsModal from "./components/ServiceAlertsModal";
import { DEBUG_MOCK_ALERTS } from "./alertConstants";
import StartupOverlay, {
  type StartupTaskItem,
} from "./components/StartupOverlay";

const isDebugEnabledFromSearch = (search: string): boolean => {
  const params = new URLSearchParams(search);
  if (!params.has("debug")) return false;
  const raw = (params.get("debug") || "").trim().toLowerCase();
  if (raw === "" || raw === "1" || raw === "true" || raw === "on") return true;
  return false;
};

const mergeRouteTripFlags = (
  target: Record<string, Record<string, boolean>>,
  source?: Record<string, Record<string, boolean>>,
) => {
  if (!source) return;
  Object.keys(source).forEach((rid) => {
    target[rid] = { ...(target[rid] || {}), ...source[rid] };
  });
};

const dedupeServiceAlerts = (alerts: ServiceAlert[]): ServiceAlert[] => {
  const seen = new Set<string>();
  const result: ServiceAlert[] = [];
  for (const alert of alerts) {
    const key =
      alert.id || `${alert.header_text ?? ""}|${alert.description_text ?? ""}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(alert);
  }
  return result;
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

  // 選択中バス停の運休・通過・運行情報
  const [stopStatus, setStopStatus] = useState<{
    stopId: string | null;
    canceledTrips: Record<string, Record<string, boolean>>;
    skippedTrips: Record<string, Record<string, boolean>>;
    alerts: ServiceAlert[];
  }>({
    stopId: null,
    canceledTrips: {},
    skippedTrips: {},
    alerts: [],
  });

  // --- 地図インスタンスの参照 (FlyTo用) ---
  const mapRef = useRef<maplibregl.Map | null>(null);
  const boundsRequestIdRef = useRef(0);

  // --- 状態管理 ---
  const hasMapTiler = Boolean((import.meta.env.VITE_MAPTILER_API_KEY || "").trim());
  const [activeLayer, setActiveLayer] = useState<MapLayerType>(
    hasMapTiler ? "maptiler" : "osm",
  );
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [selectedTrip, setSelectedTrip] = useState<PanelTrip | null>(null);
  const [isPanelExpanded, setIsPanelExpanded] = useState(false);
  const [liveTripTelemetry, setLiveTripTelemetry] =
    useState<LiveTripTelemetry | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [zoom, setZoom] = useState(15);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);
  const [alertsOverview, setAlertsOverview] =
    useState<AlertsOverviewResponse | null>(null);
  const [isLoadingAlerts, setIsLoadingAlerts] = useState(false);
  const [isDebugMode, setIsDebugMode] = useState(() =>
    isDebugEnabledFromSearch(window.location.search),
  );

  // --- 起動進捗・準備状態 ---
  const [allStops, setAllStops] = useState<StopsData>({});
  const [essentialLoaded, setEssentialLoaded] = useState(false);
  const [allStopsLoaded, setAllStopsLoaded] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [initialStopsLoaded, setInitialStopsLoaded] = useState(false);
  const [initialBusesLoaded, setInitialBusesLoaded] = useState(false);
  const [isServerWaking, setIsServerWaking] = useState(false);
  const [isAppReady, setIsAppReady] = useState(false);

  const [simSeconds, setSimSeconds] = useState(8 * 3600 + 30 * 60);
  const [enableSimTime, setEnableSimTime] = useState(false);
  const [debugMockOptions, setDebugMockOptions] = useState<DebugMockOptions>({
    alert: false,
    canceled: false,
    skipped: false,
  });

  const formatSimTime = (totalSec: number) => {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
  };
  const activeSimTimeString =
    isDebugMode && enableSimTime ? formatSimTime(simSeconds) : undefined;

  // 最新の data.stops と zoom を安全に参照するための ref（無限ループ・重さ防止）
  const dataStopsRef = useRef(data.stops);
  const zoomRef = useRef(zoom);

  useEffect(() => {
    dataStopsRef.current = data.stops;
  }, [data.stops]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // このバス停IDの時刻表が1回目のフェッチ完了済か管理する
  const [timetableReadyForStop, setTimetableReadyForStop] = useState<
    string | null
  >(null);
  const isPanelOpen = !!selectedStopId || !!selectedTrip;

  // ==================== データ読み込み ====================
  // 初期化時に必須データ（calendar, routes, extra）と全バス停データを並列取得（Azureコールドスタート時はリトライ）
  useEffect(() => {
    let cancelled = false;
    let essentialTimer: ReturnType<typeof setTimeout> | null = null;
    let stopsTimer: ReturnType<typeof setTimeout> | null = null;

    const initEssential = async () => {
      try {
        const essentialData = await loadEssentialData();
        if (cancelled) return;
        setData((prev) => ({
          ...prev,
          calendar: essentialData.calendar,
          routes: essentialData.routes,
          extra: essentialData.extra,
        }));
        setEssentialLoaded(true);
      } catch (e) {
        console.error("failed to load essential data", e);
        if (!cancelled) {
          setIsServerWaking(true);
          essentialTimer = setTimeout(initEssential, 2500);
        }
      }
    };

    const initAllStops = async () => {
      try {
        const stops = await fetchAllStops();
        if (cancelled) return;
        setAllStops(stops);
        setAllStopsLoaded(true);
      } catch (e) {
        console.error("failed to load all stops", e);
        if (!cancelled) {
          setIsServerWaking(true);
          stopsTimer = setTimeout(initAllStops, 2500);
        }
      }
    };

    initEssential();
    initAllStops();

    return () => {
      cancelled = true;
      if (essentialTimer) clearTimeout(essentialTimer);
      if (stopsTimer) clearTimeout(stopsTimer);
    };
  }, []);

  // サーバーのコールドスタート待ち表示
  useEffect(() => {
    if (isAppReady) return;
    const wakingTimer = setTimeout(() => {
      setIsServerWaking(true);
    }, 3000);
    return () => {
      clearTimeout(wakingTimer);
    };
  }, [isAppReady]);

  const serverConnected =
    essentialLoaded ||
    allStopsLoaded ||
    initialStopsLoaded ||
    initialBusesLoaded;
  const initialLiveLoaded = initialStopsLoaded && initialBusesLoaded;

  const startupTasks: StartupTaskItem[] = [
    {
      id: "essential",
      label: "路線・ダイヤデータ",
      status: essentialLoaded
        ? "done"
        : serverConnected
          ? "loading"
          : "waiting",
    },
    {
      id: "stops",
      label: "全バス停データ",
      status: allStopsLoaded
        ? "done"
        : serverConnected
          ? "loading"
          : "waiting",
    },
    {
      id: "live",
      label: "周辺バス停・運行状況",
      status: initialLiveLoaded
        ? "done"
        : serverConnected
          ? "loading"
          : "waiting",
    },
    {
      id: "map",
      label: "地図",
      status: mapLoaded ? "done" : "loading",
    },
  ];

  const completedStartupTasks = startupTasks.filter(
    (task) => task.status === "done",
  ).length;
  const allStartupStepsDone = completedStartupTasks === startupTasks.length;

  const bootProgress =
    allStartupStepsDone || isAppReady
      ? 100
      : Math.round((completedStartupTasks / startupTasks.length) * 100);

  const bootStatusText = allStartupStepsDone
    ? "読み込み完了"
    : !serverConnected
      ? mapLoaded
        ? "サーバー応答待ち..."
        : "データ・地図を準備中..."
      : !essentialLoaded || !allStopsLoaded || !initialLiveLoaded
        ? mapLoaded
          ? "バスデータを読み込み中..."
          : "データ・地図を読み込み中..."
        : "地図を読み込み中...";

  useEffect(() => {
    if (!allStartupStepsDone || isAppReady) return;
    // ProgressBarのwidthアニメーション(300ms)完了と100%表示の視認のため少し待つ
    const timer = setTimeout(() => {
      setIsAppReady(true);
    }, 450);
    return () => clearTimeout(timer);
  }, [allStartupStepsDone, isAppReady]);

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
          const nextTimetables = detail.trip_id.startsWith("rt_")
            ? prev.timetables
            : {
                ...prev.timetables,
                [detail.route_id]: {
                  ...(prev.timetables[detail.route_id] || {}),
                  [detail.trip_id]: detail.trip,
                },
              };
          return {
            ...prev,
            stops: { ...prev.stops, ...detail.stops },
            timetables: nextTimetables,
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

  // 💡 修正4: selectedStopId 変更時、集約表示なら同名バス停（全乗り場）の時刻表を一括取得して深層マージ
  // 依存配列は [selectedStopId] のみに固定し、連打・重さを完全に防止
  useEffect(() => {
    if (!selectedStopId) return;

    let cancelled = false;
    let isFirstLoad = true;

    const loadStopTimetable = async () => {
      try {
        const currentStops = dataStopsRef.current;
        const currentStop = currentStops[selectedStopId];
        const isGrouped = zoomRef.current < 16.5;

        // 集約時は同じ名前の全乗り場IDを取得、それ以外はタップしたIDのみ
        const targetStopIds =
          isGrouped && currentStop
            ? Object.keys(currentStops).filter(
                (id) => currentStops[id]?.name === currentStop.name,
              )
            : [selectedStopId];

        // 各ポールの時刻表を安全に一括取得
        const timetableResults = await Promise.all(
          targetStopIds.map((id) => fetchStopTimetable(id).catch(() => null)),
        );

        if (cancelled) return;

        const mergedDelays: Record<string, Record<string, number>> = {};
        const mergedCanceledTrips: Record<string, Record<string, boolean>> = {};
        const mergedSkippedTrips: Record<string, Record<string, boolean>> = {};
        const collectedAlerts: ServiceAlert[] = [];
        const mergedTimetables: TimetablesData = {};

        timetableResults.forEach((res) => {
          if (!res) return;

          if (res.delays) {
            const delays = res.delays;
            Object.keys(delays).forEach((rid) => {
              mergedDelays[rid] = {
                ...(mergedDelays[rid] || {}),
                ...delays[rid],
              };
            });
          }

          mergeRouteTripFlags(mergedCanceledTrips, res.canceled_trips);
          mergeRouteTripFlags(mergedSkippedTrips, res.skipped_trips);
          if (res.alerts?.length) {
            collectedAlerts.push(...res.alerts);
          }

          if (res.timetables) {
            const timetables = res.timetables;
            Object.keys(timetables).forEach((rid) => {
              mergedTimetables[rid] = {
                ...(mergedTimetables[rid] || {}),
                ...timetables[rid],
              };
            });
          }
        });

        setStopStatus({
          stopId: selectedStopId,
          canceledTrips: mergedCanceledTrips,
          skippedTrips: mergedSkippedTrips,
          alerts: dedupeServiceAlerts(collectedAlerts),
        });

        setStopDelays((prev) => {
          const updated = { ...prev };
          Object.keys(mergedDelays).forEach((rid) => {
            updated[rid] = { ...(updated[rid] || {}), ...mergedDelays[rid] };
          });
          return updated;
        });

        setData((prev) => {
          const updatedTimetables = { ...prev.timetables };
          Object.keys(mergedTimetables).forEach((rid) => {
            updatedTimetables[rid] = {
              ...(updatedTimetables[rid] || {}),
              ...mergedTimetables[rid],
            };
          });

          return {
            ...prev,
            delays: { ...prev.delays, ...mergedDelays },
            timetables: updatedTimetables,
          };
        });

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
      const requestId = ++boundsRequestIdRef.current;
      try {
        const stops = await fetchStopsByBounds(minLat, maxLat, minLng, maxLng);
        if (requestId !== boundsRequestIdRef.current) return;
        setData((prev) => {
          // 新しいバス停情報を設定
          const newStops = { ...stops };

          // 選択中のバス停は必ず保持（画面外でも消えないように）
          if (selectedStopId && prev.stops[selectedStopId]) {
            newStops[selectedStopId] = prev.stops[selectedStopId];
          }

          if (selectedTrip && tripDetail) {
            Object.assign(newStops, tripDetail.stops);
          }

          return { ...prev, stops: newStops };
        });
        setInitialStopsLoaded(true);
      } catch (e) {
        console.error("failed to fetch stops by bounds", e);
      }
    },
    [selectedStopId, selectedTrip, tripDetail],
  );

  // Azure起動直後などで周辺バス停の初回取得が失敗した場合も自動で再取得する
  useEffect(() => {
    if (!essentialLoaded || initialStopsLoaded) return;
    const timer = setInterval(() => {
      const map = mapRef.current;
      if (!map) return;
      try {
        const b = map.getBounds();
        if (b) {
          handleBoundsChange(
            b.getSouth(),
            b.getNorth(),
            b.getWest(),
            b.getEast(),
          );
        }
      } catch {
        // noop
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [essentialLoaded, initialStopsLoaded, handleBoundsChange]);

  // ==================== 検索でバス停を選択 ====================

  const handleSelectSearchStop = useCallback(
    async (stopName: string, lat: number, lng: number) => {
      const map = mapRef.current;
      if (!map) return;

      // 検索から選択した場合は常に集約表示（ズーム15）＋パネル余白を考慮して移動する
      map.flyTo({
        center: [lng, lat],
        zoom: 15,
        essential: true,
        padding: getPanelMapPadding(true),
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
              setData((prev) => ({
                ...prev,
                delays: timetableData.delays ?? {},
                timetables: { ...prev.timetables, ...timetableData.timetables },
              }));
              setStopStatus({
                stopId: firstStopId,
                canceledTrips: timetableData.canceled_trips ?? {},
                skippedTrips: timetableData.skipped_trips ?? {},
                alerts: dedupeServiceAlerts(timetableData.alerts ?? []),
              });
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
    setLiveTripTelemetry(null);
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
      headsign?: string,
      nextStopId?: string,
      nextStopName?: string,
    ) => {
      setSelectedTrip({
        tripId,
        routeId,
        highlightId,
        speedKmh,
        occupancyStatus,
        headsign,
        nextStopId,
        nextStopName,
      });
      setLiveTripTelemetry({
        tripId,
        speedKmh,
        occupancyStatus,
        headsign,
        nextStopId,
        nextStopName,
      });
      setSelectedStopId(null);
      setIsSearching(false);
    },
    [],
  );

  const handleClosePanel = useCallback(() => {
    setSelectedStopId(null);
    setSelectedTrip(null);
    setLiveTripTelemetry(null);
    setTripDetail(null);
    setStopStatus({
      stopId: null,
      canceledTrips: {},
      skippedTrips: {},
      alerts: [],
    });
    setIsPanelExpanded(false);
    setIsSearching(false);
  }, []);

  const handleSelectedBusTelemetry = useCallback(
    (
      tripId: string,
      speedKmh?: number,
      occupancyStatus?: string,
      headsign?: string,
      nextStopId?: string,
      nextStopName?: string,
    ) => {
      setLiveTripTelemetry((prev) => {
        if (
          prev &&
          prev.tripId === tripId &&
          prev.speedKmh === speedKmh &&
          prev.occupancyStatus === occupancyStatus &&
          prev.headsign === headsign &&
          prev.nextStopId === nextStopId &&
          prev.nextStopName === nextStopName
        ) {
          return prev;
        }
        return {
          tripId,
          speedKmh,
          occupancyStatus,
          headsign,
          nextStopId,
          nextStopName,
        };
      });
    },
    [],
  );

  const handleFlyToStop = useCallback((lng: number, lat: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({
      center: [lng, lat],
      zoom: 17,
      speed: 1.2,
      padding: getPanelMapPadding(true),
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

  // モーダル展開の初回描画前から地図上マーカーを隠し、開き途中の透過映り込みを防ぐ
  useLayoutEffect(() => {
    document.body.classList.toggle("modal-open", isAboutOpen || isAlertsOpen);
  }, [isAboutOpen, isAlertsOpen]);

  const refreshAlertsOverview = useCallback(async () => {
    setIsLoadingAlerts(true);
    try {
      const res = await fetchAlertsOverview();
      setAlertsOverview(res);
    } catch (e) {
      console.error("failed to fetch alerts overview", e);
    } finally {
      setIsLoadingAlerts(false);
    }
  }, []);

  const handleOpenAlertsModal = useCallback(() => {
    setIsAlertsOpen(true);
    void refreshAlertsOverview();
  }, [refreshAlertsOverview]);

  useEffect(() => {
    if (!essentialLoaded) return;
    let cancelled = false;

    const pollAlerts = async () => {
      try {
        const res = await fetchAlertsOverview();
        if (!cancelled) {
          setAlertsOverview(res);
        }
      } catch (e) {
        console.error("failed to fetch alerts overview", e);
      }
    };

    void pollAlerts();
    const timer = setInterval(pollAlerts, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [essentialLoaded]);

  const handleJumpToStopFromAlert = useCallback(
    (stopId: string, lat?: number, lng?: number) => {
      setIsAlertsOpen(false);
      const stopObj = allStops[stopId] ?? dataStopsRef.current[stopId];
      const targetLat = lat || stopObj?.lat;
      const targetLng = lng || stopObj?.lng;
      if (stopObj) {
        setData((prev) => ({
          ...prev,
          stops: { ...prev.stops, [stopId]: stopObj },
        }));
      }
      if (targetLat && targetLng && mapRef.current) {
        mapRef.current.flyTo({
          center: [targetLng, targetLat],
          zoom: 17,
          essential: true,
          padding: getPanelMapPadding(true),
        });
        setZoom(17);
      }
      setSelectedTrip(null);
      setLiveTripTelemetry(null);
      setTripDetail(null);
      setSelectedStopId(stopId);
      setIsSearching(false);
    },
    [allStops],
  );

  const handleJumpToTripFromAlert = useCallback(
    (routeId: string, tripId: string, lat?: number, lng?: number) => {
      setIsAlertsOpen(false);
      handleBusClick(tripId, routeId);
      if (lat && lng && mapRef.current) {
        mapRef.current.flyTo({
          center: [lng, lat],
          zoom: Math.max(zoomRef.current, 14.5),
          essential: true,
          padding: getPanelMapPadding(true),
        });
      }
    },
    [handleBusClick],
  );

  const effectiveAlerts = useMemo<ServiceAlert[]>(() => {
    const base = alertsOverview?.alerts ?? [];
    if (isDebugMode && debugMockOptions.alert) {
      return [...DEBUG_MOCK_ALERTS, ...base];
    }
    return base;
  }, [alertsOverview?.alerts, isDebugMode, debugMockOptions.alert]);

  const effectiveDisruptedTrips = useMemo<DisruptedTripNotice[]>(() => {
    const base = alertsOverview?.disrupted_trips ?? [];
    if (!isDebugMode) return base;
    const extras: DisruptedTripNotice[] = [];
    if (debugMockOptions.canceled) {
      extras.push({
        trip_id: "50_3_35002120",
        route_id: "10360",
        route_name: "X870",
        route_color: "A3D742",
        headsign: "【ダミー】国見ケ丘・中山台・実沢(営)",
        start_time: "13:45:00",
        first_stop_id: "50_56",
        first_stop_lat: 38.260292,
        first_stop_lng: 140.880814,
        canceled: true,
      });
    }
    if (debugMockOptions.skipped) {
      extras.push({
        trip_id: "50_3_35002220",
        route_id: "10320",
        route_name: "S880",
        route_color: "A3D742",
        headsign: "【ダミー】仙台駅",
        start_time: "13:05:00",
        canceled: false,
        skipped_stops: [
          { stop_id: "50_56", name: "仙台駅前" },
          { stop_id: "53_50", name: "あおば通駅" },
        ],
      });
    }
    return [...extras, ...base];
  }, [
    alertsOverview?.disrupted_trips,
    isDebugMode,
    debugMockOptions.canceled,
    debugMockOptions.skipped,
  ]);

  const totalNoticeCount =
    effectiveAlerts.length + effectiveDisruptedTrips.length;
  const hasSevereNotice =
    effectiveAlerts.some((a) => a.effect === "NO_SERVICE") ||
    effectiveDisruptedTrips.some((t) => t.canceled);

  useEffect(() => {
    const syncDebugState = () => {
      setIsDebugMode(isDebugEnabledFromSearch(window.location.search));
    };

    window.addEventListener("popstate", syncDebugState);
    window.addEventListener("hashchange", syncDebugState);
    return () => {
      window.removeEventListener("popstate", syncDebugState);
      window.removeEventListener("hashchange", syncDebugState);
    };
  }, []);

  // ==================== レンダリング ====================

  return (
    <>
      {isAppReady && (
        <>
          <SearchBox
            allStops={allStops}
            onSelectStop={handleSelectSearchStop}
            onSearchStateChange={setIsSearching}
            onFocus={handleClosePanel}
            isOpen={isSearching}
          />

          <div
            id="layer-control-container"
            className="absolute top-5 right-5 z-[9000] flex flex-col items-center gap-2 transition-[opacity,visibility] duration-250 max-md:top-[65px] max-md:right-2.5 max-md:[body.is-searching_&]:pointer-events-none max-md:[body.is-searching_&]:invisible max-md:[body.is-searching_&]:opacity-0"
          >
            <span className="inline-flex" title="運行情報・お知らせ">
              <Badge.Anchor>
                <Button
                  isIconOnly
                  variant="tertiary"
                  aria-label={
                    totalNoticeCount > 0
                      ? `運行情報・お知らせ（${totalNoticeCount}件）`
                      : "運行情報・お知らせ"
                  }
                  className="glass-surface rounded-full"
                  onPress={handleOpenAlertsModal}
                >
                  <span
                    className="material-icons-outlined text-[22px]"
                    aria-hidden
                  >
                    {totalNoticeCount > 0
                      ? "notifications_active"
                      : "notifications"}
                  </span>
                </Button>
                {totalNoticeCount > 0 && (
                  <Badge
                    color={hasSevereNotice ? "danger" : "warning"}
                    size="sm"
                    placement="top-right"
                  >
                    <Badge.Label className="tabular-nums">
                      {totalNoticeCount > 99 ? "99+" : totalNoticeCount}
                    </Badge.Label>
                  </Badge>
                )}
              </Badge.Anchor>
            </span>
            <LayerControl
              activeLayer={activeLayer}
              onLayerChange={setActiveLayer}
              hasMapTiler={hasMapTiler}
            />
            <ThemeToggleButton />
          </div>

          {isDebugMode && (
            <Surface
              id="debug-info-panel"
              variant="default"
              className="glass-surface absolute top-5 right-[72px] z-[9050] min-w-[168px] max-w-[min(300px,calc(100vw-100px))] rounded-2xl px-3 py-2 text-xs max-md:top-[65px] max-md:right-14 max-md:max-w-[calc(100vw-72px)] max-md:text-[11px]"
            >
              <Disclosure defaultExpanded={false}>
                <Disclosure.Heading>
                  <Disclosure.Trigger className="flex w-full items-center justify-between gap-2 text-left text-xs font-bold text-foreground">
                    <span className="truncate font-mono">
                      Debug · Z{zoom.toFixed(1)}
                      {enableSimTime
                        ? ` · ${formatSimTime(simSeconds).substring(0, 5)}`
                        : ""}
                    </span>
                    <Disclosure.Indicator />
                  </Disclosure.Trigger>
                </Disclosure.Heading>
                <Disclosure.Content>
                  <Disclosure.Body className="flex flex-col gap-2 px-0 pt-2 pb-0.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-muted">Zoom</span>
                      <span className="font-mono font-bold text-foreground">
                        {zoom.toFixed(2)}
                      </span>
                    </div>

                    <Separator />

                    {/* 💡 24時間時刻シミュレーター */}
                    <div className="flex flex-col gap-1.5">
                      <Checkbox
                        variant="secondary"
                        isSelected={enableSimTime}
                        onChange={setEnableSimTime}
                      >
                        <Checkbox.Content className="gap-2">
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                          <Label className="text-[11px] font-bold text-foreground">
                            時刻シミュレーション
                          </Label>
                        </Checkbox.Content>
                      </Checkbox>

                      {enableSimTime && (
                        <div className="flex items-center gap-2.5">
                          <span className="min-w-11 font-mono text-xs font-extrabold text-foreground">
                            {formatSimTime(simSeconds).substring(0, 5)}
                          </span>
                          <Slider
                            aria-label="シミュレーション時刻"
                            minValue={0}
                            maxValue={86340}
                            step={60}
                            value={simSeconds}
                            onChange={(val) =>
                              setSimSeconds(Array.isArray(val) ? val[0] : val)
                            }
                            className="flex-1"
                          >
                            <Slider.Track>
                              <Slider.Fill />
                              <Slider.Thumb />
                            </Slider.Track>
                          </Slider>
                        </div>
                      )}
                    </div>

                    <Separator />

                    {/* 💡 運休・通過・Alert ダミー表示 */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-bold text-muted">
                        ダミー表示テスト
                      </span>
                      <Checkbox
                        variant="secondary"
                        isSelected={debugMockOptions.alert}
                        onChange={(checked) =>
                          setDebugMockOptions((prev) => ({
                            ...prev,
                            alert: checked,
                          }))
                        }
                      >
                        <Checkbox.Content className="gap-2">
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                          <Label className="text-[11px] font-bold text-foreground">
                            運行情報 (Alert)
                          </Label>
                        </Checkbox.Content>
                      </Checkbox>
                      <Checkbox
                        variant="secondary"
                        isSelected={debugMockOptions.canceled}
                        onChange={(checked) =>
                          setDebugMockOptions((prev) => ({
                            ...prev,
                            canceled: checked,
                          }))
                        }
                      >
                        <Checkbox.Content className="gap-2">
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                          <Label className="text-[11px] font-bold text-foreground">
                            運休 (CANCELED)
                          </Label>
                        </Checkbox.Content>
                      </Checkbox>
                      <Checkbox
                        variant="secondary"
                        isSelected={debugMockOptions.skipped}
                        onChange={(checked) =>
                          setDebugMockOptions((prev) => ({
                            ...prev,
                            skipped: checked,
                          }))
                        }
                      >
                        <Checkbox.Content className="gap-2">
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                          <Label className="text-[11px] font-bold text-foreground">
                            通過 (SKIPPED)
                          </Label>
                        </Checkbox.Content>
                      </Checkbox>
                    </div>
                  </Disclosure.Body>
                </Disclosure.Content>
              </Disclosure>
            </Surface>
          )}
        </>
      )}

      <BusPanel
        data={data}
        selectedStopId={selectedStopId}
        selectedTrip={selectedTrip}
        liveTripTelemetry={liveTripTelemetry}
        tripDetail={tripDetail}
        isDebugMode={isDebugMode}
        debugMockOptions={isDebugMode ? debugMockOptions : undefined}
        stopDelays={stopDelays}
        stopCanceledTrips={
          stopStatus.stopId === selectedStopId ? stopStatus.canceledTrips : {}
        }
        stopSkippedTrips={
          stopStatus.stopId === selectedStopId ? stopStatus.skippedTrips : {}
        }
        stopAlerts={
          stopStatus.stopId === selectedStopId ? stopStatus.alerts : []
        }
        zoom={zoom}
        timetableReadyForStop={timetableReadyForStop}
        isExpanded={isPanelExpanded}
        onToggleExpand={() => setIsPanelExpanded((prev) => !prev)}
        onClose={handleClosePanel}
        onSelectBus={handleBusClick}
        onFlyToStop={handleFlyToStop}
      />

      {isAppReady && (
        <Button
          variant="tertiary"
          size="sm"
          onPress={() => setIsAboutOpen(true)}
          aria-label="アプリについてとソースコード"
          className={`glass-surface absolute bottom-2 left-2 z-[6500] h-6.5 gap-1.5 px-2.5 text-[11px] max-md:bottom-1.5 max-md:left-1.5 max-md:h-6 max-md:px-2 ${
            isPanelOpen
              ? "max-md:pointer-events-none max-md:invisible max-md:opacity-0"
              : ""
          }`}
        >
          <svg
            className="size-3.5 shrink-0"
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
          <span>GitHub / 概要</span>
        </Button>
      )}

      {/* 💡 ページ内ウィンドウ */}
      <AboutModal isOpen={isAboutOpen} onClose={() => setIsAboutOpen(false)} />
      <ServiceAlertsModal
        isOpen={isAlertsOpen}
        onClose={() => setIsAlertsOpen(false)}
        alerts={effectiveAlerts}
        disruptedTrips={effectiveDisruptedTrips}
        isLoading={isLoadingAlerts}
        lastFetchedAt={alertsOverview?.fetched_at}
        realtimeError={alertsOverview?.realtime_error}
        onRefresh={refreshAlertsOverview}
        onSelectStop={handleJumpToStopFromAlert}
        onSelectTrip={handleJumpToTripFromAlert}
      />

      <MapContainer
        data={data}
        activeLayer={activeLayer}
        isAppReady={isAppReady}
        essentialReady={essentialLoaded}
        isPanelOpen={isPanelOpen}
        selectedTrip={selectedTrip}
        tripDetail={tripDetail}
        simTime={activeSimTimeString}
        onStopClick={handleStopClick}
        onBusClick={handleBusClick}
        onMapClick={handleClosePanel}
        onMoveStart={() => setIsSearching(false)}
        onZoomChange={setZoom}
        setMapRef={(map) => (mapRef.current = map)}
        onMapLoaded={() => setMapLoaded(true)}
        onInitialBusesLoaded={() => setInitialBusesLoaded(true)}
        onSelectedBusTelemetry={handleSelectedBusTelemetry}
        onBoundsChange={handleBoundsChange}
      />

      <StartupOverlay
        isVisible={!isAppReady}
        progress={bootProgress}
        statusText={bootStatusText}
        serverConnected={serverConnected}
        isServerWaking={isServerWaking}
        tasks={startupTasks}
      />
    </>
  );
}

export default App;
