import useMediaQueryPreference from "./useMediaQueryPreference";

// Etapa 5, paso 7: los gráficos de Chart.js pintan con strings JS en el
// momento del render, no con CSS — @media (prefers-color-scheme: dark)
// no los alcanza. Este hook les da la misma reactividad en vivo que ya
// tiene el resto de la app de forma gratuita vía CSS puro.
export default function usePrefersDarkMode() {
  return useMediaQueryPreference("(prefers-color-scheme: dark)");
}
