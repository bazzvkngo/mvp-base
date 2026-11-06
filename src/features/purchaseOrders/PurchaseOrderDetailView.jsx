import {ArrowLeft, Download, Mail, PackageCheck} from "lucide-react";
import {useNavigate} from "react-router-dom";
import Button from "../../components/ui/Button";
import MoreActionsMenu from "../../components/ui/MoreActionsMenu";
import StatusBadge from "../../components/ui/StatusBadge";
import SupplyTrace from "../../components/ui/SupplyTrace";
import {getSupplierResponseLabel, getSupplierResponseState} from "../../domain/purchaseOrderModel.mjs";
import {getOrderReceptionStatusLabel} from "../../domain/receptionModel.mjs";
import {formatDate, formatMoney, formatTimestamp} from "../../utils/formatters";
import PurchaseOrderPrintView from "./PurchaseOrderPrintView";
import "./purchase-orders.css";
import "./purchase-order-detail.css";

const ITEM_TYPE_LABELS = {producto: "Producto", servicio: "Servicio", actividad: "Actividad"};
const PAYMENT_LABELS = {contado: "Contado", transferencia: "Transferencia", credito: "Crédito", otro: "Otro"};
const CHANNEL_LABELS = {correo: "correo", whatsapp: "WhatsApp", manual: "registro manual"};
// Textos de relleno que el sistema escribe cuando una persona no tiene nombre: no son nombres reales.
const PLACEHOLDER_NAMES = new Set(["sin nombre registrado", "nombre no informado", "usuario sin identificar", "usuario del negocio"]);
const hasText = (value) => Boolean(String(value ?? "").trim());
const realName = (value) => {
  const name = String(value || "").trim();
  return name && !PLACEHOLDER_NAMES.has(name.toLocaleLowerCase("es-CL")) ? name : "";
};
const lineTotal = (line) => Number(line.cantidad || 0) * Number(line.costoUnitario || 0) *
  (1 - Number(line.descuentoPct || 0) / 100);

