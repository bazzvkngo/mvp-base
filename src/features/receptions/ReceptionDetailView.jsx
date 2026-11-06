import {ArrowLeft} from "lucide-react";
import {useNavigate} from "react-router-dom";
import Button from "../../components/ui/Button";
import StatusBadge from "../../components/ui/StatusBadge";
import SupplyTrace from "../../components/ui/SupplyTrace";
import {getReceptionStatusLabel} from "../../domain/receptionModel.mjs";
import {formatDate, formatMoney} from "../../utils/formatters";
import "./receptions.css";

const ITEM_TYPE_LABELS = {producto: "Producto", servicio: "Servicio", actividad: "Actividad"};
const hasDocumentValue = (value) => value !== "" && value !== null && value !== undefined;

// Detalle de una recepción confirmada o cancelada: solo lectura, sin campos deshabilitados.
// El borrador sigue usando el formulario de NewReceptionPage.
export default function ReceptionDetailView({linkedPurchase, message, reception}) {
  const navigate = useNavigate();
  const confirmed = reception.estado === "confirmada";
  const items = Array.isArray(reception.items) ? reception.items : [];
  const receivedProducts = items.some((line) => line.tipoItem === "producto" && Number(line.cantidad) > 0);
  const receivedServices = items.some((line) => line.tipoItem !== "producto" && Number(line.cantidad) > 0);
  const source = reception.documentoOrigen;
  const money = (value, currency) => formatMoney(value, currency || reception.moneda, reception.locale);
  const documentTypeLabel = source?.tipoDocumento === "factura" ? "Factura" : source?.tipoDocumento === "boleta" ? "Boleta" : "Documento";

  return <main className="po-workspace reception-detail">
    <section className="po-panel reception-detail__context">
      <div className="reception-detail__top">
        <Button type="button" variant="secondary" icon={ArrowLeft} onClick={() => navigate("/recepciones")}>Volver al historial</Button>
      </div>
      <span className="po-kicker">Recepción</span>
      <div className="reception-detail__title">
        <h1>{reception.numero}</h1>
        <span className={`po-status po-status--${reception.estado}`}>{getReceptionStatusLabel(reception.estado)}</span>
      </div>
      <dl className="reception-detail__facts">
        <div><dt>Proveedor</dt><dd>{reception.proveedorSnapshot?.razonSocial || "—"}</dd></div>
        <div><dt>Fecha de recepción</dt><dd>{formatDate(reception.fechaRecepcion, reception.locale)}</dd></div>
      </dl>
    </section>

    {message && <p className="po-message po-message--error">{message}</p>}

    {confirmed && <section className="reception-success" role="status" aria-live="polite">
      <div className="reception-success__copy"><span className="reception-success__eyebrow">Recepción confirmada</span><p>{receivedProducts ? "Los productos recibidos actualizaron existencias." : "Esta recepción no incluía productos; no hubo cambios de existencias."}</p>{receivedServices && <p>Los servicios y actividades recibidos quedaron confirmados.</p>}<p className="reception-success__next">{reception.compraId ? <>{reception.compraEstado === "revertida" ? `La compra fue revertida${reception.compraReversionMotivo ? `: ${reception.compraReversionMotivo}` : "."}` : "La compra se registró automáticamente."} <button type="button" className="po-inline-link" onClick={() => navigate(`/compras/${reception.compraId}`)}>Ver compra {reception.compraNumero || linkedPurchase?.numero || ""}</button></> : "Esta recepción histórica conserva el vínculo económico previo de su orden."}</p></div>
    </section>}

    <SupplyTrace currentType="reception" order={{id: reception.ordenCompraId, numero: reception.ordenCompraNumero}} receptions={[{...reception, compraId: "", compraNumero: ""}]} />

    {reception.observaciones && <section className="po-panel reception-detail__notes">
      <h2>Observaciones</h2>
      <p>{reception.observaciones}</p>
    </section>}

    <section className="po-panel">
      <h2 className="reception-detail__heading">Ítems de la recepción</h2>
      {source && <div className="reception-document-source"><div><span>Documento conciliado</span><strong>{source.nombreArchivo}</strong></div><div><span>Documento</span><strong>{documentTypeLabel}{source.numeroDocumento ? ` N° ${source.numeroDocumento}` : ""}</strong></div>{hasDocumentValue(source.neto) && <div><span>Neto</span><strong>{money(source.neto, source.moneda)}</strong></div>}{hasDocumentValue(source.impuestoMonto) && <div><span>{hasDocumentValue(source.impuestoPorcentaje) ? `IVA (${source.impuestoPorcentaje}%)` : "IVA"}</span><strong>{money(source.impuestoMonto, source.moneda)}</strong></div>}{hasDocumentValue(source.total) && <div><span>Total</span><strong>{money(source.total, source.moneda)}</strong></div>}<div><span>Conciliación</span><strong>{source.lineasAplicadas || 0} de {source.lineasDetectadas || 0} líneas aplicadas</strong></div></div>}
      <div className="reception-detail__items">
        <table className="reception-detail__table">
          <thead><tr><th scope="col">Ítem</th><th scope="col">Solicitado</th><th scope="col">{confirmed ? "Recibido" : "Preparado"}</th><th scope="col">Costo unitario (neto)</th><th scope="col">Desc. %</th></tr></thead>
          <tbody>{items.map((line) => <tr key={line.lineaId}>
            <td className="reception-detail__item" data-label="Ítem">
              <div className="reception-detail__item-title"><strong title={line.nombre}>{line.nombre}</strong><StatusBadge variant="neutral">{ITEM_TYPE_LABELS[line.tipoItem] || "Ítem"} · {line.unidad}</StatusBadge></div>
              {line.documentoLineas?.length > 0 && <small>Asociado desde documento</small>}
            </td>
            <td data-label="Solicitado">{line.cantidadSolicitada}</td>
            <td data-label={confirmed ? "Recibido" : "Preparado"}>{line.cantidad}</td>
            <td data-label="Costo unitario (neto)">{money(line.costoUnitario)}</td>
            <td data-label="Desc. %">{Number(line.descuentoPct) > 0 ? `${line.descuentoPct}%` : "—"}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  </main>;
}
