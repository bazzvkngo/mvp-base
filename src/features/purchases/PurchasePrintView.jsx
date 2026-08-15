import React from "react";
import {getPurchaseDocumentTypeLabel, getPurchaseStatusLabel} from "../../domain/purchaseModel.mjs";
import {formatMoney} from "../../utils/formatters";
const lineTotal = (item) => Number.isFinite(item.totalLinea)
  ? item.totalLinea
  : Math.round(Number(item.cantidad || 0) * Number(item.costoUnitario || 0)) -
    Math.round((Number(item.cantidad || 0) * Number(item.costoUnitario || 0) * Number(item.descuentoPct || 0)) / 100);
export default function PurchasePrintView({company, purchase}) {
  const money = (value) => formatMoney(value, purchase.moneda, purchase.locale);
  return (
    <article className="po-print">
      <header><div><small>COMPRA</small><h1>{purchase.numero || "Compra por asignar"}</h1><p>{purchase.ordenCompraNumero ? `Originada desde ${purchase.ordenCompraNumero}` : "Compra directa"}</p></div><strong>{getPurchaseStatusLabel(purchase.estado || "borrador")}</strong></header>
      <div className="po-print__parties">
        <section><small>Empresa</small><strong>{company?.nombreComercial || company?.razonSocial || "Empresa"}</strong><p>{company?.identificadorFiscalValor || company?.rut || ""}</p></section>
        <section><small>Proveedor</small><strong>{purchase.proveedorSnapshot?.razonSocial || "—"}</strong><p>{purchase.proveedorSnapshot?.rut || ""}</p></section>
        <section><small>Documento</small><strong>{getPurchaseDocumentTypeLabel(purchase.tipoDocumento)}</strong>{purchase.tipoDocumento !== "sin_documento" && <p>{purchase.numeroDocumentoProveedor || "Sin número"}</p>}<p>{purchase.fechaCompra || "—"}</p></section>
      </div>
      <table><thead><tr><th>Ítem</th><th>Cantidad</th><th>Costo</th><th>Desc.</th><th>Total</th></tr></thead><tbody>{purchase.items?.map((item) => <tr key={item.lineaId}><td><strong>{item.nombre}</strong><small>{item.codigo}</small></td><td>{item.cantidad}</td><td>{money(item.costoUnitario)}</td><td>{item.descuentoPct}%</td><td>{money(lineTotal(item))}</td></tr>)}</tbody></table>
      <div className="po-print__totals"><div><span>Subtotal</span><strong>{money(purchase.subtotal)}</strong></div><div><span>Descuentos</span><strong>-{money(purchase.descuentoTotal)}</strong></div><div><span>Neto</span><strong>{money(purchase.neto)}</strong></div><div><span>{purchase.impuestoNombre || "IVA"} {Number(purchase.tasaIva || 0) * 100}%</span><strong>{money(purchase.iva)}</strong></div><div><span>Total</span><strong>{money(purchase.total)}</strong></div></div>
      {purchase.condicionesPago && <section><strong>Condiciones</strong><p>{purchase.condicionesPago}</p></section>}
      {purchase.observaciones && <section><strong>Observaciones</strong><p>{purchase.observaciones}</p></section>}
    </article>
  );
}
