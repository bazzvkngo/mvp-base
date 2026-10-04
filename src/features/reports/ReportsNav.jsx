import React from "react";

// SPEC 022 §6.1: cuatro pestañas. `permission` indica qué capacidad del perfil
// exige cada una (las mismas que ya decide StatisticsPage con rbac.mjs).
export const REPORT_VIEWS = Object.freeze([
  {id: "rentabilidad", label: "Rentabilidad y estado", permission: "canViewProfitability"},
  {id: "ventas", label: "Ventas", permission: "canViewSales"},
  {id: "compras", label: "Compras", permission: "canViewPurchases"},
  {id: "ganancias", label: "Ganancias", permission: "canViewProfitability"},
]);

const DEFAULT_VIEW_ID = "rentabilidad";
// URL de las pestañas retiradas (SPEC 021): siguen funcionando como enlaces.
const LEGACY_VIEW_IDS = Object.freeze({resumen: "rentabilidad", inventario: "rentabilidad", proyectos: "rentabilidad"});
const VIEWS_BY_ID = new Map(REPORT_VIEWS.map((view) => [view.id, view]));

function canOpenView(view, permissions) {
  return permissions[view.permission] !== false;
}

export function getAllowedReportViews(permissions = {}) {
  return REPORT_VIEWS.filter((view) => canOpenView(view, permissions));
}

// Resuelve la vista pedida a una que el perfil pueda abrir, para que ningún
// perfil aterrice en una pestaña vacía. Permisos ausentes se tratan como
// concedidos (compatibilidad con llamadas sin permisos).
export function normalizeReportView(value, permissions = {}) {
  const requested = LEGACY_VIEW_IDS[value] || (VIEWS_BY_ID.has(value) ? value : DEFAULT_VIEW_ID);
  if (canOpenView(VIEWS_BY_ID.get(requested), permissions)) return requested;
  return getAllowedReportViews(permissions)[0]?.id || DEFAULT_VIEW_ID;
}

function ReportsNav({active, onSelect, permissions = {}}) {
  return (
    <div className="financial-tabs statistics-tabs" role="tablist" aria-label="Vistas de reportes">
      {getAllowedReportViews(permissions).map((view) => (
        <button
          key={view.id}
          type="button"
          role="tab"
          aria-selected={active === view.id}
          className={active === view.id ? "financial-tab is-active" : "financial-tab"}
          onClick={() => onSelect(view.id)}
        >
          {view.label}
        </button>
      ))}
    </div>
  );
}

export default ReportsNav;
