import React from "react";
import BarcodeInput from "../../components/barcode/BarcodeInput";
import DocumentItemsEditor from "../../components/ui/DocumentItemsEditor";
import {getSaleItemTypeLabel} from "../../domain/saleModel.mjs";
import {useBusinessMoney} from "../../hooks/useBusinessFormat";
import {lineDescriptionToShow} from "./saleLineText.mjs";

const sameText = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

// Vista histórica (venta confirmada o cancelada): una fila por ítem con
// encabezados únicos. Sin stock actual: no es un dato de la venta.
function SoldItemsTable({items}) {
  const money = useBusinessMoney();
  return (
    <div className="sale-sold">
      <table className="sale-sold__table">
        <thead>
          <tr>
            <th scope="col">Ítem</th>
            <th scope="col">Código</th>
            <th scope="col">Cantidad</th>
            <th scope="col">Precio unitario</th>
            <th scope="col">Desc. %</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const discount = Number(item.descuentoPct || 0);
            const total = item.totalLinea ?? Number(item.cantidad || 0) * Number(item.precioUnitario || 0) * (1 - discount / 100);
            const showUnit = item.unidad && !sameText(item.unidad, "unidad");
            return (
              <tr key={item.lineaId}>
                <td className="sale-sold__item" data-label="Ítem">
                  <div className="sale-line-title">
                    <strong title={item.nombre}>{item.nombre}</strong>
                    <span className={`sale-item-type sale-item-type--${item.tipoItem}`}>{getSaleItemTypeLabel(item.tipoItem)}</span>
                    {item.origenAdicionalId && <span className="sale-item-type sale-item-type--adicional">Adicional</span>}
                  </div>
                  {item.descripcion && !sameText(item.descripcion, item.nombre) && <p className="sale-sold__description" title={item.descripcion}>{item.descripcion}</p>}
                </td>
                <td className="sale-sold__code" data-label="Código" title={item.codigo || undefined}>{item.codigo || "—"}</td>
                <td data-label="Cantidad" title={showUnit ? `${item.cantidad} ${item.unidad}` : undefined}>{item.cantidad}{showUnit ? ` ${item.unidad}` : ""}</td>
                <td data-label="Precio unitario">{money(item.precioUnitario)}</td>
                <td data-label="Desc. %">{discount > 0 ? `${discount}%` : "—"}</td>
                <td className="sale-sold__total" data-label="Total">{money(total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Ítems de la venta. Borrador: el bloque compartido en modo "venta" (precio unitario), con "Escanear producto" y "Agregar
// desde inventario". Aquí solo se conecta lo propio de Venta: "Disponible N" y el aviso de stock insuficiente (la regla
// del stock es la de siempre), la marca "Adicional" y el máximo de la cantidad cotizada. Venta confirmada o cancelada:
// tabla histórica (SoldItemsTable).
export default function SaleItemsEditor({disabled, historical = false, inventory, items, moneyStep = "any", onChange, onOpenCatalog, onScanProduct, readOnly, referencesLocked = false}) {
  const inventoryById = new Map(inventory.map((item) => [item.id, item]));
  const canChangeReferences = !disabled && !referencesLocked;
  const countLabel = items.length === 1 ? "1 ítem" : `${items.length} ítems`;

  if (historical) {
    return (
      <section className="po-panel">
        <header className="po-panel__header">
          <div>
            <span className="po-kicker">Detalle de venta</span>
            <h2>Ítems vendidos</h2>
            <p>{countLabel}</p>
          </div>
          {canChangeReferences && (
            <div className="po-header__actions">
              <BarcodeInput actionOnly continuous actionLabel="Escanear producto" onSubmit={onScanProduct} />
              <button type="button" className="po-button po-button--secondary" onClick={onOpenCatalog}>Agregar desde inventario</button>
            </div>
          )}
        </header>
        {!items.length ? <div className="po-empty">Agrega productos, servicios o actividades.</div> : <SoldItemsTable items={items} />}
      </section>
    );
  }

  // Stock conocido de un producto: solo entonces hay "Disponible N" o aviso de stock insuficiente.
  const stockOf = (item) => {
    const inventoryItem = inventoryById.get(item.itemId);
    const stock = inventoryItem ? Number(inventoryItem.stock) : Number.NaN;
    const known = item.tipoItem === "producto" && Number.isFinite(stock);
    return {known, stock, exceeds: known && Number(item.cantidad || 0) > stock};
  };

  return (
    <DocumentItemsEditor
      canChange={canChangeReferences}
      disabled={disabled}
      getDescription={lineDescriptionToShow}
      getLineMeta={(item) => {
        const {known, exceeds, stock} = stockOf(item);
        return known && !exceeds ? `Disponible ${stock}` : "";
      }}
      getMaxQuantity={(item) => (referencesLocked && item.cantidadCotizada != null ? item.cantidadCotizada : undefined)}
      items={items}
      mode="venta"
      moneyStep={moneyStep}
      onChange={onChange}
      onOpenCatalog={onOpenCatalog}
      onScanProduct={onScanProduct}
      readOnly={readOnly}
      renderLineAlert={(item) => {
        const {exceeds, stock} = stockOf(item);
        return exceeds ? (
          <div className="sale-stock-warning" role="alert">
            <strong>Stock insuficiente</strong>
            <span>Disponible: {stock} · Solicitado: {Number(item.cantidad || 0)}</span>
          </div>
        ) : null;
      }}
      renderTitleExtra={(item) => (item.origenAdicionalId ? <span className="sale-item-type sale-item-type--adicional">Adicional</span> : null)}
      title="¿Qué vendes?"
      titleId="sale-items-title"
    />
  );
}
