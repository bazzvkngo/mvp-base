import { useSyncExternalStore } from "react";

// Etapa 5, paso 7: los gráficos de Chart.js pintan con strings JS en el
// momento del render, no con CSS, así que el tema no los alcanza solo.
// Paso 9: el tema ya no es @media (prefers-color-scheme) sino data-theme en
// <html> (resuelto por el script de index.html y por useThemePreference),
// así que este hook lo observa ahí: refleja tanto la preferencia del sistema
// como la elegida a mano, en vivo y desde el primer render.
function subscribe(onChange) {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

function isDarkThemeActive() {
  return typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark";
}

export default function usePrefersDarkMode() {
  return useSyncExternalStore(subscribe, isDarkThemeActive, () => false);
}
