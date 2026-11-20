import React, {
  useEffect,
  useState,
  useMemo,
  useLayoutEffect,
  useRef,
} from "react";
// use Material Icons font for simple UI icons
import {
  Card,
  Chip,
  CloseButton,
  Disclosure,
  EmptyState,
  ScrollShadow,
  Spinner,
  Surface,
} from "@heroui/react";
import type {
  AppData,
  LiveTripTelemetry,
  PanelTrip,
  Arrival,
  TripDetailResponse,
} from "../types";
import {
  formatHeadsign,
  isServiceRunningToday,
  addDelayToTime,
  timeToSec,
} from "../utils";
import { fetchBusPositions } from "../dataLoader";
import { Timeline, TimelineItem } from "./Timeline";

/** パネル内のデータ取得中に表示する共通スピナー */
const PanelLoadingState: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex flex-col items-center justify-center gap-2.5 py-10 text-sm font-medium text-muted">
    <Spinner size="md" />
    <span>{label}</span>
  </div>
);

/** パネル内の空状態・データなし時に表示する共通 EmptyState */
const PanelEmptyState: React.FC<{ title: string }> = ({ title }) => (
  <EmptyState className="py-10 text-center">{title}</EmptyState>
);

/** 系統番号を公式カラー付き HeroUI Chip で表示する共通バッジ */
const RouteBadgeChip: React.FC<{
  label: string;
  color: string;
  size?: "header" | "row";
}> = ({ label, color, size = "row" }) => (
  <Chip
    size={size === "header" ? "md" : "sm"}
    className={`shrink-0 font-extrabold tracking-[0.02em] ${
      size === "header" ? "text-sm" : "text-[13px]"
    }`}
    style={{ backgroundColor: color, color: "#1b4406" }}
  >
    <Chip.Label>{label}</Chip.Label>
  </Chip>
);

/** 遅延時でも予測時刻を縦中央に揃える時刻表示 */
const PanelTimeDisplay: React.FC<{
  scheduledTime: string;
  estimatedTime: string | null;
  isPast: boolean;
}> = ({ scheduledTime, estimatedTime, isPast }) => {
  const timeText = scheduledTime ? scheduledTime.substring(0, 5) : "--:--";
  if (estimatedTime) {
    return (
      <div className="relative flex min-h-10 w-full items-center justify-center [font-feature-settings:'tnum']">
        <del className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[180%] text-[11px] leading-none font-normal whitespace-nowrap text-muted line-through decoration-2">
          {timeText}
        </del>
        <span className="text-[16px] leading-none font-bold tracking-[-0.03em] whitespace-nowrap text-foreground">
          {estimatedTime}
        </span>
      </div>
    );
  }
  return (
    <div className="flex min-h-10 w-full items-center justify-center [font-feature-settings:'tnum']">
      <span
        className={`text-[16px] leading-none font-bold tracking-[-0.03em] whitespace-nowrap ${
          !scheduledTime || isPast ? "text-muted" : "text-foreground"
        }`}
      >
        {timeText}
      </span>
    </div>
  );
};

interface BusPanelProps {
  data: AppData;
  selectedStopId: string | null;
  selectedTrip: PanelTrip | null;
  liveTripTelemetry?: LiveTripTelemetry | null;
  tripDetail: TripDetailResponse | null;
  isDebugMode: boolean;
  stopDelays: Record<string, Record<string, number>>;
  zoom: number;
  timetableReadyForStop?: string | null;
  onClose: () => void;
  onSelectBus: (
    tripId: string,
    routeId: string,
    highlightId?: string,
    speedKmh?: number,
    occupancyStatus?: string,
  ) => void;
  onFlyToStop: (lng: number, lat: number) => void;
}

type OccupancyChipColor =
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "default";

function getOccupancyDisplay(status?: string): {
  icon: "group" | "group_off";
  label: string;
  iconColorClass: string;
  chipColor: OccupancyChipColor;
} {
  switch (status) {
    case "EMPTY":
      return {
        icon: "group",
        label: "空いています",
        iconColorClass: "text-accent",
        chipColor: "accent",
      };
    case "MANY_SEATS_AVAILABLE":
      return {
        icon: "group",
        label: "座席に余裕があります",
        iconColorClass: "text-success",
        chipColor: "success",
      };
    case "STANDING_ROOM_ONLY":
      return {
        icon: "group",
        label: "混雑しています",
        iconColorClass: "text-warning",
        chipColor: "warning",
      };
    case "FULL":
      return {
        icon: "group",
        label: "非常に混雑しています",
        iconColorClass: "text-danger",
        chipColor: "danger",
      };
    case "NO_DATA_AVAILABLE":
    default:
      return {
        icon: "group_off",
        label: "混雑情報なし",
        iconColorClass: "text-muted",
        chipColor: "default",
      };
  }
}

