import React from "react";

const CELL_WIDTHS = ["70%", "55%", "85%", "45%", "65%"];

function toCount(value, fallback, max) {
  const count = Number(value);
  return Number.isInteger(count) && count > 0 ? Math.min(count, max) : fallback;
}

function toCssSize(value) {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return undefined;
}

function joinClasses(...classes) {
  return classes.filter(Boolean).join(" ");
}

// Bloque decorativo: nunca aporta texto accesible. El anuncio lo hace
// SkeletonRegion, que agrupa los bloques.
function Skeleton({ variant = "line", width, height, className = "" }) {
  const variantModifier = variant === "block" ? "block" : "line";
  const style = {};
  const cssWidth = toCssSize(width);
  const cssHeight = toCssSize(height);
  if (cssWidth !== undefined) style.width = cssWidth;
  if (cssHeight !== undefined) style.height = cssHeight;

  return (
    <span
      className={joinClasses("ui-skeleton", `ui-skeleton--${variantModifier}`, className)}
      style={Object.keys(style).length ? style : undefined}
      aria-hidden="true"
    />
  );
}

// Patrón con hermanos: el texto de estado NO va dentro del contenedor
// aria-busy, porque algunos lectores retienen los anuncios de una región
// ocupada. El texto visible del skeleton se oculta con aria-hidden.
export function SkeletonRegion({ label, className = "", children }) {
  const text = typeof label === "string" ? label : "";

  return (
    <div className={joinClasses("ui-skeleton-region", className)}>
      <span className="sr-only" role="status">{text}</span>
      <div aria-busy="true" aria-hidden="true">{children}</div>
    </div>
  );
}

// Reutiliza erp-table-region y erp-table para heredar padding y alturas de
// fila de las tablas reales. La página pasa su propia clase responsiva
// (erp-desktop-only, po-history__desktop…) en className.
export function SkeletonTable({
  columns = 5,
  rows = 8,
  twoLine = false,
  className = "",
}) {
  const columnIndexes = Array.from({ length: toCount(columns, 5, 12) }, (_, index) => index);
  const rowIndexes = Array.from({ length: toCount(rows, 8, 30) }, (_, index) => index);

  return (
    <div className={joinClasses("erp-table-region", className)}>
      <table className="erp-table ui-skeleton-table">
        <thead>
          <tr>
            {columnIndexes.map((column) => (
              <th key={column}><Skeleton width="50%" /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowIndexes.map((row) => (
            <tr key={row}>
              {columnIndexes.map((column) => (
                <td key={column}>
                  <Skeleton width={CELL_WIDTHS[(column + row) % CELL_WIDTHS.length]} />
                  {twoLine && column === 0 && <Skeleton width="45%" />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Lado móvil de una tabla. La visibilidad la decide la clase de la página
// (erp-card-list erp-mobile-only, po-history__cards…).
export function SkeletonCards({ count = 4, className = "" }) {
  const cardIndexes = Array.from({ length: toCount(count, 4, 12) }, (_, index) => index);

  return (
    <div className={joinClasses("ui-skeleton-cards", className)}>
      {cardIndexes.map((card) => (
        <div className="ui-skeleton-card" key={card}>
          <div className="ui-skeleton-card__header">
            <Skeleton width="55%" />
            <Skeleton variant="block" width="20%" height="var(--space-6)" />
          </div>
          <Skeleton width="90%" />
          <Skeleton width="75%" />
          <Skeleton width="60%" />
        </div>
      ))}
    </div>
  );
}

export default Skeleton;
