import React, { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Chip,
  EmptyState,
  Modal,
  Spinner,
} from "@heroui/react";
import type { DisruptedTripNotice, ServiceAlert } from "../types";
import { formatHeadsign } from "../utils";
import { RouteBadgeChip, ServiceAlertsList } from "./ServiceAlertList";

type NoticeFilter = "all" | "alerts" | "canceled" | "skipped";

interface ServiceAlertsModalProps {
  isOpen: boolean;
  onClose: () => void;
  alerts: ServiceAlert[];
  disruptedTrips: DisruptedTripNotice[];
  isLoading?: boolean;
  lastFetchedAt?: number | null;
  realtimeError?: string;
  onRefresh?: () => void;
  onSelectStop: (stopId: string, lat?: number, lng?: number) => void;
  onSelectTrip: (
    routeId: string,
    tripId: string,
    lat?: number,
    lng?: number,
  ) => void;
}

const formatFetchedTime = (unixSec?: number | null): string => {
  if (!unixSec) return "";
  const d = new Date(unixSec * 1000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm} 更新`;
};

const ServiceAlertsModal: React.FC<ServiceAlertsModalProps> = ({
  isOpen,
  onClose,
  alerts,
  disruptedTrips,
  isLoading = false,
  lastFetchedAt,
  realtimeError,
  onRefresh,
  onSelectStop,
  onSelectTrip,
}) => {
  const [filter, setFilter] = useState<NoticeFilter>("all");

  const canceledTrips = useMemo(
    () => disruptedTrips.filter((t) => t.canceled),
    [disruptedTrips],
  );
  const skippedTrips = useMemo(
    () =>
      disruptedTrips.filter(
        (t) => !t.canceled && (t.skipped_stops?.length ?? 0) > 0,
      ),
    [disruptedTrips],
  );

  const visibleAlerts = useMemo(() => {
    if (filter === "all" || filter === "alerts") return alerts;
    if (filter === "canceled") {
      return alerts.filter((a) => a.effect === "NO_SERVICE");
    }
    return alerts.filter(
      (a) => a.effect === "DETOUR" || a.effect === "STOP_MOVED",
    );
  }, [alerts, filter]);

  const visibleTrips = useMemo(() => {
    if (filter === "alerts") return [];
    if (filter === "canceled") return canceledTrips;
    if (filter === "skipped") return skippedTrips;
    return disruptedTrips;
  }, [filter, disruptedTrips, canceledTrips, skippedTrips]);

  const canceledBadgeCount =
    canceledTrips.length +
    alerts.filter((a) => a.effect === "NO_SERVICE").length;
  const skippedBadgeCount =
    skippedTrips.length +
    alerts.filter((a) => a.effect === "DETOUR" || a.effect === "STOP_MOVED")
      .length;
  const totalCount = alerts.length + disruptedTrips.length;

  const filterButtons: { id: NoticeFilter; label: string; count: number }[] = [
    { id: "all", label: "すべて", count: totalCount },
    { id: "alerts", label: "運行情報", count: alerts.length },
    { id: "canceled", label: "運休", count: canceledBadgeCount },
    { id: "skipped", label: "通過・迂回", count: skippedBadgeCount },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop variant="blur">
        <Modal.Container placement="auto" scroll="inside" size="lg">
          <Modal.Dialog className="glass-surface-lg">
            <Modal.CloseTrigger aria-label="閉じる" />

            <Modal.Header className="flex flex-col gap-2.5 pr-8">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Modal.Heading className="text-lg font-bold">
                    運行情報・お知らせ
                  </Modal.Heading>
                  {totalCount > 0 && (
                    <Chip
                      size="sm"
                      variant="soft"
                      color={canceledBadgeCount > 0 ? "danger" : "warning"}
                    >
                      <Chip.Label className="tabular-nums">
                        {totalCount}件
                      </Chip.Label>
                    </Chip>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {lastFetchedAt ? (
                    <span className="text-[11px] font-medium text-muted tabular-nums">
                      {formatFetchedTime(lastFetchedAt)}
                    </span>
                  ) : null}
                  {onRefresh && (
                    <Button
                      size="sm"
                      variant="tertiary"
                      isDisabled={isLoading}
                      onPress={onRefresh}
                      aria-label="運行情報を再取得"
                      className="h-7 gap-1 rounded-full px-2.5 text-xs font-semibold"
                    >
                      {isLoading ? (
                        <Spinner size="sm" />
                      ) : (
                        <span
                          className="material-icons-outlined text-[15px]"
                          aria-hidden
                        >
                          refresh
                        </span>
                      )}
                      <span>更新</span>
                    </Button>
                  )}
                </div>
              </div>

              <div
                className="flex flex-wrap gap-1.5"
                role="group"
                aria-label="お知らせ種別フィルタ"
              >
                {filterButtons.map((btn) => {
                  const active = filter === btn.id;
                  return (
                    <Button
                      key={btn.id}
                      size="sm"
                      variant={active ? "primary" : "tertiary"}
                      onPress={() => setFilter(btn.id)}
                      aria-label={`${btn.label} (${btn.count}件)`}
                      className="h-7 gap-1 rounded-full px-3 text-xs font-bold"
                    >
                      <span>{btn.label}</span>
                      <span className="opacity-80 tabular-nums">
                        {btn.count}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </Modal.Header>

            <Modal.Body className="flex flex-col gap-4 pb-5 text-sm text-foreground">
              {realtimeError && (
                <Alert
                  status="warning"
                  className="rounded-2xl border border-separator bg-surface/65 px-3.5 py-2.5 shadow-surface"
                >
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title className="text-xs font-bold">
                      一部のリアルタイム情報を取得できませんでした
                    </Alert.Title>
                    <Alert.Description className="text-[11px]">
                      {realtimeError}
                    </Alert.Description>
                  </Alert.Content>
                </Alert>
              )}

              {visibleAlerts.length === 0 && visibleTrips.length === 0 ? (
                <EmptyState className="py-10 text-center text-sm text-muted">
                  {filter === "all"
                    ? "現在、運休や経路変更などの運行情報はありません。"
                    : "該当する運行情報はありません。"}
                </EmptyState>
              ) : (
                <>
                  {visibleAlerts.length > 0 && (
                    <section className="flex flex-col gap-2">
                      <h3 className="px-0.5 text-xs font-bold text-muted">
                        運行情報 (Alert · {visibleAlerts.length}件)
                      </h3>
                      <ServiceAlertsList
                        alerts={visibleAlerts}
                        className="flex flex-col gap-2"
                        onSelectStop={(stop) =>
                          onSelectStop(stop.stop_id, stop.lat, stop.lng)
                        }
                        onSelectTrip={(trip) =>
                          onSelectTrip(trip.route_id, trip.trip_id)
                        }
                      />
                    </section>
                  )}

                  {visibleTrips.length > 0 && (
                    <section className="flex flex-col gap-2">
                      <h3 className="px-0.5 text-xs font-bold text-muted">
                        便別の運休・通過 ({visibleTrips.length}便)
                      </h3>
                      <div className="flex flex-col gap-2">
                        {visibleTrips.map((notice) => {
                          const color = notice.route_color
                            ? `#${notice.route_color.replace(/^#/, "")}`
                            : "#a3d742";
                          const skippedCount =
                            notice.skipped_stops?.length ?? 0;
                          const startTimeText = notice.start_time
                            ? notice.start_time.substring(0, 5)
                            : "--:--";

                          return (
                            <Card<"button">
                              key={`${notice.route_id}-${notice.trip_id}`}
                              variant="default"
                              render={(domProps) => (
                                <button type="button" {...domProps} />
                              )}
                              onClick={() =>
                                onSelectTrip(
                                  notice.route_id,
                                  notice.trip_id,
                                  notice.first_stop_lat,
                                  notice.first_stop_lng,
                                )
                              }
                              className="w-full cursor-pointer flex-row items-center gap-3 rounded-2xl border border-separator bg-surface/65 px-3.5 py-2.5 text-left transition-[transform,background-color] duration-150 outline-none select-none hover:bg-surface/85 focus-visible:status-focused active:scale-[0.99]"
                            >
                              <div className="w-12 shrink-0 text-center text-[15px] font-bold text-foreground tabular-nums">
                                {startTimeText}
                              </div>

                              <div className="min-w-0 flex-1">
                                {notice.via && (
                                  <div className="mb-0.5 text-[11px] text-muted">
                                    {notice.via} 経由
                                  </div>
                                )}
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <RouteBadgeChip
                                    label={notice.route_name || notice.route_id}
                                    color={color}
                                  />
                                  <span className="text-[14px] leading-snug font-bold whitespace-normal text-foreground [word-break:auto-phrase]">
                                    {notice.headsign
                                      ? formatHeadsign(notice.headsign)
                                      : notice.route_name || notice.route_id}
                                  </span>
                                </div>
                                {skippedCount > 0 && (
                                  <div className="mt-1 text-[11px] leading-snug text-muted">
                                    通過:{" "}
                                    {notice.skipped_stops
                                      ?.map((s) => s.name)
                                      .join("、")}
                                  </div>
                                )}
                              </div>

                              <div className="flex shrink-0 items-center gap-1">
                                {notice.canceled && (
                                  <Chip size="sm" variant="soft" color="danger">
                                    <Chip.Label>運休</Chip.Label>
                                  </Chip>
                                )}
                                {skippedCount > 0 && (
                                  <Chip
                                    size="sm"
                                    variant="soft"
                                    color="warning"
                                  >
                                    <Chip.Label>
                                      通過 ({skippedCount})
                                    </Chip.Label>
                                  </Chip>
                                )}
                                <span
                                  className="material-icons-outlined text-[18px] text-muted"
                                  aria-hidden
                                >
                                  chevron_right
                                </span>
                              </div>
                            </Card>
                          );
                        })}
                      </div>
                    </section>
                  )}
                </>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
};

export default ServiceAlertsModal;
