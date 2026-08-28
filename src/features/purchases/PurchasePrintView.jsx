import React from "react";
import {CubeIcon} from "../../components/BrandLogo";
import {resolveDocumentCompany} from "../../domain/companySnapshot.mjs";
import {getPurchaseDocumentTypeLabel, getPurchaseStatusLabel} from "../../domain/purchaseModel.mjs";
import {formatDate, formatMoney} from "../../utils/formatters";

const lineTotal = (item) => Number.isFinite(item.totalLinea)
  ? item.totalLinea
  : Math.round(Number(item.cantidad || 0) * Number(item.costoUnitario || 0)) -
    Math.round((Number(item.cantidad || 0) * Number(item.costoUnitario || 0) * Number(item.descuentoPct || 0)) / 100);
const hasText = (value) => Boolean(String(value ?? "").trim());
const joinNonEmpty = (values, separator = " · ") => values.filter(hasText).join(separator);
const itemTypeLabel = (value) => ({producto: "Producto", servicio: "Servicio", actividad: "Actividad"})[value] || "Ítem";

function OptionalLine({label, value}) {
  if (!hasText(value)) return null;
  return <p>{label && <strong>{label}: </strong>}{value}</p>;
}

function visibleObservation(purchase) {
  const value = String(purchase.observaciones || "").trim();
  if (!value) return "";
  const expected = purchase.recepcionNumero ? `Originada desde ${purchase.recepcionNumero}` : "";
  const normalized = value.toLocaleLowerCase("es-CL");
  if (expected && normalized === expected.toLocaleLowerCase("es-CL")) return "";
  return /^originada desde recepci[oó]n$/.test(normalized) ? "" : value;
}

function taxLabel(purchase) {
  const rate = new Intl.NumberFormat(purchase.locale || "es-CL", {maximumFractionDigits: 2})
    .format(Number(purchase.tasaIva || 0) * 100);
  return `${purchase.impuestoNombre || "Impuesto"} ${rate}%`;
}

