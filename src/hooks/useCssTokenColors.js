import {useMemo} from "react";
import usePrefersDarkMode from "./usePrefersDarkMode";

// Chart.js pinta con strings JS y no puede leer var(). En vez de copiar a mano
// los valores de tokens.css (como hacen los gráficos anteriores), este hook
// los resuelve desde el CSS ya aplicado, y se recalcula al cambiar el modo.
export default function useCssTokenColors(tokenNames) {
  const isDarkMode = usePrefersDarkMode();
  const key = tokenNames.join("|");
  return useMemo(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return {};
    const styles = window.getComputedStyle(document.documentElement);
    return Object.fromEntries(key.split("|").map((name) => [name, styles.getPropertyValue(name).trim() || undefined]));
  }, [isDarkMode, key]);
}
