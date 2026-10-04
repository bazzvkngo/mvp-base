import { useCallback, useEffect, useState } from "react";

// Interruptor manual de tema (etapa 5, paso 9). La elección vive en este
// navegador (localStorage), no en la cuenta. El script inline de index.html
// aplica la misma regla antes del primer pintado; este hook la aplica al
// cambiar la elección y, en "system", sigue al sistema operativo en vivo.
export const THEME_STORAGE_KEY = "valoracloud.theme";
export const THEME_PREFERENCES = Object.freeze(["system", "light", "dark"]);
const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

function readStoredPreference() {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_PREFERENCES.includes(stored) ? stored : "system";
  } catch (error) {
    return "system";
  }
}

function systemPrefersDark() {
  return Boolean(window.matchMedia && window.matchMedia(DARK_SCHEME_QUERY).matches);
}

function applyThemePreference(preference) {
  const dark = preference === "dark" || (preference === "system" && systemPrefersDark());
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

export default function useThemePreference() {
  const [preference, setPreferenceState] = useState(readStoredPreference);

  useEffect(() => {
    applyThemePreference(preference);
    if (preference !== "system" || !window.matchMedia) return undefined;
    const query = window.matchMedia(DARK_SCHEME_QUERY);
    const followSystem = () => applyThemePreference("system");
    query.addEventListener?.("change", followSystem);
    return () => query.removeEventListener?.("change", followSystem);
  }, [preference]);

  const setPreference = useCallback((next) => {
    if (!THEME_PREFERENCES.includes(next)) return;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (error) {
      // Safari privado o almacenamiento bloqueado: el tema se aplica igual
      // en esta sesión, sólo no se recuerda.
    }
    setPreferenceState(next);
  }, []);

  return { preference, setPreference };
}
