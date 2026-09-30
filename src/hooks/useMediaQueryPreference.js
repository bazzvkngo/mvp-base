import { useEffect, useState } from "react";

// Generalizado desde el usePrefersReducedMotion que vivía dentro de
// DashboardDonutChart.jsx: mismo patrón (matchMedia + addEventListener
// "change" + useState), parametrizado por la media query. Reacciona en
// vivo a un cambio de preferencia del sistema mientras la página ya está
// abierta, sin necesitar recarga — no solo lee el valor una vez al montar.
export default function useMediaQueryPreference(query) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;

    const mediaQuery = window.matchMedia(query);
    setMatches(mediaQuery.matches);

    const handleChange = (event) => setMatches(event.matches);
    mediaQuery.addEventListener?.("change", handleChange);
    return () => mediaQuery.removeEventListener?.("change", handleChange);
  }, [query]);

  return matches;
}
