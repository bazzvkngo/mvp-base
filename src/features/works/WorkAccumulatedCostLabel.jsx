import React from "react";

// Rótulo único del costo acumulado, con la aclaración visible bajo el título (no como tooltip) para que también se lea
// en la tarjeta móvil. La Lista y el Tablero muestran los totales guardados en el trabajo (getWorkAccumulatedCost),
// que no incluyen los materiales de la Venta; la ficha suma además esos materiales (getWorkCostSummary con
// saleMaterials) y lo dice con `includesSaleMaterials`.
export default function WorkAccumulatedCostLabel({includesSaleMaterials = false}) {
  return <span className="works-cost-label">Costo acumulado<small className="works-cost-label__note">{includesSaleMaterials ? "incluye materiales de la Venta" : "sin materiales de la Venta"}</small></span>;
}
