import React from "react";
import {resolveDocumentCompany} from "../../domain/companySnapshot.mjs";
import {formatMoney} from "../../utils/formatters";

const status = (value) => ({borrador: "Pendiente", emitida: "Emitida", cancelada: "Cancelada"})[value] || "Pendiente";
const payment = (value) => ({contado: "Contado", transferencia: "Transferencia", credito: "Crédito", otro: "Otro"})[value] || value;

export default function PurchaseOrderPrintView({company: liveCompany = {}, order}) {
  const company = resolveDocumentCompany(order, liveCompany);
  const money = (value) => formatMoney(value, order.moneda, order.locale);
  const discountMoney = (value) => Number(value) > 0 ? `-${money(value)}` : money(0);
  const provider = order.proveedorSnapshot || {};
  const brand = company.nombreComercial || company.razonSocial || "Empresa compradora";
  return (
    <article className="po-document-preview">
      <header className="po-document-preview__header">
        <div className="po-document-preview__company">
          {company.logoUrl && <img src={company.logoUrl} alt="" />}
          <div><h2>{brand}</h2><p>{company.razonSocial !== brand ? company.razonSocial : ""}</p><p>{company.identificadorFiscalValor || company.rut ? `${company.identificadorFiscalTipo || "Identificación fiscal"} ${company.identificadorFiscalValor || company.rut}` : ""}</p><p>{[company.direccion, company.comunaNombre || company.ciudad, company.regionEstado || company.regionNombre || company.region].filter(Boolean).join(" · ")}</p><p>{[company.email, company.telefono].filter(Boolean).join(" · ")}</p></div>
        </div>
        <div className="po-document-preview__meta"><span>ORDEN DE COMPRA</span><strong>{order.numero}</strong><b>{status(order.estado)}</b><small>Fecha {order.fechaEmision || "—"}</small></div>
      </header>
      <section className="po-document-preview__provider-grid">
        <div><h3>Proveedor</h3><strong>{provider.razonSocial || "Proveedor no seleccionado"}</strong><p>{provider.rut ? `RUT ${provider.rut}` : ""}</p><p>{provider.personaContacto ? `Contacto: ${provider.personaContacto}` : ""}</p><p>{[provider.email, provider.telefono].filter(Boolean).join(" · ")}</p><p>{[provider.direccion, provider.comunaNombre, provider.regionNombre].filter(Boolean).join(", ")}</p></div>
        <div><h3>Entrega y condiciones</h3><p><strong>Entrega estimada:</strong> {order.fechaEntregaEstimada || "No informada"}</p><p><strong>Dirección:</strong> {order.direccionEntrega || "No informada"}</p><p><strong>Pago:</strong> {payment(order.condicionesPago || provider.condicionesPago) || "No informado"}</p><p><strong>Moneda:</strong> {order.moneda || "CLP"}</p></div>
      </section>
      <div className="po-document-preview__table-wrap"><table><thead><tr><th>Código</th><th>Producto, servicio o actividad</th><th className="numeric">Cantidad</th><th className="numeric">Costo unitario</th><th className="numeric">Desc.</th><th className="numeric">Total</th></tr></thead><tbody>{order.items.map((item) => <tr key={item.lineaId}><td>{item.codigo || "—"}</td><td><strong>{item.nombre}</strong>{item.descripcion && <span>{item.descripcion}</span>}</td><td className="numeric">{item.cantidad} {item.unidad}</td><td className="numeric">{money(item.costoUnitario)}</td><td className="numeric">{item.descuentoPct ? `${item.descuentoPct}%` : "—"}</td><td className="numeric"><strong>{money(item.totalLinea)}</strong></td></tr>)}</tbody></table></div>
      <section className="po-document-preview__totals"><div><span>Subtotal</span><strong>{money(order.subtotal)}</strong></div><div><span>Descuentos</span><strong>{discountMoney(order.descuentoTotal)}</strong></div><div><span>Neto</span><strong>{money(order.neto)}</strong></div><div><span>{order.impuestoNombre || "IVA"} {Number(order.tasaIva || 0) * 100}%</span><strong>{money(order.iva)}</strong></div><div className="po-document-preview__total"><span>Total</span><strong>{money(order.total)}</strong></div></section>
      {(order.condicionesPago || order.observaciones) && <section className="po-document-preview__notes">{order.condicionesPago && <div><h3>Condiciones</h3><p>{payment(order.condicionesPago)}</p></div>}{order.observaciones && <div><h3>Observaciones</h3><p>{order.observaciones}</p></div>}</section>}
      <footer><span>{[company.responsable, company.telefono, company.email].filter(Boolean).join(" · ") || brand}</span><span>{brand} · ValoraCloud</span></footer>
    </article>
  );
}
