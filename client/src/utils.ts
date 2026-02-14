import type { CalendarData, ExtraData, ShapesData } from "./types";

// ==================== ユーティリティ ====================

/** 時刻文字列 "HH:MM:SS" を秒数に変換 */
export function timeToSec(t: string): number {
  if (!t) return 0;
  const parts = t.split(":").map(Number);
  return parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0);
}

/** 行先表示のフォーマット */
export function formatHeadsign(headsign: string): string {
  if (headsign.includes("循環")) return headsign;
  return headsign + "行";
}

// ==================== サービス判定 ====================

export function isServiceRunningToday(
  serviceId: string,
  calendarData: CalendarData,
  extraData: ExtraData,
): boolean {
  const now = new Date();
  const ymd =
    now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");

  const exception = (extraData.calendar_dates || []).find(
    (d) => d.date === ymd && d.service_id === serviceId,
  );
  if (exception) return exception.exception_type === "1";

  const cal = calendarData[serviceId];
  if (!cal) return false;

  if (ymd >= cal.start && ymd <= cal.end) {
    const gtfsDayIdx = (now.getDay() + 6) % 7;
    return cal.days[gtfsDayIdx] === "1";
  }

  // 期限切れフォールバック
  const startDate = new Date(
    Number(cal.start.slice(0, 4)),
    Number(cal.start.slice(4, 6)) - 1,
    Number(cal.start.slice(6, 8)),
  );
  const endDate = new Date(
    Number(cal.end.slice(0, 4)),
    Number(cal.end.slice(4, 6)) - 1,
    Number(cal.end.slice(6, 8)),
  );
  const durationDays =
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);

  if (durationDays >= 20) {
    const gtfsDayIdx = (now.getDay() + 6) % 7;
    return cal.days[gtfsDayIdx] === "1";
  }

  return false;
}

// ==================== バス位置計算 ====================

export function calculateBusPos(
  trip: { stops: { time: string; stop_id: string }[] },
  nowSec: number,
  shapesData: ShapesData,
): [number, number] | null {
  const patternKey = trip.stops.map((s) => s.stop_id).join("|");
  const shapeData = shapesData[patternKey];
  if (!shapeData || !shapeData.coordinates || !shapeData.stop_indices)
    return null;
  const coords = shapeData.coordinates;
  const indices = shapeData.stop_indices;

  for (let i = 0; i < trip.stops.length - 1; i++) {
    const s1 = timeToSec(trip.stops[i].time);
    const s2 = timeToSec(trip.stops[i + 1].time);
    if (nowSec >= s1 && nowSec < s2) {
      const timeRatio = (nowSec - s1) / (s2 - s1);
      const targetIndex = Math.floor(
        indices[i] + (indices[i + 1] - indices[i]) * timeRatio,
      );
      return coords[Math.min(targetIndex, coords.length - 1)];
    }
  }
  return null;
}

// ==================== 検索履歴管理 ====================

const HISTORY_KEY = "bus_search_history";

export function getSearchHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveSearchHistory(stopId: string): void {
  let history = getSearchHistory();
  history = history.filter((id) => id !== stopId);
  history.unshift(stopId);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 5)));
}

export function removeFromSearchHistory(stopId: string): void {
  let history = getSearchHistory();
  history = history.filter((id) => id !== stopId);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}
