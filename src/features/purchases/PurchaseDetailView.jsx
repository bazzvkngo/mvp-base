import {useState} from "react";
import {Printer} from "lucide-react";
import {useNavigate} from "react-router-dom";
import Button from "../../components/ui/Button";
import Notice from "../../components/ui/Notice";
import StatusBadge from "../../components/ui/StatusBadge";
import {getCountryFormCopy} from "../../domain/countryFormCopy.mjs";
import {getFiscalIdentifierLabel} from "../../domain/fiscalIdentifier.mjs";
import {
  getPurchaseDocumentTypeLabel,
  getPurchaseStatusLabel,
  getPurchaseStockSemantics,
} from "../../domain/purchaseModel.mjs";
import {formatDate, formatMoney, formatTimestamp} from "../../utils/formatters";
import PurchasePrintView from "./PurchasePrintView";
import "./purchases.css";

const ITEM_TYPE_LABELS = {producto: "Producto", servicio: "Servicio", actividad: "Actividad"};
const hasText = (value) => Boolean(String(value ?? "").trim());
const visibleObservation = (value, purchase) => {
  const observation = String(value || "").trim();
  const generated = purchase?.recepcionNumero ? `Originada desde ${purchase.recepcionNumero}` : "";
  const normalized = observation.toLocaleLowerCase("es-CL");
  if (generated && normalized === generated.toLocaleLowerCase("es-CL")) return "";
  return /^originada desde recepci[oó]n$/.test(normalized) ? "" : observation;
};
const lineTotal = (line) => Number(line.cantidad || 0) * Number(line.costoUnitario || 0) *
  (1 - Number(line.descuentoPct || 0) / 100);

