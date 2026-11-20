import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";

export type ThemePreference = "system" | "light" | "dark";
type ColorScheme = "light" | "dark";

interface ThemeContextValue {
  isDark: boolean;
  colorScheme: ColorScheme;
  themePreference: ThemePreference;
  setThemePreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
  setColorScheme: (scheme: ColorScheme) => void;
}

const STORAGE_KEY = "bus-map-theme";

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const getInitialThemePreference = (): ThemePreference => {
  if (typeof window === "undefined") return "system";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") {
      return saved;
    }
  } catch {
    // localStorageアクセス制限等の例外を無視
  }
  return "system";
};

const getSystemIsDark = (): boolean => {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
};

const applyThemeToDOM = (scheme: ColorScheme) => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (scheme === "dark") {
    root.classList.add("dark");
    root.classList.remove("light");
    root.setAttribute("data-theme", "dark");
  } else {
    root.classList.remove("dark");
    root.classList.add("light");
    root.setAttribute("data-theme", "light");
  }
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(
    getInitialThemePreference,
  );
  const [systemIsDark, setSystemIsDark] = useState<boolean>(getSystemIsDark);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const listener = (e: MediaQueryListEvent) => {
      setSystemIsDark(e.matches);
    };

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    }

    media.addListener(listener);
    return () => media.removeListener(listener);
  }, []);

  useEffect(() => {
    try {
      if (themePreference === "system") {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, themePreference);
      }
    } catch {
      // localStorageアクセス制限等の例外を無視
    }
  }, [themePreference]);

  const colorScheme: ColorScheme =
    themePreference === "system"
      ? systemIsDark
        ? "dark"
        : "light"
      : themePreference;
  const isDark = colorScheme === "dark";

  useLayoutEffect(() => {
    applyThemeToDOM(colorScheme);
  }, [colorScheme]);

  const setThemePreference = (preference: ThemePreference) => {
    setThemePreferenceState(preference);
  };

  const toggleTheme = () => {
    setThemePreferenceState((prev) => {
      if (prev === "system") return "light";
      if (prev === "light") return "dark";
      return "system";
    });
  };

  const setColorScheme = (scheme: ColorScheme) => {
    setThemePreferenceState(scheme);
  };

  return (
    <ThemeContext.Provider
      value={{
        isDark,
        colorScheme,
        themePreference,
        setThemePreference,
        toggleTheme,
        setColorScheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
