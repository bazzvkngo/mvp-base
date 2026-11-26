import React from "react";
import DocumentItemsEditor from "../../components/ui/DocumentItemsEditor";

// Ítems de la compra (borrador): el bloque compartido en modo "compra" (costo unitario). La compra además edita el costo
// y el descuento por línea; los manejadores y los campos son los de siempre. Con referencias bloqueadas (la compra viene
// de una orden o una recepción) no se agrega ni se quita.
export default function PurchaseItemsEditor({
  disabled,
  items,
  onChange,
  onOpenCatalog,
  onScanProduct,
  readOnly,
  referencesLocked = false,
  moneyStep = "any",
}) {
  return (
    <DocumentItemsEditor
      canChange={!disabled && !referencesLocked}
      disabled={disabled}
      items={items}
      mode="compra"
      moneyStep={moneyStep}
      onChange={onChange}
      onOpenCatalog={onOpenCatalog}
      onScanProduct={onScanProduct}
      readOnly={readOnly}
      title="¿Qué compras?"
      titleId="purchase-items-title"
    />
  );
}