const formatTodayYmd = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
};

const BusPanel: React.FC<BusPanelProps> = ({
  data,
  selectedStopId,
  selectedTrip,
  liveTripTelemetry,
  tripDetail,
  isDebugMode,
  stopDelays,
  zoom,
  timetableReadyForStop,
  onClose,
  onSelectBus,
  onFlyToStop,
}) => {
  const [currentTime, setCurrentTime] = useState("");
  const [tripOccupancyMap, setTripOccupancyMap] = useState<
    Record<string, string>
  >({});
  const contentRef = useRef<HTMLDivElement>(null);

  const currentSelectionKey = selectedTrip
    ? `trip-${selectedTrip.tripId}`
    : `stop-${selectedStopId}`;
  const [initialZoom, setInitialZoom] = useState(zoom);
  const initialZoomSelectionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedStopId && !selectedTrip) {
      initialZoomSelectionRef.current = null;
      return;
    }
    if (initialZoomSelectionRef.current !== currentSelectionKey) {
      initialZoomSelectionRef.current = currentSelectionKey;
      setInitialZoom(zoom);
    }
  }, [currentSelectionKey, selectedStopId, selectedTrip, zoom]);

  // 時刻更新用タイマー
  useEffect(() => {
    const updateTime = () => {
      setCurrentTime(new Date().toTimeString().split(" ")[0]);
    };
    updateTime();
    const interval = setInterval(updateTime, 2000);
    return () => clearInterval(interval);
  }, []);

  // バス停時刻表モード時に occupancy_status を取得して trip_id で引けるようにする
  useEffect(() => {
    if (!selectedStopId || selectedTrip) {
      return;
    }

    let cancelled = false;

    const loadOccupancy = async () => {
      try {
        const buses = await fetchBusPositions();
        if (cancelled) return;
        const m: Record<string, string> = {};
        buses.forEach((b) => {
          if (b.trip_id) {
            m[b.trip_id] = b.occupancy_status || "NO_DATA_AVAILABLE";
          }
        });
        setTripOccupancyMap(m);
      } catch {
        if (!cancelled) {
          setTripOccupancyMap({});
        }
      }
    };

    loadOccupancy();
    const interval = setInterval(loadOccupancy, 10000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedStopId, selectedTrip]);

  const liveSpeedKmh =
    selectedTrip && liveTripTelemetry?.tripId === selectedTrip.tripId
      ? (liveTripTelemetry.speedKmh ?? selectedTrip.speedKmh)
      : selectedTrip?.speedKmh;
  const liveOccupancyStatus =
    selectedTrip && liveTripTelemetry?.tripId === selectedTrip.tripId
      ? (liveTripTelemetry.occupancyStatus ?? selectedTrip.occupancyStatus)
      : selectedTrip?.occupancyStatus;
  const liveHeadsign =
    selectedTrip && liveTripTelemetry?.tripId === selectedTrip.tripId
      ? (liveTripTelemetry.headsign || selectedTrip.headsign || "")
      : (selectedTrip?.headsign ?? "");
  const liveNextStopId =
    selectedTrip && liveTripTelemetry?.tripId === selectedTrip.tripId
      ? (liveTripTelemetry.nextStopId ?? selectedTrip.nextStopId)
      : selectedTrip?.nextStopId;
  const liveNextStopName =
    (selectedTrip && liveTripTelemetry?.tripId === selectedTrip.tripId
      ? (liveTripTelemetry.nextStopName ?? selectedTrip.nextStopName)
      : selectedTrip?.nextStopName) ||
    (liveNextStopId ? data.stops[liveNextStopId]?.name : undefined);

  const debugSummaryJson = useMemo(() => {
    if (!isDebugMode) return "";
    const todayYmd = formatTodayYmd();

    if (selectedTrip) {
      const serviceId = tripDetail?.trip.service_id ?? null;
      const officeId = tripDetail?.trip.office_id ?? null;
      return JSON.stringify(
        {
          route_id: selectedTrip.routeId,
          trip_id: selectedTrip.tripId,
          highlight_id: selectedTrip.highlightId,
          headsign: liveHeadsign || null,
          next_stop_id: liveNextStopId ?? null,
          next_stop_name: liveNextStopName ?? null,
          speed_kmh: liveSpeedKmh ?? null,
          occupancy_status: liveOccupancyStatus ?? null,
          trip_delay: tripDetail?.trip_delay ?? 0,
          stops_count: tripDetail?.trip?.stops?.length ?? 0,
          service_id: serviceId,
          office_name: officeId ? (data.extra.offices[officeId] ?? null) : null,
          today_ymd: todayYmd,
          calendar: serviceId ? (data.calendar[serviceId] ?? null) : null,
        },
        null,
        2,
      );
    }

    if (selectedStopId) {
      const stop = data.stops[selectedStopId] || null;
      const relatedDelaysCount = Object.values(stopDelays ?? {}).reduce(
        (acc, routeDelays) => acc + Object.keys(routeDelays).length,
        0,
      );
      return JSON.stringify(
        {
          selected_stop_id: selectedStopId,
          zoom: zoom.toFixed(2),
          timetable_ready: timetableReadyForStop === selectedStopId,
          related_delays_count: relatedDelaysCount,
          stop,
          today_ymd: todayYmd,
        },
        null,
        2,
      );
    }

    return "";
  }, [
    isDebugMode,
    selectedTrip,
    selectedStopId,
    liveHeadsign,
    liveNextStopId,
    liveNextStopName,
    liveSpeedKmh,
    liveOccupancyStatus,
    tripDetail,
    data.extra.offices,
    data.calendar,
    data.stops,
    stopDelays,
    zoom,
    timetableReadyForStop,
  ]);

  const panelData = useMemo(() => {
    let title: React.ReactNode = "";
    let via = "";
    let office = "";
    let speedText = "";
    let items: React.ReactNode[] = [];
    let occupancyInfo: {
      icon: "group" | "group_off";
      label: string;
      iconColorClass: string;
      chipColor: OccupancyChipColor;
    } | null = null;
    let initialTargetId: string | null = null;
    const nowSec = timeToSec(currentTime);

    if (selectedTrip && tripDetail) {
      // 便詳細表示モード
      const trip = tripDetail.trip;
      const routeName = tripDetail.route_name;
      // 💡 tripDetail の正式なカラーを最優先で使用
      const routeColor = tripDetail.route_color
        ? `#${tripDetail.route_color.replace(/^#/, "")}`
        : data.routes[tripDetail.route_id]?.color
          ? `#${data.routes[tripDetail.route_id].color.replace(/^#/, "")}`
          : "#a3d742";
      via = trip.via ? `${trip.via} 経由` : "";
      const resolvedHeadsign = trip.headsign || liveHeadsign;
      title = (
        <div className="flex w-full flex-nowrap items-center gap-2">
          <RouteBadgeChip label={routeName} color={routeColor} size="header" />
          <span
            className={`leading-snug whitespace-normal [word-break:auto-phrase] ${
              resolvedHeadsign ? "text-foreground" : "text-muted"
            }`}
          >
            {resolvedHeadsign
              ? formatHeadsign(resolvedHeadsign)
              : "行先情報なし"}
          </span>
        </div>
      );
      office = tripDetail.office_name || "";
      if (typeof liveSpeedKmh === "number") {
        speedText = `${Math.floor(liveSpeedKmh)} km/h`;
      }
      occupancyInfo = getOccupancyDisplay(liveOccupancyStatus);

      const isRealtimeOnlyTrip = selectedTrip.tripId.startsWith("rt_");
      const nextStopIndex =
        isRealtimeOnlyTrip && liveNextStopId
          ? trip.stops.findIndex((st) => st.stop_id === liveNextStopId)
          : -1;

      // 遅延を加味した nextStopId の特定
      let nextStopId = selectedTrip.highlightId;
      if (!selectedTrip.highlightId) {
        if (isRealtimeOnlyTrip) {
          nextStopId =
            (nextStopIndex >= 0 ? liveNextStopId : undefined) ??
            trip.stops[0]?.stop_id ??
            null;
        } else {
          const next = trip.stops.find((st) => {
            const d = tripDetail.delays?.[st.stop_id] ?? 0;
            const estimatedSec = timeToSec(st.time) + d;
            return estimatedSec >= nowSec;
          });
          if (next) nextStopId = next.stop_id;
        }
      }
      initialTargetId = nextStopId ? `stop-${nextStopId}` : null;

      const stopItems = trip.stops.map((st, index) => {
        const s = tripDetail.stops[st.stop_id];

        // サーバーから渡された本当の遅延秒数を取得
        const delay = isRealtimeOnlyTrip
          ? 0
          : (tripDetail.delays?.[st.stop_id] ?? 0);
        const estimatedSec = st.time ? timeToSec(st.time) + delay : 0;
        const isPast = isRealtimeOnlyTrip
          ? nextStopIndex >= 0
            ? index < nextStopIndex
            : false
          : estimatedSec < nowSec;
        const hasDelay = !isRealtimeOnlyTrip && !isPast && delay >= 60; // 1分以上なら遅延扱い
        const estimatedTime =
          hasDelay && st.time ? addDelayToTime(st.time, delay) : null;

        const isHighlight = st.stop_id === selectedTrip.highlightId;

        return (
          <TimelineItem
            key={index}
            id={`stop-${st.stop_id}`}
            isPast={isPast}
            isHighlighted={isHighlight}
            isFirst={index === 0}
            isLast={index === trip.stops.length - 1}
            leading={
              <PanelTimeDisplay
                scheduledTime={st.time}
                estimatedTime={estimatedTime}
                isPast={isPast}
              />
            }
          >
            {s ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onFlyToStop(s.lng, s.lat);
                }}
                className={`w-fit cursor-pointer bg-transparent p-0 text-left text-[15px] leading-snug font-bold underline decoration-muted/45 decoration-[1.5px] underline-offset-4 transition-colors hover:text-accent hover:decoration-accent focus-visible:outline-2 focus-visible:outline-focus active:opacity-75 ${
                  isPast ? "text-muted" : "text-foreground"
                }`}
              >
                {s.name}
              </button>
            ) : (
              <div
                className={`text-[15px] leading-snug font-bold ${
                  isPast ? "text-muted" : "text-foreground"
                }`}
              >
                ...
              </div>
            )}
            {s?.platform && (
              <div className="mt-0.5 text-[11px] font-medium text-muted">
                {s.platform}番のりば
              </div>
            )}
            {isDebugMode && (
              <div className="mt-1 font-mono text-[10px] leading-snug text-muted">
                #{st.stop_id} · delay {delay}s · {isPast ? "past" : "upcoming"}
              </div>
            )}
          </TimelineItem>
        );
      });

      items = [
        <Timeline key="trip-timeline" color={routeColor}>
          {stopItems}
        </Timeline>,
      ];
    } else if (selectedTrip && selectedTrip.tripId.startsWith("rt_")) {
      const routeObj = data.routes[selectedTrip.routeId];
      const routeName = routeObj?.short_name || selectedTrip.routeId;
      const routeColor = routeObj?.color
        ? `#${routeObj.color.replace(/^#/, "")}`
        : "#a3d742";
      const nextStopObj = liveNextStopId
        ? data.stops[liveNextStopId]
        : undefined;
      const headsignLabel = liveHeadsign
        ? formatHeadsign(liveHeadsign)
        : "行先情報なし";
      title = (
        <div className="flex w-full flex-nowrap items-center gap-2">
          <RouteBadgeChip label={routeName} color={routeColor} size="header" />
          <span
            className={`leading-snug whitespace-normal [word-break:auto-phrase] ${
              liveHeadsign ? "text-foreground" : "text-muted"
            }`}
          >
            {headsignLabel}
          </span>
        </div>
      );
      if (typeof liveSpeedKmh === "number") {
        speedText = `${Math.floor(liveSpeedKmh)} km/h`;
      }
      occupancyInfo = getOccupancyDisplay(liveOccupancyStatus);
      items = [
        <div key="rt-body" className="flex flex-col gap-2 px-3 py-2.5">
          {liveNextStopName && (
            <Card
              variant="default"
              className="gap-1 rounded-2xl bg-surface/65 px-3.5 py-2.5 shadow-surface"
            >
              <span className="text-[11px] font-semibold text-muted">
                次のバス停
              </span>
              {nextStopObj ? (
                <button
                  type="button"
                  onClick={() => onFlyToStop(nextStopObj.lng, nextStopObj.lat)}
                  className="w-fit cursor-pointer bg-transparent p-0 text-left text-[15px] leading-snug font-bold text-foreground underline decoration-muted/45 decoration-[1.5px] underline-offset-4 transition-colors hover:text-accent hover:decoration-accent focus-visible:outline-2 focus-visible:outline-focus active:opacity-75"
                >
                  {liveNextStopName}
                </button>
              ) : (
                <span className="text-[15px] leading-snug font-bold text-foreground">
                  {liveNextStopName}
                </span>
              )}
            </Card>
          )}
          <PanelEmptyState title="このバスの経路や時刻表の情報がありません。" />
        </div>,
      ];
    } else if (selectedTrip && !tripDetail) {
      items = [<PanelLoadingState key="loading" label="読み込み中..." />];
    } else if (selectedStopId) {
      // バス停時刻表モード
      const stop = data.stops[selectedStopId];
      if (stop) {
        const isGrouped = initialZoom < 16.5;
        const targetIds = isGrouped
          ? Object.keys(data.stops).filter(
              (id) => data.stops[id].name === stop.name,
            )
          : [selectedStopId];

        via = "";
        title =
          stop.name +
          (!isGrouped && stop.platform ? ` (${stop.platform}番のりば)` : "");
        office = "時刻表";

        if (timetableReadyForStop !== selectedStopId) {
          items = [
            <PanelLoadingState key="loading" label="時刻表を読み込み中..." />,
          ];
        } else {
          const allArrivals: Arrival[] = [];
          Object.keys(data.timetables).forEach((rid) => {
            Object.keys(data.timetables[rid]).forEach((tid) => {
              const trip = data.timetables[rid][tid];
              if (
                !isServiceRunningToday(trip.service_id, data.calendar, data.extra)
              )
                return;
              const st = trip.stops.find((s) => targetIds.includes(s.stop_id));
              if (st) {
                const pole = data.stops[st.stop_id];
                // サーバーから渡された本物の遅延データを取得
                const delay =
                  data.delays?.[rid]?.[tid] ?? stopDelays?.[rid]?.[tid] ?? 0;
                const estimatedSec = timeToSec(st.time) + delay;

                allArrivals.push({
                  time: st.time,
                  route_id: rid,
                  trip_id: tid,
                  headsign: trip.headsign,
                  via: trip.via,
                  platform: pole?.platform || "",
                  actual_stop_id: st.stop_id,
                  is_past: estimatedSec < nowSec,
                  delay_seconds: delay,
                  occupancy_status: tripOccupancyMap[tid] ?? "NO_DATA_AVAILABLE",
                });
              }
            });
          });

          if (allArrivals.length === 0) {
            items = [
              <PanelEmptyState key="empty" title="本日の運行はありません" />,
            ];
          } else {
            allArrivals.sort((a, b) => {
              // 遅延を含めた到着予定時間でソートする
              const aSec = timeToSec(a.time) + (a.delay_seconds || 0);
              const bSec = timeToSec(b.time) + (b.delay_seconds || 0);
              return aSec - bSec;
            });

            let firstFutureFound = false;
            const timetableItems = allArrivals.map((bus, idx) => {
              const delay = bus.delay_seconds ?? 0;
              const hasDelay = !bus.is_past && delay >= 60;
              const estimatedTime = hasDelay
                ? addDelayToTime(bus.time, delay)
                : null;
              const occupancy = getOccupancyDisplay(bus.occupancy_status);
              const routeObj = data.routes[bus.route_id];
              const routeNum = routeObj?.short_name || bus.route_id;
              const badgeColor = routeObj?.color
                ? `#${routeObj.color.replace(/^#/, "")}`
                : "#a3d742";
              const headsignText = formatHeadsign(bus.headsign);

              if (!bus.is_past && !firstFutureFound) {
                firstFutureFound = true;
                initialTargetId = `arrival-${idx}`;
              }

              return (
                <Card<"button">
                  key={idx}
                  variant="default"
                  data-arrival-id={`arrival-${idx}`}
                  render={(domProps) => <button type="button" {...domProps} />}
                  onClick={() =>
                    onSelectBus(
                      bus.trip_id,
                      bus.route_id,
                      bus.actual_stop_id,
                      undefined,
                      bus.occupancy_status,
                    )
                  }
                  className={`w-full cursor-pointer flex-row items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-[transform,background-color] duration-150 outline-none select-none focus-visible:status-focused active:scale-[0.98] ${
                    bus.is_past
                      ? "bg-surface/40 hover:bg-surface/65"
                      : "bg-surface/65 hover:bg-surface/85"
                  }`}
                >
                  <div className="w-14 shrink-0">
                    <PanelTimeDisplay
                      scheduledTime={bus.time}
                      estimatedTime={estimatedTime}
                      isPast={bus.is_past}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    {bus.via && (
                      <div className="mb-0.5 text-xs text-muted">
                        {bus.via} 経由
                      </div>
                    )}
                    <div className="flex min-w-0 items-center gap-1.5">
                      <RouteBadgeChip
                        label={routeNum}
                        color={badgeColor}
                        size="row"
                      />
                      <span
                        className={`text-[15px] leading-snug font-bold whitespace-normal [word-break:auto-phrase] ${
                          bus.is_past ? "text-muted" : "text-foreground"
                        }`}
                      >
                        {headsignText}
                      </span>
                    </div>
                    {bus.platform && (
                      <div className="mt-0.5 text-[11px] font-medium text-muted">
                        {bus.platform}番のりば
                      </div>
                    )}
                    {isDebugMode && (
                      <div className="mt-1 font-mono text-[10px] leading-snug text-muted">
                        {bus.route_id} / {bus.trip_id} · delay{" "}
                        {bus.delay_seconds ?? 0}s
                      </div>
                    )}
                  </div>
                  <span
                    className={`material-icons-outlined shrink-0 text-[18px] leading-none ${occupancy.iconColorClass}`}
                    title={occupancy.label}
                    aria-label={occupancy.label}
                  >
                    {occupancy.icon}
                  </span>
                </Card>
              );
            });

            items = [
              <div
                key="stop-timetable"
                aria-label="発車予定時刻表"
                className="flex flex-col gap-2 px-3 py-2.5"
              >
                {timetableItems}
              </div>,
            ];
          }
        }
      }
    }

    return {
      items,
      title,
      via,
      office,
      speedText,
      initialTargetId,
      occupancyInfo,
    };
  }, [
    data,
    selectedStopId,
    selectedTrip,
    liveHeadsign,
    liveNextStopId,
    liveNextStopName,
    liveSpeedKmh,
    liveOccupancyStatus,
    tripDetail,
    isDebugMode,
    stopDelays,
    tripOccupancyMap,
    currentTime,
    initialZoom,
    timetableReadyForStop,
    onSelectBus,
    onFlyToStop,
  ]);

  const lastSelectedKeyRef = useRef<string | null>(null);

  // パネルが閉じられたとき（両方 null）にスクロール追跡をリセット
  // これにより、同じバス停・バスを再タップしたときにも次のバスへスクロールが動作する
  useEffect(() => {
    if (!selectedStopId && !selectedTrip) {
      lastSelectedKeyRef.current = null;
    }
  }, [selectedStopId, selectedTrip]);

  useLayoutEffect(() => {
    if (
      currentSelectionKey !== lastSelectedKeyRef.current &&
      contentRef.current &&
      panelData.initialTargetId
    ) {
      // バス停モードの場合、そのバス停の時刻表がサーバーから取得されるまで待機
      // （キャッシュデータで誤スクロールしてしまう問題の回避）
      if (selectedStopId && timetableReadyForStop !== selectedStopId) return;

      const el =
        document.getElementById(panelData.initialTargetId) ??
        contentRef.current.querySelector<HTMLElement>(
          `[data-arrival-id="${panelData.initialTargetId}"]`,
        );
      if (el) {
        const parent = contentRef.current;
        if (parent.clientHeight === 0) return;

        const parentRect = parent.getBoundingClientRect();
        const scaleY = parentRect.height / parent.clientHeight || 1;
        const rowRect = el.getBoundingClientRect();
        const currentRowHeight = rowRect.height / scaleY || 44;
        const prev = el.previousElementSibling as HTMLElement | null;
        const prevRowHeight =
          prev?.hasAttribute("data-timeline-item") ||
          prev?.hasAttribute("data-arrival-id")
            ? prev.getBoundingClientRect().height / scaleY
            : currentRowHeight;

        // ヘッダー直下で「1つ前の行」が見える位置に固定する。
        // 比率ではなく行高ベースにすることで、端末差によるズレを抑える。
        const topMargin = 10;
        const desiredTop = prevRowHeight + topMargin;

        // offsetTop は環境によって基準親がずれて計算誤差が出ることがあるため、
        // panel-content の見えている領域基準で相対位置を算出する。
        const relativeTop =
          parent.scrollTop + (rowRect.top - parentRect.top) / scaleY;

        const nextScrollTop = relativeTop - desiredTop;
        const maxScrollTop = Math.max(
          0,
          parent.scrollHeight - parent.clientHeight,
        );
        const clamped = Math.max(0, Math.min(nextScrollTop, maxScrollTop));

        // 描画前（useLayoutEffect内）で即座にスクロールし、白画面や上端からのジャンプを防ぐ
        parent.scrollTop = clamped;
        lastSelectedKeyRef.current = currentSelectionKey;
      }
    }
  }, [
    currentSelectionKey,
    panelData.initialTargetId,
    selectedTrip,
    timetableReadyForStop,
    selectedStopId,
  ]);

  const isOpen = !!(selectedStopId || selectedTrip);

  return (
    <Surface
      id="bottom-panel"
      variant="default"
      className={`glass-surface-lg absolute z-[6000] flex h-[60%] max-h-[80%] flex-col overflow-hidden rounded-3xl transition-[opacity,transform] duration-350 ease-[cubic-bezier(0.19,1,0.22,1)] md:top-20 md:bottom-auto md:left-5 md:z-[8000] md:max-h-[calc(100%-120px)] md:w-[calc(100%-40px)] md:max-w-[400px] max-md:bottom-5 max-md:left-2.5 max-md:w-[calc(100%-20px)] ${
        isOpen
          ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
          : "pointer-events-none translate-y-6 scale-96 opacity-0"
      }`}
    >
      <CloseButton
        aria-label="閉じる"
        onPress={onClose}
        className="absolute top-3 right-3 z-20"
      />
      <div className="relative border-b border-separator px-6 pt-5 pb-3.5">
        {panelData.via && (
          <div className="mb-1 pr-8 text-[11px] font-medium tracking-[0.02em] text-muted uppercase">
            {panelData.via}
          </div>
        )}
        <div className="flex items-baseline justify-between gap-2.5 pr-8">
          <div className="text-xl leading-tight font-extrabold tracking-[-0.02em] whitespace-normal text-foreground [word-break:auto-phrase]">
            {panelData.title}
          </div>
        </div>
        {panelData.office && (
          <div className="mt-1 text-xs font-semibold text-muted">
            {panelData.office}
          </div>
        )}
        {selectedTrip && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {panelData.occupancyInfo && (
              <Chip variant="soft" color={panelData.occupancyInfo.chipColor}>
                <span className="material-icons-outlined text-[14px]" aria-hidden>
                  {panelData.occupancyInfo.icon}
                </span>
                <Chip.Label>{panelData.occupancyInfo.label}</Chip.Label>
              </Chip>
            )}
            {panelData.speedText && (
              <Chip variant="soft" color="default">
                <span className="material-icons-outlined text-[14px]" aria-hidden>
                  speed
                </span>
                <Chip.Label className="tabular-nums">
                  {panelData.speedText}
                </Chip.Label>
              </Chip>
            )}
          </div>
        )}
        {isDebugMode && (selectedTrip || selectedStopId) && (
          <Disclosure defaultExpanded={false} className="mt-2">
            <Disclosure.Heading>
              <Disclosure.Trigger className="flex w-full items-center justify-between gap-2 text-left text-[11px] font-semibold text-muted">
                <span className="truncate font-mono">
                  Debug ·{" "}
                  {selectedTrip ? selectedTrip.tripId : selectedStopId}
                </span>
                <Disclosure.Indicator />
              </Disclosure.Trigger>
            </Disclosure.Heading>
            <Disclosure.Content>
              <Disclosure.Body className="px-0 pt-2 pb-0">
                <pre className="max-h-44 overflow-auto rounded-xl bg-surface-secondary/75 p-2 font-mono text-[11px] leading-snug break-words whitespace-pre-wrap text-foreground">
                  {debugSummaryJson || "(no data)"}
                </pre>
              </Disclosure.Body>
            </Disclosure.Content>
          </Disclosure>
        )}
      </div>
      <ScrollShadow
        ref={contentRef}
        size={28}
        className="panel-content min-h-0 flex-1 overflow-y-auto"
      >
        {panelData.items}
      </ScrollShadow>
    </Surface>
  );
};

export default BusPanel;
