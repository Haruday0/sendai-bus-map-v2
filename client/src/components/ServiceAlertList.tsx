import React from "react";
import { Alert, Button, Chip } from "@heroui/react";
import type {
  AlertTargetStop,
  AlertTargetTrip,
  ServiceAlert,
} from "../types";
import {
  ALERT_CAUSE_LABELS,
  ALERT_EFFECT_META,
  type AlertBannerStatus,
} from "../alertConstants";
import { formatHeadsign } from "../utils";

/** 系統番号を公式カラー付き HeroUI Chip で表示する共通バッジ */
export const RouteBadgeChip: React.FC<{
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

interface ServiceAlertsListProps {
  alerts: ServiceAlert[];
  className?: string;
  onSelectStop?: (stop: AlertTargetStop) => void;
  onSelectTrip?: (trip: AlertTargetTrip) => void;
}

export const ServiceAlertsList: React.FC<ServiceAlertsListProps> = ({
  alerts,
  className = "flex flex-col gap-2 px-3 pt-2.5 pb-1",
  onSelectStop,
  onSelectTrip,
}) => {
  if (!alerts.length) return null;
  return (
    <div className={className}>
      {alerts.map((alert, index) => {
        const effectMeta = (alert.effect &&
          ALERT_EFFECT_META[alert.effect]) || {
          label: "運行情報",
          status: "accent" as AlertBannerStatus,
        };
        const causeLabel = alert.cause ? ALERT_CAUSE_LABELS[alert.cause] : "";
        const titleText =
          alert.header_text ||
          [effectMeta.label, causeLabel].filter(Boolean).join(" · ");

        return (
          <Alert
            key={alert.id || `alert-${index}`}
            status={effectMeta.status}
            className="rounded-2xl border border-separator bg-surface/65 px-3.5 py-2.5 shadow-surface"
          >
            <Alert.Indicator />
            <Alert.Content className="gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip
                  size="sm"
                  variant="soft"
                  color={
                    effectMeta.status === "danger"
                      ? "danger"
                      : effectMeta.status === "warning"
                        ? "warning"
                        : effectMeta.status === "accent"
                          ? "accent"
                          : "default"
                  }
                >
                  <Chip.Label>{effectMeta.label}</Chip.Label>
                </Chip>
                {causeLabel && (
                  <span className="text-[11px] font-semibold text-muted">
                    {causeLabel}
                  </span>
                )}
                {alert.agency_wide && (
                  <span className="text-[11px] font-medium text-muted">
                    · 全線対象
                  </span>
                )}
              </div>

              {titleText && (
                <Alert.Title className="text-xs leading-snug font-bold">
                  {titleText}
                </Alert.Title>
              )}

              {alert.description_text &&
                alert.description_text !== alert.header_text && (
                  <Alert.Description className="text-xs leading-relaxed whitespace-pre-wrap">
                    {alert.description_text}
                  </Alert.Description>
                )}

              {alert.target_routes && alert.target_routes.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 pt-0.5">
                  {alert.target_routes.map((route) => {
                    const color = route.color
                      ? `#${route.color.replace(/^#/, "")}`
                      : "#a3d742";
                    return (
                      <RouteBadgeChip
                        key={route.route_id}
                        label={route.short_name || route.route_id}
                        color={color}
                      />
                    );
                  })}
                </div>
              )}

              {(onSelectStop || onSelectTrip) &&
                ((alert.target_stops && alert.target_stops.length > 0) ||
                  (alert.target_trips && alert.target_trips.length > 0)) && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {onSelectStop &&
                      alert.target_stops?.map((stop) => (
                        <Button
                          key={stop.stop_id}
                          size="sm"
                          variant="secondary"
                          onPress={() => onSelectStop(stop)}
                          className="h-7 gap-1 rounded-full px-2.5 text-[11px] font-bold"
                        >
                          <span
                            className="material-icons-outlined text-[13px]"
                            aria-hidden
                          >
                            place
                          </span>
                          <span>{stop.name} 時刻表へ</span>
                        </Button>
                      ))}
                    {onSelectTrip &&
                      alert.target_trips?.map((trip) => (
                        <Button
                          key={trip.trip_id}
                          size="sm"
                          variant="secondary"
                          onPress={() => onSelectTrip(trip)}
                          className="h-7 gap-1 rounded-full px-2.5 text-[11px] font-bold"
                        >
                          <span
                            className="material-icons-outlined text-[13px]"
                            aria-hidden
                          >
                            directions_bus
                          </span>
                          <span>
                            {trip.route_name}{" "}
                            {trip.headsign
                              ? formatHeadsign(trip.headsign)
                              : "便詳細へ"}
                          </span>
                        </Button>
                      ))}
                  </div>
                )}

              {alert.url && (
                <a
                  href={alert.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-accent underline underline-offset-2"
                >
                  <span>詳細を見る</span>
                  <span
                    className="material-icons-outlined text-[13px]"
                    aria-hidden
                  >
                    open_in_new
                  </span>
                </a>
              )}
            </Alert.Content>
          </Alert>
        );
      })}
    </div>
  );
};
