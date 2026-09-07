import React from "react";

export const REPORT_VIEWS = Object.freeze([
  {id: "resumen", label: "Resumen"},
  {id: "ventas", label: "Ventas"},
  {id: "compras", label: "Compras"},
  {id: "inventario", label: "Inventario"},
  {id: "proyectos", label: "Proyectos"},
  {id: "ganancias", label: "Ganancias"},
]);

const VALID_VIEW_IDS = new Set(REPORT_VIEWS.map((view) => view.id));

export function normalizeReportView(value) {
  return VALID_VIEW_IDS.has(value) ? value : "resumen";
}

function ReportsNav({active, onSelect}) {
  return (
    <div className="financial-tabs statistics-tabs" role="tablist" aria-label="Vistas de reportes">
      {REPORT_VIEWS.map((view) => (
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
