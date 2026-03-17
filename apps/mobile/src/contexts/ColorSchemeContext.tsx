import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Appearance, ColorSchemeName } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  NEUTRAL,
  NEUTRAL_DARK,
  SEMANTIC,
  SEMANTIC_DARK,
  type NeutralColors,
  type SemanticColors,
} from "@/lib/design-tokens";

const STORAGE_KEY = "@app/color-scheme-preference";

export type ColorSchemePreference = "light" | "dark" | "system";
export type ResolvedColorScheme = "light" | "dark";

interface ColorSchemeContextValue {
  colorScheme: ResolvedColorScheme;
  preference: ColorSchemePreference;
  setPreference: (preference: ColorSchemePreference) => Promise<void>;
  neutral: NeutralColors;
  semantic: SemanticColors;
}

const ColorSchemeContext = createContext<ColorSchemeContextValue | null>(null);

function resolveScheme(
  preference: ColorSchemePreference,
  systemScheme: ColorSchemeName
): ResolvedColorScheme {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return systemScheme === "dark" ? "dark" : "light";
}

export function ColorSchemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = Appearance.getColorScheme();
  const [preference, setPreferenceState] = useState<ColorSchemePreference>("system");
  const [systemColorScheme, setSystemColorScheme] = useState<ColorSchemeName>(systemScheme);
  const [isHydrated, setIsHydrated] = useState(false);

  // Load persisted preference on mount
  useEffect(() => {
    let isMounted = true;

    const loadPreference = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (
          isMounted &&
          stored !== null &&
          (stored === "light" || stored === "dark" || stored === "system")
        ) {
          setPreferenceState(stored as ColorSchemePreference);
        }
      } catch {
        // Silently fall back to "system" if storage is unavailable
      } finally {
        if (isMounted) {
          setIsHydrated(true);
        }
      }
    };

    void loadPreference();

    return () => {
      isMounted = false;
    };
  }, []);

  // Listen for system appearance changes
  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemColorScheme(colorScheme);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const setPreference = useCallback(async (next: ColorSchemePreference) => {
    setPreferenceState(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Silently ignore storage errors — in-memory state still updates
    }
  }, []);

  const colorScheme = resolveScheme(preference, systemColorScheme);

  const value: ColorSchemeContextValue = {
    colorScheme,
    preference,
    setPreference,
    neutral: colorScheme === "dark" ? NEUTRAL_DARK : NEUTRAL,
    semantic: colorScheme === "dark" ? SEMANTIC_DARK : SEMANTIC,
  };

  // Render children even before hydration so the app does not flash;
  // the system default ("light") is used until the stored value loads.
  if (!isHydrated) {
    const preHydrateScheme = resolveScheme("system", systemColorScheme);
    const preHydrateValue: ColorSchemeContextValue = {
      colorScheme: preHydrateScheme,
      preference: "system",
      setPreference,
      neutral: preHydrateScheme === "dark" ? NEUTRAL_DARK : NEUTRAL,
      semantic: preHydrateScheme === "dark" ? SEMANTIC_DARK : SEMANTIC,
    };
    return (
      <ColorSchemeContext.Provider value={preHydrateValue}>
        {children}
      </ColorSchemeContext.Provider>
    );
  }

  return (
    <ColorSchemeContext.Provider value={value}>
      {children}
    </ColorSchemeContext.Provider>
  );
}

export function useAppColorScheme(): ColorSchemeContextValue {
  const ctx = useContext(ColorSchemeContext);
  if (!ctx) {
    throw new Error("useAppColorScheme must be used within a ColorSchemeProvider");
  }
  return ctx;
}
