import React, {
  useEffect,
  useState,
  useMemo,
  useLayoutEffect,
  useRef,
} from "react";
// use Material Icons font for simple UI icons
import type { AppData, PanelTrip, Arrival, TripDetailResponse } from "../types";
import {
  formatHeadsign,
  isServiceRunningToday,
  addDelayToTime,
  timeToSec,
} from "../utils";
import { fetchBusPositions } from "../dataLoader";

interface BusPanelProps {
  data: AppData;
  selectedStopId: string | null;
  selectedTrip: PanelTrip | null;
  tripDetail: TripDetailResponse | null;
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

function getOccupancyDisplay(status?: string): {
  icon: "group" | "group_off";
  label: string;
  toneClass: string;
} {
  switch (status) {
    case "EMPTY":
      return { icon: "group", label: "空いています", toneClass: "occ-empty" };
    case "MANY_SEATS_AVAILABLE":
      return {
        icon: "group",
        label: "座席に余裕があります",
        toneClass: "occ-many-seats",
      };
    case "STANDING_ROOM_ONLY":
      return {
        icon: "group",
        label: "混雑しています",
        toneClass: "occ-standing-only",
      };
    case "FULL":
      return {
        icon: "group",
        label: "非常に混雑しています",
        toneClass: "occ-full",
      };
    case "NO_DATA_AVAILABLE":
    default:
      return {
        icon: "group_off",
        label: "混雑情報なし",
        toneClass: "occ-no-data",
      };
  }
}

const BusPanel: React.FC<BusPanelProps> = ({
  data,
  selectedStopId,
  selectedTrip,
  tripDetail,
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

  const currentSelectionKey = selectedTrip
    ? `trip-${selectedTrip.tripId}`
    : `stop-${selectedStopId}`;

  const panelData = useMemo(() => {
    let title = "";
    let via = "";
    let office = "";
    let speedText = "";
    let items: React.ReactNode[] = [];
    let occupancyInfo: {
      icon: "group" | "group_off";
      label: string;
      toneClass: string;
    } | null = null;
    let initialTargetId: string | null = null;
    const nowSec = timeToSec(currentTime);

    if (selectedTrip && tripDetail) {
      // 便詳細表示モード
      const trip = tripDetail.trip;
      const routeName = tripDetail.route_name;
      via = trip.via ? `${trip.via} 経由` : "";
      title = `[${routeName}] ${formatHeadsign(trip.headsign)}`;
      office = tripDetail.office_name || "";
      if (typeof selectedTrip.speedKmh === "number") {
        speedText = `${Math.floor(selectedTrip.speedKmh)} km/h`;
      }
      occupancyInfo = getOccupancyDisplay(selectedTrip.occupancyStatus);

      // 遅延を加味した nextStopId の特定
      let nextStopId = selectedTrip.highlightId;
      if (!selectedTrip.highlightId) {
        const next = trip.stops.find((st) => {
          const d = tripDetail.delays?.[st.stop_id] ?? 0;
          const estimatedSec = timeToSec(st.time) + d;
          return estimatedSec >= nowSec;
        });
        if (next) nextStopId = next.stop_id;
      }
      initialTargetId = nextStopId ? `stop-${nextStopId}` : null;

      items = trip.stops.map((st, index) => {
        const s = tripDetail.stops[st.stop_id];

        // サーバーから渡された本当の遅延秒数を取得
        const delay = tripDetail.delays?.[st.stop_id] ?? 0;
        const estimatedSec = timeToSec(st.time) + delay;
        const isPast = estimatedSec < nowSec;
        const hasDelay = !isPast && delay >= 60; // 1分以上なら遅延扱い
        const estimatedTime = hasDelay ? addDelayToTime(st.time, delay) : null;

        const isHighlight = st.stop_id === selectedTrip.highlightId;
        const isNextStop =
          !selectedTrip.highlightId && st.stop_id === nextStopId;
        const cls = `item-row ${isPast ? "past" : "future"} ${isHighlight ? "highlight" : ""} ${isNextStop ? "next-stop" : ""}`;

        return (
          <div
            key={index}
            id={`stop-${st.stop_id}`}
            className={cls}
            onClick={(e) => {
              e.stopPropagation();
              if (s) onFlyToStop(s.lng, s.lat);
            }}
          >
            <div className="item-time">
              {hasDelay ? (
                <div className="delay-time-inline">
                  <del className="delay-original-time">
                    {st.time.substring(0, 5)}
                  </del>
                  <span className="delay-estimated-time">{estimatedTime}</span>
                </div>
              ) : (
                <div>{st.time.substring(0, 5)}</div>
              )}
            </div>
            <div className="item-info">
              {s ? s.name : "..."}
              {s?.platform && (
                <div className="item-platform">{s.platform}番のりば</div>
              )}
            </div>
          </div>
        );
      });
    } else if (selectedTrip && !tripDetail) {
      items = [
        <div key="loading" className="empty-message">
          読み込み中...
        </div>,
      ];
    } else if (selectedStopId) {
      // バス停時刻表モード
      const stop = data.stops[selectedStopId];
      if (stop) {
        const isGrouped = zoom < 16.5;
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
            <div key="empty" className="empty-message">
              本日の運行はありません
            </div>,
          ];
        } else {
          allArrivals.sort((a, b) => {
            // 遅延を含めた到着予定時間でソートする
            const aSec = timeToSec(a.time) + (a.delay_seconds || 0);
            const bSec = timeToSec(b.time) + (b.delay_seconds || 0);
            return aSec - bSec;
          });

          let firstFutureFound = false;
          items = allArrivals.map((bus, idx) => {
            const delay = bus.delay_seconds ?? 0;
            const hasDelay = !bus.is_past && delay >= 60;
            const estimatedTime = hasDelay
              ? addDelayToTime(bus.time, delay)
              : null;
            const occupancy = getOccupancyDisplay(bus.occupancy_status);

            let isNext = false;
            if (!bus.is_past && !firstFutureFound) {
              firstFutureFound = true;
              isNext = true;
              initialTargetId = `arrival-${idx}`;
            }
            const cls = `item-row ${bus.is_past ? "past" : "future"} ${isNext ? "next-stop" : ""}`;

            return (
              <div
                key={idx}
                id={`arrival-${idx}`}
                className={cls}
                onClick={() =>
                  onSelectBus(
                    bus.trip_id,
                    bus.route_id,
                    bus.actual_stop_id,
                    undefined,
                    bus.occupancy_status,
                  )
                }
              >
                <div className="item-time">
                  {hasDelay ? (
                    <div className="delay-time-inline">
                      <del className="delay-original-time">
                        {bus.time.substring(0, 5)}
                      </del>
                      <span className="delay-estimated-time">
                        {estimatedTime}
                      </span>
                    </div>
                  ) : (
                    <div>{bus.time.substring(0, 5)}</div>
                  )}
                </div>
                <div className="item-info item-info-with-icon">
                  <div className="item-info-main">
                    {bus.via && <div className="item-via">{bus.via} 経由</div>}
                    {(data.routes[bus.route_id]?.short_name || bus.route_id) +
                      "系統 " +
                      formatHeadsign(bus.headsign)}
                    {bus.platform && (
                      <div className="item-platform">
                        {bus.platform}番のりば
                      </div>
                    )}
                  </div>
                  <span
                    className={`material-icons-outlined item-occupancy-mini ${occupancy.toneClass}`}
                    title={occupancy.label}
                    aria-label={occupancy.label}
                  >
                    {occupancy.icon}
                  </span>
                </div>
              </div>
            );
          });
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
    tripDetail,
    stopDelays,
    tripOccupancyMap,
    currentTime,
    zoom,
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
      // （キャッシュデータで誤った位置にスクロールしてしまう問題の回避）
      if (selectedStopId && timetableReadyForStop !== selectedStopId) return;

      const el = document.getElementById(panelData.initialTargetId);
      if (el) {
        const parent = contentRef.current;
        const currentRowHeight = el.getBoundingClientRect().height || 44;
        const prev = el.previousElementSibling as HTMLElement | null;
        const prevRowHeight = prev?.classList.contains("item-row")
          ? prev.getBoundingClientRect().height
          : currentRowHeight;

        // ヘッダー直下で「1つ前の行」が見える位置に固定する。
        // 比率ではなく行高ベースにすることで、端末差によるズレを抑える。
        const topMargin = 10;
        const desiredTop = prevRowHeight + topMargin;

        // offsetTop は環境によって基準親がずれて計算誤差が出ることがあるため、
        // panel-content の見えている領域基準で相対位置を算出する。
        const parentRect = parent.getBoundingClientRect();
        const rowRect = el.getBoundingClientRect();
        const relativeTop = parent.scrollTop + (rowRect.top - parentRect.top);

        const nextScrollTop = relativeTop - desiredTop;
        const maxScrollTop = Math.max(0, parent.scrollHeight - parent.clientHeight);
        const clamped = Math.max(0, Math.min(nextScrollTop, maxScrollTop));

        // Instagram内ブラウザ等で開閉直後に高さが不安定な場合があるため、
        // 1フレーム遅らせて最終レイアウト後にスクロールする。
        requestAnimationFrame(() => {
          parent.scrollTop = clamped;
          lastSelectedKeyRef.current = currentSelectionKey;
        });
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
    <div id="bottom-panel" className={isOpen ? "open" : ""}>
      <button
        className="close-btn"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title="閉じる"
      >
        <span className="material-icons-outlined" aria-hidden>
          close
        </span>
      </button>
      <div className="panel-header">
        {panelData.via && <div className="panel-via">{panelData.via}</div>}
        <div className="panel-title-row">
          <div className="panel-title">{panelData.title}</div>
        </div>
        {panelData.office && (
          <div className="office-info">{panelData.office}</div>
        )}
        {selectedTrip && panelData.occupancyInfo && (
          <div
            className={`occupancy-info ${panelData.occupancyInfo.toneClass}`}
          >
            <div className="occupancy-left">
              <span
                className="material-icons-outlined occupancy-icon"
                aria-hidden
              >
                {panelData.occupancyInfo.icon}
              </span>
              <span className="occupancy-text">
                {panelData.occupancyInfo.label}
              </span>
            </div>
            {panelData.speedText && (
              <div className="speed-info">
                <span
                  className="material-icons-outlined speed-icon"
                  aria-hidden
                >
                  speed
                </span>
                <span className="speed-text">{panelData.speedText}</span>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="panel-content" ref={contentRef}>
        {panelData.items}
      </div>
    </div>
  );
};

export default BusPanel;
