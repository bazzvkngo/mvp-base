import React from "react";
import BarcodeInput from "./BarcodeInput";

// "Escanear producto": la acción principal de la fila de acciones de los listados de ítems y del inventario.
// Es el único botón de escaneo de producto: Inventario, Cotización, Venta, Orden de compra, Compra y Recepción lo usan,
// con el Button común en variante primaria (relleno con el color de acento). Va primero en la fila; en móvil ocupa todo
// el ancho (regla .ui-scan-product en components.css). Las demás acciones de la fila son secundarias.
// - continuous: cuadro abierto que acumula lecturas (por defecto); en Inventario, lectura única que abre la ficha.
// - onSubmit(barcode): recibe el código leído; puede devolver {key, label} para la lista de la sesión continua.
export const SCAN_PRODUCT_LABEL = "Escanear producto";

export default function ScanProductButton({continuous = true, disabled = false, onSubmit}) {
  return (
    <BarcodeInput
      actionOnly
      actionClassName="ui-scan-product"
      actionLabel={SCAN_PRODUCT_LABEL}
      actionVariant="primary"
      continuous={continuous}
      disabled={disabled}
      onSubmit={onSubmit}
    />
  );
}
