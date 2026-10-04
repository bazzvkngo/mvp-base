import React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import AppIcon from "./ui/AppIcon";
import usePrefersDarkMode from "../hooks/usePrefersDarkMode";
import useThemePreference from "../hooks/useThemePreference";

// Acceso rápido al tema desde el topbar: cicla sistema -> claro -> oscuro.
// Comparte estado con Mi cuenta > Apariencia (ThemePreferenceProvider).
const NEXT_PREFERENCE = { system: "light", light: "dark", dark: "system" };
const PREFERENCE_ICONS = { system: Monitor, light: Sun, dark: Moon };
const PREFERENCE_NAMES = { system: "igual que el sistema", light: "claro", dark: "oscuro" };

export default function ThemeToggleButton() {
  const { preference, setPreference } = useThemePreference();
  const isDarkTheme = usePrefersDarkMode();
  const next = NEXT_PREFERENCE[preference];
  const current = preference === "system"
    ? `Tema igual que el sistema (ahora ${isDarkTheme ? "oscuro" : "claro"})`
    : `Tema ${PREFERENCE_NAMES[preference]}`;
  const label = `${current}. Cambiar a ${PREFERENCE_NAMES[next]}`;

  return (
    <button
      type="button"
      className="topbar-theme-button no-print"
      aria-label={label}
      title={label}
      onClick={() => setPreference(next)}
    >
      <AppIcon icon={PREFERENCE_ICONS[preference]} size={20} />
    </button>
  );
}