export default function PurchasePrintView({company: liveCompany = {}, purchase}) {
  const company = resolveDocumentCompany(purchase, liveCompany);
  const provider = purchase.proveedorSnapshot || {};
  const items = Array.isArray(purchase.items) ? purchase.items : [];
  const sourceDocument = purchase.documentoOrigen || {};
  const money = (value) => formatMoney(value, purchase.moneda, purchase.locale);
  const brand = company.nombreComercial || company.razonSocial || "Empresa compradora";
  const observation = visibleObservation(purchase);
  const hasDocument = purchase.tipoDocumento !== "sin_documento";
  const documentNet = sourceDocument.neto ?? purchase.neto;
  const documentTax = sourceDocument.impuestoMonto ?? purchase.iva;
  const documentTotal = sourceDocument.total ?? purchase.total;
  const discounts = Number(purchase.descuentoTotal || 0);
  const conditions = [
    ["Condiciones de pago", purchase.condicionesPago],
    ["Observaciones", observation],
  ].filter(([, value]) => hasText(value));

  return <article className="po-document-preview purchase-document-preview">
    <header className="po-document-preview__header">
      <div className="po-document-preview__company">
        <div className="po-document-preview__logo">{company.logoUrl ? <img src={company.logoUrl} alt={`Logo ${brand}`} /> : <CubeIcon size={38} strokeWidth={1.6} />}</div>
        <div><h2>{brand}</h2>{company.razonSocial !== brand && <OptionalLine value={company.razonSocial} />}<OptionalLine label={company.identificadorFiscalTipo || "Identificación fiscal"} value={company.identificadorFiscalValor || company.rut} /><OptionalLine label="Giro" value={company.giro} /><OptionalLine value={joinNonEmpty([company.direccion, company.comunaNombre || company.ciudad, company.regionEstado || company.regionNombre])} /><OptionalLine value={joinNonEmpty([company.email, company.telefono])} /></div>
      </div>
      <div className="po-document-preview__identity"><span>Compra</span><strong>{purchase.numero || "Compra por asignar"}</strong><dl><div><dt>Fecha</dt><dd>{purchase.fechaCompra ? formatDate(purchase.fechaCompra, purchase.locale) : "-"}</dd></div><div><dt>Estado</dt><dd>{getPurchaseStatusLabel(purchase.estado || "borrador")}</dd></div><div><dt>Moneda</dt><dd>{purchase.moneda || "CLP"}</dd></div></dl></div>
    </header>

    <section className="po-document-preview__section po-document-preview__provider"><h3>Proveedor</h3><div className="po-document-preview__details-grid"><div><OptionalLine value={provider.razonSocial || "Proveedor no seleccionado"} /><OptionalLine label={provider.identificadorFiscalTipo || "Identificación fiscal"} value={provider.identificadorFiscalValor || provider.rut} /><OptionalLine label="Contacto" value={provider.personaContacto} /></div><div><OptionalLine value={joinNonEmpty([provider.email, provider.telefono])} /><OptionalLine value={joinNonEmpty([provider.direccion, provider.comunaNombre, provider.regionNombre], ", ")} /></div></div></section>

    {(purchase.ordenCompraNumero || purchase.recepcionNumero || hasDocument) && <div className="po-document-preview__commercial-grid purchase-document-preview__context">
      {(purchase.ordenCompraNumero || purchase.recepcionNumero) && <section className="po-document-preview__section"><h3>Origen</h3><dl>{purchase.ordenCompraNumero && <div><dt>Orden de compra</dt><dd>{purchase.ordenCompraNumero}</dd></div>}{purchase.recepcionNumero && <div><dt>Recepción</dt><dd>{purchase.recepcionNumero}</dd></div>}</dl></section>}
      {hasDocument && <section className="po-document-preview__section"><h3>Documento asociado</h3><dl><div><dt>Documento</dt><dd>{getPurchaseDocumentTypeLabel(purchase.tipoDocumento)}{purchase.numeroDocumentoProveedor ? ` N° ${purchase.numeroDocumentoProveedor}` : ""}</dd></div>{purchase.fechaDocumento && <div><dt>Fecha</dt><dd>{formatDate(purchase.fechaDocumento, purchase.locale)}</dd></div>}{sourceDocument.fechaVencimiento && <div><dt>Vencimiento</dt><dd>{formatDate(sourceDocument.fechaVencimiento, purchase.locale)}</dd></div>}<div><dt>Resumen</dt><dd>Neto {money(documentNet)} · {purchase.impuestoNombre || "IVA"} {money(documentTax)} · Total {money(documentTotal)}</dd></div></dl></section>}
    </div>}

    {items.length === 0 ? <div className="po-document-preview__empty">Agrega productos, servicios o actividades para completar la compra.</div> : <div className="po-document-preview__table-wrap"><table><thead><tr><th>Ítem</th><th>Unidad / naturaleza</th><th className="numeric">Cantidad</th><th className="numeric">Costo unitario</th><th className="numeric">Descuento</th><th className="numeric">Total</th></tr></thead><tbody>{items.map((item, index) => <tr key={item.lineaId || `${item.itemId}-${index}`}><td><strong>{item.nombre}</strong>{item.codigo && <span>{item.codigo}</span>}{item.descripcion && <span>{item.descripcion}</span>}</td><td>{itemTypeLabel(item.tipoItem)}<span>{item.unidad || "Sin unidad"}</span></td><td className="numeric">{item.cantidad}</td><td className="numeric">{money(item.costoUnitario)}</td><td className="numeric">{Number(item.descuentoPct || 0)}%</td><td className="numeric"><strong>{money(lineTotal(item))}</strong></td></tr>)}</tbody></table></div>}

    <section className="po-document-preview__totals"><TotalRow label="Subtotal" value={money(purchase.subtotal)} /><TotalRow label="Descuentos" value={discounts > 0 ? `-${money(discounts)}` : money(0)} /><TotalRow label="Neto" value={money(purchase.neto)} /><TotalRow label={taxLabel(purchase)} value={money(purchase.iva)} /><TotalRow label="Total" value={money(purchase.total)} strong /></section>
    {conditions.length > 0 && <section className="po-document-preview__section purchase-document-preview__footer-notes"><h3>Condiciones</h3><dl>{conditions.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>}
    <footer><span>{joinNonEmpty([company.responsable, company.telefono, company.email]) || brand}</span><span>{brand} · ValoraCloud</span></footer>
  </article>;
}

function TotalRow({label, value, strong = false}) {
  return <div className={strong ? "po-document-preview__total" : ""}><span>{label}</span><strong>{value}</strong></div>;
}