// Detalle de una compra confirmada, revertida o cancelada: solo lectura, sin campos deshabilitados.
// La compra en borrador (y la compra nueva) siguen usando el formulario de NewPurchasePage.
export default function PurchaseDetailView({company, message, printable, purchase}) {
  const navigate = useNavigate();
  const [previewOpen, setPreviewOpen] = useState(false);
  const stockSemantics = getPurchaseStockSemantics(purchase);
  const items = Array.isArray(purchase.items) ? purchase.items : [];
  const money = (value) => formatMoney(value, printable.moneda, printable.locale);
  const taxName = printable.impuestoNombre || "IVA";
  const taxRate = Number(printable.tasaIva || 0) * 100;
  const provider = purchase.proveedorSnapshot || {};
  const fiscalId = provider.identificadorFiscalValor || provider.rut;
  const providerDetails = [
    [provider.identificadorFiscalTipo || getFiscalIdentifierLabel(purchase.paisCodigo || company?.paisCodigo || "CL"), fiscalId],
    [getCountryFormCopy(purchase.paisCodigo || company?.paisCodigo).businessActivityLabel, provider.giro],
    ["Contacto", provider.personaContacto],
    ["Correo", provider.email],
    ["Teléfono", provider.telefono],
    ["Dirección", provider.direccion],
    ["Condiciones", provider.condicionesPago],
  ].filter(([, value]) => hasText(value));
  const hasDocument = purchase.tipoDocumento && purchase.tipoDocumento !== "sin_documento";
  const source = purchase.documentoOrigen || {};
  const documentValues = hasDocument ? [
    ["Documento", `${getPurchaseDocumentTypeLabel(purchase.tipoDocumento)}${purchase.numeroDocumentoProveedor ? ` N° ${purchase.numeroDocumentoProveedor}` : ""}`],
    ["Fecha", purchase.fechaDocumento ? formatDate(purchase.fechaDocumento, purchase.locale) : ""],
    ["Vencimiento", source.fechaVencimiento ? formatDate(source.fechaVencimiento, purchase.locale) : ""],
    ["Neto", money(source.neto ?? purchase.neto)],
    [taxName, money(source.impuestoMonto ?? purchase.iva)],
    ["Total", money(source.total ?? purchase.total)],
  ].filter(([, value]) => hasText(value)) : [];
  const conditions = purchase.condicionesPago;
  const observation = visibleObservation(purchase.observaciones, purchase);
  const discounts = Number(purchase.descuentoTotal || 0);
  const exempt = Number(purchase.montoExento || 0);
  const registeredAt = purchase.registradoEn ? formatTimestamp(purchase.registradoEn, printable.locale) : "";
  const reversedAt = purchase.revertidaEn ? formatTimestamp(purchase.revertidaEn, printable.locale) : "";

  return <main className="po-workspace purchase-detail">
    <div className="purchase-detail__screen no-print">
      {/* Un solo h1 por pantalla: el de la barra superior (navigation.js). Por eso el título va en un <p>. */}
      <header className="ui-doc-head">
        <div className="ui-doc-head__main">
          <button type="button" className="ui-doc-back" onClick={() => navigate("/compras")}>← Compras</button>
          <p className="ui-doc-head__title">{`Compra ${purchase.numero}`}</p>
          <span className={`po-status po-status--${purchase.estado}`}>{getPurchaseStatusLabel(purchase.estado)}</span>
        </div>
        <div className="ui-doc-head__side">
          <div className="ui-doc-head__meta">
            <span>{purchase.fechaCompra ? formatDate(purchase.fechaCompra, printable.locale) : "Sin fecha"}</span>
            <span>
              {purchase.recepcionId && <button type="button" className="po-inline-link" onClick={() => navigate(`/recepciones/${purchase.recepcionId}`)}>Recepción {purchase.recepcionNumero}</button>}
              {purchase.ordenCompraId && <button type="button" className="po-inline-link" onClick={() => navigate(`/ordenes-compra/${purchase.ordenCompraId}`)}>Orden de compra {purchase.ordenCompraNumero}</button>}
              {!purchase.recepcionId && !purchase.ordenCompraId && "Compra directa"}
            </span>
          </div>
          <div className="ui-doc-head__actions">
            <Button type="button" variant="secondary" icon={Printer} onClick={() => window.print()}>Imprimir</Button>
          </div>
        </div>
      </header>

      {message && <p className="po-message po-message--error">{message}</p>}

      {purchase.registroAutomatico && <section className="po-panel purchase-inventory-trace">
        <header><div><span className="po-kicker">Inventario</span><h2>Trazabilidad de entradas</h2></div>{registeredAt && <small>Compra registrada {registeredAt}</small>}</header>
        {purchase.efectosInventario.length > 0
          ? <ul className="purchase-movement-list">{purchase.efectosInventario.map((effect) => <li key={effect.movimientoEntradaId}><strong title={effect.nombre}>{effect.nombre}</strong><span>Entrada: {effect.cantidad} {effect.unidad}</span><span>Origen: {purchase.recepcionNumero || "Recepción asociada"}</span>{purchase.estado === "revertida" && <em>Entrada compensada por reversión</em>}</li>)}</ul>
          : <p className="purchase-empty-copy">Esta compra solo contiene servicios o actividades; no generó entradas de stock.</p>}
        {purchase.estado === "revertida" && <div className="purchase-reversal-note"><strong>Compra revertida</strong><span>{[reversedAt, purchase.reversionMotivo].filter(Boolean).join(" · ")}</span></div>}
      </section>}
      {purchase.estado === "confirmada" && purchase.stockAplicado &&
        items.some((item) => item.tipoItem === "producto") && (
        <p className="purchase-stock-note">El inventario se actualizó al confirmar esta compra.</p>
      )}
      {purchase.estado === "confirmada" && stockSemantics.kind === "reception" && (
        <p className="purchase-stock-note">El stock de esta compra fue gestionado mediante la recepción vinculada.</p>
      )}
      {purchase.estado === "revertida" && <p className="purchase-stock-note">La compra permanece en el historial y sus entradas de inventario fueron compensadas cuando correspondía.</p>}

      <section className="po-panel purchase-provider-card">
        <header><span className="po-kicker">Proveedor</span><h2>{provider.razonSocial || "Proveedor histórico"}</h2></header>
        {providerDetails.length > 0 && <dl>{providerDetails.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
      </section>

      <section className="po-panel">
        <h2 className="purchase-detail__heading">Ítems de la compra</h2>
        <div className="purchase-detail__items">
          {items.length === 0 ? <p className="purchase-empty-copy">Esta compra no tiene ítems.</p> : <table className="purchase-detail__table">
            <thead><tr><th scope="col">Ítem</th><th scope="col">Cantidad</th><th scope="col">Costo unitario (neto)</th><th scope="col">Desc. %</th><th scope="col">Total</th></tr></thead>
            <tbody>{items.map((line) => <tr key={line.lineaId}>
              <td className="purchase-detail__item" data-label="Ítem">
                <div className="purchase-detail__item-title"><strong title={line.nombre}>{line.nombre}</strong><StatusBadge variant="neutral">{ITEM_TYPE_LABELS[line.tipoItem] || "Producto"}{line.unidad ? ` · ${line.unidad}` : ""}</StatusBadge></div>
                {hasText(line.codigo) && <small>{line.codigo}</small>}
              </td>
              <td data-label="Cantidad">{line.cantidad}</td>
              <td data-label="Costo unitario (neto)">{money(line.costoUnitario)}</td>
              <td data-label="Desc. %">{Number(line.descuentoPct) > 0 ? `${line.descuentoPct}%` : "—"}</td>
              <td className="purchase-detail__total" data-label="Total">{money(lineTotal(line))}</td>
            </tr>)}</tbody>
          </table>}
        </div>
        <dl className="purchase-detail__totals">
          {discounts > 0 && <div><dt>Subtotal</dt><dd>{money(purchase.subtotal)}</dd></div>}
          {discounts > 0 && <div><dt>Descuentos</dt><dd>-{money(discounts)}</dd></div>}
          <div><dt>Neto</dt><dd>{money(purchase.neto)}</dd></div>
          {exempt > 0 && <div><dt>Exento</dt><dd>{money(exempt)}</dd></div>}
          <div><dt>{taxName} {taxRate}%</dt><dd>{money(purchase.iva)}</dd></div>
          <div className="purchase-detail__grand-total"><dt>Total</dt><dd>{money(purchase.total)}</dd></div>
        </dl>
      </section>

      <section className="po-panel purchase-data-panel" aria-labelledby="purchase-document-title">
        <header className="ui-section-head">
          <div><span className="po-kicker">Datos de compra</span><h2 id="purchase-document-title" className="ui-section-head__title">Documento y fechas</h2></div>
        </header>
        {hasDocument
          ? <dl className="purchase-document-summary">{documentValues.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          : <p className="purchase-empty-copy">No hay un documento asociado a esta compra.</p>}
        {hasDocument && source.coherenciaEstado === "revisar" && <section className="purchase-detail__totals-notice">
          <Notice variant="warning" role={null}>Los totales del documento no coinciden con las líneas.</Notice>
        </section>}
      </section>
      <section className="po-panel purchase-conditions-panel" aria-labelledby="purchase-conditions-title">
        <header className="ui-section-head">
          <div><span className="po-kicker">Condiciones</span><h2 id="purchase-conditions-title" className="ui-section-head__title">Condiciones comerciales</h2></div>
        </header>
        <div className="purchase-conditions-summary">
          <div><strong>Condiciones de pago</strong><p>{conditions || "Sin condiciones informadas."}</p></div>
          {observation && <div><strong>Observaciones</strong><p>{observation}</p></div>}
        </div>
      </section>
      <section className="po-panel purchase-preview-panel" aria-labelledby="purchase-preview-title">
        <header className="ui-section-head">
          <div><span className="po-kicker">Documento</span><h2 id="purchase-preview-title" className="ui-section-head__title">Vista previa imprimible</h2><p className="ui-section-head__hint">Revisa cómo se verá el documento.</p></div>
          <div className="ui-section-head__actions">
            {previewOpen && <Button type="button" variant="secondary" onClick={() => window.print()}>Imprimir</Button>}
            <Button type="button" variant="secondary" aria-expanded={previewOpen} onClick={() => setPreviewOpen((current) => !current)}>{previewOpen ? "Ocultar vista previa" : "Ver vista previa"}</Button>
          </div>
        </header>
        {previewOpen && <div className="purchase-preview-body"><PurchasePrintView company={company} purchase={printable} /></div>}
      </section>
    </div>
    <div className="print-only"><PurchasePrintView company={company} purchase={printable} /></div>
  </main>;
}
