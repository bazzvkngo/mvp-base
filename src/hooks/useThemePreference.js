import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from "react";

// Interruptor manual de tema (etapa 5, paso 9). La elección vive en este
// navegador (localStorage), no en la cuenta. El script inline de index.html
// aplica la misma regla antes del primer pintado; el provider la aplica al
// cambiar la elección y, en "system", sigue al sistema operativo en vivo.
//
// El estado vive en UN provider (src/app/App.jsx), no en cada consumidor:
// el evento "storage" no se dispara en la misma pestaña, así que dos copias
// independientes (topbar y Mi cuenta) se desincronizarían, y la que quedara
// en "system" seguiría aplicando el tema del sistema encima de una elección
// hecha en la otra.
export const THEME_STORAGE_KEY = "valoracloud.theme";
export const THEME_PREFERENCES = Object.freeze(["system", "light", "dark"]);
const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";
const ThemePreferenceContext = createContext(null);

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

export function ThemePreferenceProvider({ children }) {
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

  const value = useMemo(() => ({ preference, setPreference }), [preference, setPreference]);
  return createElement(ThemePreferenceContext.Provider, { value }, children);
}

export default function useThemePreference() {
  const context = useContext(ThemePreferenceContext);
  if (!context) throw new Error("useThemePreference necesita <ThemePreferenceProvider> como ancestro (src/app/App.jsx).");
  return context;
}
