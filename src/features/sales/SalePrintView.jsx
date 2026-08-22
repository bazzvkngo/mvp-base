import React from "react";
import {CubeIcon} from "../../components/BrandLogo";
import {resolveDocumentCompany} from "../../domain/companySnapshot.mjs";
import {
  getSaleDocumentTypeLabel,
  getSaleItemTypeLabel,
  getSaleStatusLabel,
} from "../../domain/saleModel.mjs";
import {formatDate, formatMoney} from "../../utils/formatters";

const hasText = (value) => Boolean(String(value ?? "").trim());
const lineTotal = (item) => Number.isFinite(item.totalLinea)
  ? item.totalLinea
  : Math.round(Number(item.cantidad || 0) * Number(item.precioUnitario || 0))
    - Math.round((Number(item.cantidad || 0) * Number(item.precioUnitario || 0) * Number(item.descuentoPct || 0)) / 100);

function OptionalLine({label, value}) {
  if (!hasText(value)) return null;
  return <p>{label && <strong>{label}: </strong>}{value}</p>;
}

function TotalRow({label, strong = false, value}) {
  return <div className={strong ? "sale-document-preview__total--strong" : ""}><span>{label}</span><strong>{value}</strong></div>;
}

export default function SalePrintView({company: rawCompany, sale = {}}) {
  const money = (value) => formatMoney(value, sale.moneda, sale.locale);
  const company = resolveDocumentCompany(sale, rawCompany);
  const client = sale.clienteSnapshot || {};
  const brand = company.nombreComercial || company.razonSocial || "ValoraCloud";
  const saleDocumentType = sale.tipoDocumento || "sin_documento";
  const documentType = getSaleDocumentTypeLabel(saleDocumentType);
  const hasDocument = saleDocumentType !== "sin_documento";
  const discountTotal = Number(sale.descuentoTotal ?? (Number(sale.descuentoItems || 0) + Number(sale.descuento || 0)));
  const companyLocation = [company.direccion, company.ciudad || company.comunaNombre, company.region || company.regionNombre].filter(hasText).join(" · ");
  const clientLocation = [client.direccion, client.comunaNombre, client.regionNombre].filter(hasText).join(" · ");

  return (
    <article className="sale-document-preview">
      <style>{saleDocumentCss}</style>
      <header className="sale-document-preview__header">
        <div className="sale-document-preview__company">
          <div className="sale-document-preview__logo">
            {company.logoUrl ? <img src={company.logoUrl} alt={`Logo ${brand}`} /> : <CubeIcon size={38} strokeWidth={1.6} style={{color: "#07285d"}} />}
          </div>
          <div>
            <h2>{brand}</h2>
            {company.razonSocial !== brand && <OptionalLine value={company.razonSocial} />}
            <OptionalLine label={company.identificadorFiscalTipo || "Identificación fiscal"} value={company.identificadorFiscalValor || company.rut} />
            <OptionalLine value={companyLocation} />
            <OptionalLine value={[company.email, company.telefono].filter(hasText).join(" · ")} />
          </div>
        </div>
        <div className="sale-document-preview__meta">
          <span>VENTA</span>
          <strong>N° {sale.numero || "Por asignar"}</strong>
          <small>Fecha {formatDate(sale.fechaVenta)}</small>
          <b>{getSaleStatusLabel(sale.estado || "borrador")}</b>
          {sale.cotizacionNumero && <small>Originada desde {sale.cotizacionNumero}</small>}
        </div>
      </header>

      <section className="sale-document-preview__info-grid">
        <div>
          <h3>Cliente</h3>
          <OptionalLine value={client.nombreRazonSocial} />
          <OptionalLine label="RUT" value={client.rut} />
          <OptionalLine label="Contacto" value={client.personaContacto} />
          <OptionalLine value={[client.email, client.telefono].filter(hasText).join(" · ")} />
          <OptionalLine value={clientLocation} />
        </div>
        <div>
          <h3>Datos de venta</h3>
          <OptionalLine label="Documento" value={documentType} />
          {hasDocument && <OptionalLine label="Número" value={sale.numeroDocumento || "Sin número"} />}
          <OptionalLine label="Fecha de venta" value={formatDate(sale.fechaVenta)} />
          {hasDocument && <OptionalLine label="Fecha documento" value={formatDate(sale.fechaDocumento)} />}
        </div>
      </section>

      {!sale.items?.length ? (
        <div className="sale-document-preview__empty">Agrega ítems para visualizar el documento formal.</div>
      ) : (
        <div className="sale-document-preview__table-wrap">
          <table>
            <thead><tr><th>Código</th><th>Producto, servicio o actividad</th><th>Unidad</th><th className="numeric">Cant.</th><th className="numeric">P. unitario</th><th className="numeric">Desc.</th><th className="numeric">Total</th></tr></thead>
            <tbody>
              {sale.items.map((item, index) => (
                <tr key={item.lineaId || `${item.itemId}-${index}`}>
                  <td>{item.codigo || index + 1}</td>
                  <td><strong>{item.nombre}</strong><span>{getSaleItemTypeLabel(item.tipoItem)}{item.descripcion ? ` · ${item.descripcion}` : ""}</span></td>
                  <td>{item.unidad || "—"}</td>
                  <td className="numeric">{item.cantidad}</td>
                  <td className="numeric">{money(item.precioUnitario)}</td>
                  <td className="numeric">{Number(item.descuentoPct || 0) ? `${item.descuentoPct}%` : "—"}</td>
                  <td className="numeric"><strong>{money(lineTotal(item))}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="sale-document-preview__totals">
        <TotalRow label="Subtotal" value={money(sale.subtotal)} />
        {discountTotal > 0 && <TotalRow label="Descuentos" value={`-${money(discountTotal)}`} />}
        <TotalRow label="Neto" value={money(sale.neto)} />
        <TotalRow label={sale.afectaIva ? `${sale.impuestoNombre || "IVA"} ${Number(sale.tasaIva || 0) * 100}%` : `${sale.impuestoNombre || "Impuesto"} (exenta)`} value={money(sale.iva)} />
        <TotalRow label="Total" value={money(sale.total)} strong />
      </div>

      {sale.condicionesPago && <section className="sale-document-preview__section"><h3>Condiciones comerciales</h3><p>{sale.condicionesPago}</p></section>}
      {sale.observaciones && <section className="sale-document-preview__section"><h3>Observaciones</h3><p>{sale.observaciones}</p></section>}

      <footer>
        <span>{[company.responsable, company.telefono, company.email].filter(hasText).join(" · ") || brand}</span>
        <span>{brand} · ValoraCloud</span>
      </footer>
    </article>
  );
}

const saleDocumentCss = `
.sale-document-preview{background:#fff;border:1px solid #d3dce9;border-radius:8px;box-sizing:border-box;color:#141f32;font:14px/1.45 Arial,Helvetica,sans-serif;margin:0 auto;max-width:920px;padding:30px;width:100%}.sale-document-preview p{margin:2px 0;overflow-wrap:anywhere}.sale-document-preview__header{align-items:flex-start;border-bottom:3px solid #07285d;display:flex;gap:24px;justify-content:space-between;padding-bottom:16px;position:relative}.sale-document-preview__header:after{background:#d22430;bottom:-3px;content:"";height:3px;left:0;position:absolute;width:92px}.sale-document-preview__company{display:flex;gap:14px;min-width:0}.sale-document-preview__company h2{color:#07285d;font-size:24px;margin:0 0 4px}.sale-document-preview__logo{align-items:center;display:flex;justify-content:center;min-height:58px;width:100px}.sale-document-preview__logo img{max-height:58px;max-width:100%;object-fit:contain}.sale-document-preview__meta{display:grid;gap:3px;text-align:right}.sale-document-preview__meta>span{font-size:20px;font-weight:800}.sale-document-preview__meta>strong{color:#d22430;font-size:17px}.sale-document-preview__meta>b{color:#07285d;margin-top:3px}.sale-document-preview__info-grid{background:#f4f7fb;border:1px solid #d3dce9;border-radius:6px;display:grid;grid-template-columns:1fr 1fr;margin:20px 0;padding:15px}.sale-document-preview__info-grid>div+div{border-left:1px solid #d3dce9;padding-left:18px}.sale-document-preview h3{color:#07285d;font-size:13px;margin:0 0 7px;text-transform:uppercase}.sale-document-preview__table-wrap{max-width:100%;overflow-x:auto}.sale-document-preview table{border-collapse:collapse;font-size:12px;min-width:660px;width:100%}.sale-document-preview th{background:#07285d;color:#fff;padding:9px 7px;text-align:left}.sale-document-preview td{border:1px solid #d3dce9;padding:9px 7px;vertical-align:top}.sale-document-preview tbody tr:nth-child(even){background:#f7f9fc}.sale-document-preview td span{color:#4f5d75;display:block;margin-top:3px;white-space:pre-wrap}.sale-document-preview .numeric{text-align:right;white-space:nowrap}.sale-document-preview__totals{background:#f4f7fb;border:1px solid #d3dce9;border-radius:6px;margin:18px 0 18px auto;max-width:340px;padding:8px 14px}.sale-document-preview__totals>div{border-bottom:1px solid #d3dce9;display:flex;gap:18px;justify-content:space-between;padding:7px 0}.sale-document-preview__totals>div:last-child{border:0}.sale-document-preview__total--strong{background:#07285d;color:#fff;margin:3px -14px -8px;padding:10px 14px!important}.sale-document-preview__section{break-inside:avoid;border-top:1px solid #d3dce9;margin-top:18px;padding-top:14px}.sale-document-preview__section p{white-space:pre-wrap}.sale-document-preview footer{border-top:1px solid #d3dce9;color:#4f5d75;display:flex;font-size:11px;gap:20px;justify-content:space-between;margin-top:30px;padding-top:10px}.sale-document-preview__empty{background:#f4f7fb;border:1px dashed #9daabd;border-radius:6px;padding:20px;text-align:center}@media(max-width:720px){.sale-document-preview{padding:18px}.sale-document-preview__header{display:grid}.sale-document-preview__meta{text-align:left}.sale-document-preview__info-grid{grid-template-columns:1fr}.sale-document-preview__info-grid>div+div{border-left:0;border-top:1px solid #d3dce9;margin-top:12px;padding-left:0;padding-top:12px}.sale-document-preview footer{display:grid}}@media print{.sale-document-preview{border:0;border-radius:0;box-shadow:none;max-width:none;padding:0}.sale-document-preview__table-wrap{overflow:visible}.sale-document-preview table{min-width:0}.sale-document-preview thead{display:table-header-group}.sale-document-preview footer{position:static}}
`;
