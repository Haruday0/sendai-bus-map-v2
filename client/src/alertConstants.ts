import type { ServiceAlert } from "./types";

export type AlertBannerStatus = "default" | "accent" | "warning" | "danger";

export const ALERT_EFFECT_META: Record<
  string,
  { label: string; status: AlertBannerStatus }
> = {
  NO_SERVICE: { label: "運休", status: "danger" },
  REDUCED_SERVICE: { label: "減便・特別ダイヤ", status: "warning" },
  SIGNIFICANT_DELAYS: { label: "大幅な遅延", status: "warning" },
  DETOUR: { label: "経路変更・迂回", status: "warning" },
  ADDITIONAL_SERVICE: { label: "臨時便", status: "accent" },
  MODIFIED_SERVICE: { label: "運行変更", status: "warning" },
  STOP_MOVED: { label: "のりば変更・休止", status: "warning" },
  ACCESSIBILITY_ISSUE: { label: "設備情報", status: "default" },
};

export const ALERT_CAUSE_LABELS: Record<string, string> = {
  TECHNICAL_PROBLEM: "車両・システム障害",
  STRIKE: "ストライキ",
  DEMONSTRATION: "通行規制・デモ",
  ACCIDENT: "事故",
  HOLIDAY: "休日・祝日",
  WEATHER: "悪天候",
  MAINTENANCE: "保守・点検",
  CONSTRUCTION: "工事",
  POLICE_ACTIVITY: "交通規制",
  MEDICAL_EMERGENCY: "急病人救護",
  SPECIAL_EVENT: "イベント・大会",
};

export const DEBUG_MOCK_ALERTS: ServiceAlert[] = [
  {
    id: "debug-mock-detour",
    effect: "DETOUR",
    cause: "SPECIAL_EVENT",
    header_text: "【ダミー】駅伝大会に伴う迂回運行のお知らせ",
    description_text:
      "交通規制のため、一部区間を迂回運行し、指定のバス停を通過いたします。（デバッグ表示）",
    url: "https://www.kotsu.city.sendai.jp/",
    target_stops: [
      {
        stop_id: "50_56",
        name: "仙台駅前",
        lat: 38.260292,
        lng: 140.880814,
      },
    ],
  },
];