// Detalle de una orden de compra emitida o cancelada: solo lectura, sin campos deshabilitados.
// El borrador y la orden nueva siguen usando el formulario de NewPurchaseOrderPage.
export default function PurchaseOrderDetailView({
  canDelete,
  canManage,
  company,
  currentUser,
  duplicating,
  memberByUid,
  message,
  onCancel,
  onCreateReception,
  onDelete,
  onDownloadPdf,
  onDuplicate,
  onEmail,
  onSupplierConfirmation,
  onWhatsApp,
  order,
  printableOrder,
  receptionActionLabel,
  receptionStatus,
  receptions,
  saving,
  totals,
  whatsAppAvailability,
}) {
  const navigate = useNavigate();
  const locale = printableOrder.locale || "es-CL";
  const money = (value) => formatMoney(value, printableOrder.moneda, locale);
  const taxName = printableOrder.impuestoNombre || "IVA";
  const taxRate = Number(printableOrder.tasaIva || 0) * 100;
  const cancelled = order.estado === "cancelada";
  const issued = order.estado === "emitida";
  const receptionCompleted = receptionStatus === "recibida_total";
  const supplierState = getSupplierResponseState(order);
  const items = Array.isArray(order.items) ? order.items : [];
  const provider = order.proveedorSnapshot || {};
  const discounts = Number(totals.descuentoTotal || 0);

  // Reglas de acciones: las mismas que tenía la cabecera del formulario.
  const canReceive = canManage && issued && !receptionCompleted;
  const canCancel = canManage && !cancelled && !receptionCompleted;
  const menuActions = [
    canReceive && supplierState !== "rechazada" && {label: "Registrar confirmación", onSelect: onSupplierConfirmation, disabled: saving},
    canManage && !cancelled && {label: issued ? "Reenviar por WhatsApp" : "WhatsApp", onSelect: onWhatsApp, disabled: saving || !whatsAppAvailability.enabled},
    {label: "Imprimir", onSelect: () => window.print()},
    canManage && {label: duplicating ? "Creando copia..." : "Duplicar como nueva orden", onSelect: onDuplicate, disabled: saving || duplicating},
    canCancel && {label: "Cancelar", onSelect: onCancel, disabled: saving},
    // Eliminar para siempre: solo órdenes nunca enviadas y para OWNER/ADMIN (decide la página y la Function).
    canDelete && {label: "Eliminar", onSelect: onDelete, disabled: saving},
  ].filter(Boolean);

  const actorLabel = (uid) => {
    const member = memberByUid.get(uid);
    const name = realName(member?.nombre);
    if (name) return name;
    const email = hasText(member?.correo) && member.correo !== "Sin correo disponible" ? member.correo : "";
    if (email) return email;
    if (uid && currentUser?.uid === uid) return realName(currentUser.displayName) || currentUser.email || "";
    return "";
  };
  const stamp = (value) => {
    const formatted = formatTimestamp(value, locale);
    return formatted === "-" ? "" : formatted;
  };
  const eventMeta = (value, who = "", extra = "") => [stamp(value), who, extra].filter(hasText).join(" · ");

  const response = order.respuestaProveedor || {};
  const showResponse = issued || (cancelled && supplierState !== "pendiente");
  const showTrace = receptions.length > 0 || issued;
  const paymentLabel = PAYMENT_LABELS[provider.condicionesPago] || provider.condicionesPago;
  const providerDetails = [
    [provider.identificadorFiscalTipo || "RUT", provider.identificadorFiscalValor || provider.rut],
    ["Contacto", provider.personaContacto],
    ["Correo", provider.email],
    ["Teléfono", provider.telefono],
    ["Dirección", [provider.direccion, provider.comunaNombre, provider.regionNombre].filter(hasText).join(", ")],
    ["Condiciones de pago", hasText(paymentLabel) ? `${paymentLabel}${provider.condicionesPago === "credito" && provider.diasCredito ? ` · ${provider.diasCredito} días` : ""}` : ""],
  ].filter(([, value]) => hasText(value));
  const hasDelivery = hasText(order.fechaEntregaEstimada) || hasText(order.direccionEntrega);
  const hasNotes = hasText(order.condicionesPago) || hasText(order.observaciones);

  return <>
    <div className="purchase-order-detail__screen no-print">
      <section className="po-panel purchase-order-detail__context">
        <div className="purchase-order-detail__top">
          <Button type="button" variant="secondary" icon={ArrowLeft} onClick={() => navigate("/ordenes-compra")}>Volver al historial</Button>
        </div>
        <span className="po-kicker">Orden de compra</span>
        <div className="purchase-order-detail__title">
          <h1>{order.numero}</h1>
          <span className={`po-status po-status--${order.estado}`}>{cancelled ? "Cancelada" : "Emitida"}</span>
        </div>
        <dl className="purchase-order-detail__facts">
          <div><dt>Proveedor</dt><dd>{provider.razonSocial || "Proveedor histórico"}</dd></div>
          <div><dt>Fecha de la orden</dt><dd>{formatDate(order.fechaEmision || order.creadoEn, locale)}</dd></div>
          <div><dt>Total</dt><dd>{money(totals.total)}</dd></div>
          <div><dt>Recepción</dt><dd>{cancelled ? "—" : getOrderReceptionStatusLabel(receptionStatus)}</dd></div>
        </dl>
        <div className="purchase-order-detail__actions" role="group" aria-label="Acciones de la orden">
          {canReceive && supplierState !== "rechazada" && <Button type="button" icon={PackageCheck} disabled={saving} onClick={onCreateReception}>{saving ? "Preparando..." : receptionActionLabel}</Button>}
          {canReceive && supplierState === "rechazada" && <Button type="button" icon={PackageCheck} disabled={saving} onClick={onSupplierConfirmation}>Actualizar confirmación</Button>}
          {canManage && issued && <Button type="button" variant="secondary" icon={Mail} disabled={saving} onClick={onEmail}>Reenviar correo</Button>}
          <Button type="button" variant="secondary" icon={Download} disabled={saving} onClick={onDownloadPdf}>Descargar PDF</Button>
          <MoreActionsMenu label="Más" menuLabel="Más acciones de la orden" actions={menuActions} />
        </div>
        {canManage && !cancelled && !whatsAppAvailability.enabled && <small className="purchase-order-detail__help">{whatsAppAvailability.help}</small>}
      </section>

      {message && <p className="po-message po-message--error">{message}</p>}

      {(showResponse || showTrace) && <section className="purchase-order-detail__flow" aria-label="Seguimiento de la orden">
        {showResponse && <div className="purchase-order-detail__response">
          <span>Confirmación del proveedor</span>
          <strong>{getSupplierResponseLabel(order)}</strong>
          {hasText(response.comentario) && <small>{response.comentario}</small>}
        </div>}
        {showTrace && <SupplyTrace currentType="order" order={order} receptions={receptions} />}
      </section>}

      <section className="po-panel purchase-order-detail__provider">
        <span className="po-kicker">Proveedor</span>
        <h2>{provider.razonSocial || "Proveedor histórico"}</h2>
        {providerDetails.length > 0 && <dl>{providerDetails.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
      </section>

      <section className="po-panel">
        <h2 className="purchase-order-detail__heading">Ítems de la orden</h2>
        <div className="purchase-order-detail__items">
          {items.length === 0 ? <p className="purchase-order-detail__empty">Esta orden no tiene ítems.</p> : <table className="purchase-order-detail__table">
            <thead><tr><th scope="col">Ítem</th><th scope="col">Cantidad</th><th scope="col">Costo unitario (neto)</th><th scope="col">Desc. %</th><th scope="col">Total</th></tr></thead>
            <tbody>{items.map((line) => <tr key={line.lineaId}>
              <td className="purchase-order-detail__item" data-label="Ítem">
                <div className="purchase-order-detail__item-title"><strong title={line.nombre}>{line.nombre}</strong><StatusBadge variant="neutral">{ITEM_TYPE_LABELS[line.tipoItem] || "Producto"} · {line.unidad || "unidad"}</StatusBadge></div>
                {hasText(line.codigo) && <small>{line.codigo}</small>}
                {hasText(line.descripcion) && <p>{line.descripcion}</p>}
              </td>
              <td data-label="Cantidad">{line.cantidad}</td>
              <td data-label="Costo unitario (neto)">{money(line.costoUnitario)}</td>
              <td data-label="Desc. %">{Number(line.descuentoPct) > 0 ? `${line.descuentoPct}%` : "—"}</td>
              <td className="purchase-order-detail__total" data-label="Total">{money(lineTotal(line))}</td>
            </tr>)}</tbody>
          </table>}
        </div>
        <dl className="purchase-order-detail__totals">
          {discounts > 0 && <div><dt>Subtotal</dt><dd>{money(totals.subtotal)}</dd></div>}
          {discounts > 0 && <div><dt>Descuentos</dt><dd>-{money(discounts)}</dd></div>}
          <div><dt>Neto</dt><dd>{money(totals.neto)}</dd></div>
          <div><dt>{taxName} {taxRate}%</dt><dd>{money(totals.iva)}</dd></div>
          <div className="purchase-order-detail__grand-total"><dt>Total</dt><dd>{money(totals.total)}</dd></div>
        </dl>
      </section>

      {hasDelivery && <section className="po-panel purchase-order-detail__notes">
        <h2>Entrega</h2>
        <dl>
          {hasText(order.fechaEntregaEstimada) && <div><dt>Fecha estimada</dt><dd>{formatDate(order.fechaEntregaEstimada, locale)}</dd></div>}
          {hasText(order.direccionEntrega) && <div><dt>Dirección de entrega</dt><dd>{order.direccionEntrega}</dd></div>}
        </dl>
      </section>}

      {hasNotes && <section className="po-panel purchase-order-detail__notes">
        <h2>Condiciones y observaciones</h2>
        <dl>
          {hasText(order.condicionesPago) && <div><dt>Condiciones de pago</dt><dd>{order.condicionesPago}</dd></div>}
          {hasText(order.observaciones) && <div><dt>Observaciones</dt><dd>{order.observaciones}</dd></div>}
        </dl>
      </section>}

      <section className="po-panel po-trace">
        <header><h2>Historial de la orden</h2></header>
        <ol>
          <li><strong>Creada</strong><span>{eventMeta(order.creadoEn || order.fechaEmision, actorLabel(order.creadoPorUid))}</span></li>
          {order.emitidaEn && <li><strong>Emitida por {CHANNEL_LABELS[order.canalEmision] || "canal registrado"}</strong><span>{eventMeta(order.emitidaEn, actorLabel(order.emitidaPorUid), order.destinatarioEmision)}</span></li>}
          {Number(order.cantidadEnvios || 0) > 1 && <li><strong>Reenviada por {CHANNEL_LABELS[order.ultimoCanalEnvio] || "canal registrado"}</strong><span>{eventMeta(order.reenviadaEn || order.ultimoEnvioEn, actorLabel(order.reenviadaPorUid || order.ultimoEnvioPorUid), order.ultimoDestinatarioEnvio)}</span></li>}
          {response.fecha && <li><strong>Confirmación del proveedor: {getSupplierResponseLabel(order)}</strong><span>{eventMeta(response.fecha, realName(response.registradaPorNombre) || response.registradaPorEmail)}</span></li>}
          {receptions.map((entry) => <li key={entry.id}><strong>{entry.estado === "confirmada" ? "Recepción confirmada" : entry.estado === "cancelada" ? "Recepción cancelada" : "Recepción creada"}</strong><span>{stamp(entry.confirmadoEn || entry.creadoEn)}{stamp(entry.confirmadoEn || entry.creadoEn) ? " · " : ""}<button type="button" onClick={() => navigate(`/recepciones/${entry.id}`)}>{entry.numero}</button></span></li>)}
          {cancelled && <li><strong>Cancelada</strong><span>{eventMeta(order.canceladaEn, actorLabel(order.canceladaPorUid))}</span></li>}
        </ol>
      </section>

      <details className="po-panel po-details">
        <summary>
          <span><strong>Vista previa imprimible</strong><small>Documento para el proveedor</small></span>
          <span className="po-details__indicator" aria-hidden="true" />
        </summary>
        <div className="po-preview-body"><PurchaseOrderPrintView company={company} order={printableOrder} /></div>
      </details>
    </div>
    <div className="print-only"><PurchaseOrderPrintView company={company} order={printableOrder} /></div>
  </>;
}
