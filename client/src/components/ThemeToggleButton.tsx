import React from "react";
import { Button } from "@heroui/react";
import { type ThemePreference, useTheme } from "../context/ThemeContext";

const getThemeIcon = (
  themePreference: ThemePreference,
  isDark: boolean,
): string => {
  if (themePreference === "system") {
    return isDark ? "night_sight_auto" : "light_mode_auto";
  }
  return themePreference === "dark" ? "dark_mode" : "light_mode";
};

const THEME_LABEL: Record<ThemePreference, string> = {
  system: "端末の設定",
  light: "ライト",
  dark: "ダーク",
};

const ThemeToggleButton: React.FC = () => {
  const { isDark, themePreference, toggleTheme } = useTheme();
  const label = `テーマ切り替え（現在: ${THEME_LABEL[themePreference]}）`;

  return (
    <span className="inline-flex" title={label}>
      <Button
        isIconOnly
        variant="tertiary"
        aria-label={label}
        className="glass-surface rounded-full"
        onPress={toggleTheme}
      >
        <span
          className="material-symbols-rounded inline-flex select-none items-center justify-center leading-none"
          style={{ fontSize: "22px", width: "22px", height: "22px" }}
          aria-hidden="true"
        >
          {getThemeIcon(themePreference, isDark)}
        </span>
      </Button>
    </span>
  );
};

export default ThemeToggleButton;
