import React from "react";
import DocumentItemsEditor from "../../components/ui/DocumentItemsEditor";

// Ítems de la orden de compra (borrador): el bloque compartido en modo "compra" (costo unitario), con "Escanear producto".
// Los manejadores, los campos y el escaneo son los de siempre.
export default function PurchaseOrderItemsEditor({disabled, items, moneyStep = "any", onChange, onOpenCatalog, onScanProduct, readOnly}) {
  return (
    <DocumentItemsEditor
      canChange={!disabled}
      disabled={disabled}
      items={items}
      mode="compra"
      moneyStep={moneyStep}
      onChange={onChange}
      onOpenCatalog={onOpenCatalog}
      onScanProduct={onScanProduct}
      readOnly={readOnly}
      title="¿Qué pides?"
      titleId="po-items-title"
    />
  );
}
