import React, {
  useEffect,
  useState,
  useMemo,
  useLayoutEffect,
  useRef,
} from "react";
import { X } from "lucide-react";
import type { AppData, PanelTrip, Arrival, TripDetailResponse } from "../types";
import {
  formatHeadsign,
  isServiceRunningToday,
  addDelayToTime,
  timeToSec,
} from "../utils";

interface BusPanelProps {
  data: AppData;
  selectedStopId: string | null;
  selectedTrip: PanelTrip | null;
  tripDetail: TripDetailResponse | null;
  stopDelays: Record<string, Record<string, number>>;
  zoom: number;
  onClose: () => void;
  onSelectBus: (tripId: string, routeId: string, highlightId?: string) => void;
  onFlyToStop: (lng: number, lat: number) => void;
}

const BusPanel: React.FC<BusPanelProps> = ({
  data,
  selectedStopId,
  selectedTrip,
  tripDetail,
  stopDelays,
  zoom,
  onClose,
  onSelectBus,
  onFlyToStop,
}) => {
  const [currentTime, setCurrentTime] = useState("");
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

  const currentSelectionKey = selectedTrip
    ? `trip-${selectedTrip.tripId}`
    : `stop-${selectedStopId}`;

  const panelData = useMemo(() => {
    let title = "";
    let via = "";
    let office = "";
    let speedText = "";
    let items: React.ReactNode[] = [];
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
        speedText = `${selectedTrip.speedKmh.toFixed(1)} km/h`;
      }

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
                  onSelectBus(bus.trip_id, bus.route_id, bus.actual_stop_id)
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
                <div className="item-info">
                  {bus.via && <div className="item-via">{bus.via} 経由</div>}
                  {(data.routes[bus.route_id]?.short_name || bus.route_id) +
                    "系統 " +
                    formatHeadsign(bus.headsign)}
                  {bus.platform && (
                    <div className="item-platform">{bus.platform}番のりば</div>
                  )}
                </div>
              </div>
            );
          });
        }
      }
    }

    return { items, title, via, office, speedText, initialTargetId };
  }, [
    data,
    selectedStopId,
    selectedTrip,
    tripDetail,
    stopDelays,
    currentTime,
    zoom,
    onSelectBus,
    onFlyToStop,
  ]);

  const lastSelectedKeyRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (
      currentSelectionKey !== lastSelectedKeyRef.current &&
      contentRef.current &&
      panelData.initialTargetId
    ) {
      const el = document.getElementById(panelData.initialTargetId);
      if (el) {
        const parent = contentRef.current;
        const offset = selectedTrip ? 40 : 0;
        const denom = selectedTrip ? 2 : 3;
        parent.scrollTop = el.offsetTop - parent.clientHeight / denom + offset;
        lastSelectedKeyRef.current = currentSelectionKey;
      }
    }
  }, [currentSelectionKey, panelData.initialTargetId, selectedTrip]);

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
        <X size={24} />
      </button>
      <div className="panel-header">
        {panelData.via && <div className="panel-via">{panelData.via}</div>}
        <div className="panel-title-row">
          <div className="panel-title">{panelData.title}</div>
          {panelData.speedText && (
            <div className="panel-speed">{panelData.speedText}</div>
          )}
        </div>
        {panelData.office && (
          <div className="office-info">{panelData.office}</div>
        )}
      </div>
      <div className="panel-content" ref={contentRef}>
        {panelData.items}
      </div>
    </div>
  );
};

export default BusPanel;
