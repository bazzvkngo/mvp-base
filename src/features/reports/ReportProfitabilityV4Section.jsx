import {useEffect, useState} from "react";
import {
  aggregateCommercialSalesV4,
  aggregateProjectProfitabilityV4,
} from "../../domain/reportProfitabilityV4.mjs";
import {BUSINESS_PERMISSIONS, hasBusinessPermission} from "../../domain/rbac.mjs";
import {
  loadProjectBalancesBoundedV4,
  loadSalesForReportV4,
} from "../../services/reportProfitabilityV4Service";

export {ProjectProfitabilityV4Summary, SalesCommercialMarginV4Card} from "./ReportProfitabilityV4Cards";

const INITIAL_COMMERCIAL = Object.freeze({status: "loading", bloque: null, meta: null, error: ""});
const INITIAL_PROJECTS = Object.freeze({status: "loading", bloque: null, meta: null, error: ""});

// Hook único: dos cargas independientes (Ventas y Proyectos) para que un error o
// una demora en una no bloquee la otra. No recalcula nada: sólo invoca la capa de
// ETAPA 2 (loadSalesForReportV4 / loadProjectBalancesBoundedV4) y agrega con los
// helpers puros de ETAPA 1 (aggregateCommercialSalesV4 / aggregateProjectProfitabilityV4).
// El descarte de resultados obsoletos usa el mismo patrón `let active` ya presente
// en el resto de la app (StatisticsPage, SalesPage, etc.): cada efecto se reinicia
// por completo cuando cambian negocio/rango/rol, y una respuesta que llega después
// de que ese efecto quedó obsoleto se ignora.
export function useReportProfitabilityV4({businessId, range, role}) {
  const canView = hasBusinessPermission(role, BUSINESS_PERMISSIONS.SALES_READ)
    && hasBusinessPermission(role, BUSINESS_PERMISSIONS.PROFITABILITY_READ);
  const [commercial, setCommercial] = useState(INITIAL_COMMERCIAL);
  const [projects, setProjects] = useState(INITIAL_PROJECTS);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!canView || !businessId) { setCommercial(INITIAL_COMMERCIAL); return undefined; }
    let active = true;
    setCommercial(INITIAL_COMMERCIAL);
    loadSalesForReportV4(businessId, {from: range.start, to: range.end, role})
      .then((page) => {
        if (!active) return;
        setCommercial({
          status: "ready",
          bloque: aggregateCommercialSalesV4(page.items, {truncated: page.lecturaTruncada}),
          meta: page,
          error: "",
        });
      })
      .catch((error) => {
        if (!active) return;
        setCommercial({
          status: "error",
          bloque: null,
          meta: null,
          error: error?.name === "ReportRangeError"
            ? error.message
            : (error?.message || "No fue posible calcular el margen comercial de Ventas."),
        });
      });
    return () => { active = false; };
  }, [businessId, canView, range.end, range.start, reloadKey, role]);

  useEffect(() => {
    if (!canView || !businessId) { setProjects(INITIAL_PROJECTS); return undefined; }
    let active = true;
    setProjects(INITIAL_PROJECTS);
    loadProjectBalancesBoundedV4(businessId, {role})
      .then((result) => {
        if (!active) return;
        setProjects({
          status: "ready",
          bloque: aggregateProjectProfitabilityV4(result.proyectos),
          meta: result,
          error: "",
        });
      })
      .catch((error) => {
        if (!active) return;
        setProjects({
          status: "error",
          bloque: null,
          meta: null,
          error: error?.message || "No fue posible cargar la rentabilidad de Proyectos.",
        });
      });
    return () => { active = false; };
  }, [businessId, canView, reloadKey, role]);

  return {canView, commercial, projects, reload: () => setReloadKey((value) => value + 1)};
}
