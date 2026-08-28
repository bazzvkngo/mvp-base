import React, {useEffect, useMemo, useState} from "react";
import {Search} from "lucide-react";
import {useNavigate} from "react-router-dom";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import {canManageReceptions, getReceptionStatusLabel} from "../domain/receptionModel.mjs";
import {listarRecepciones} from "../services/receptionService";
import "../features/receptions/receptions.css";

const normalize = (value) => String(value || "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase();

const quantityLabel = (value) => Number(value || 0).toLocaleString("es-CL", {
  maximumFractionDigits: 6,
});

function unitLabel(value, total) {
  const unit = String(value || "unidad").trim();
  if (Number(total) === 1) return unit;
  return ({unidad: "unidades", hora: "horas", proyecto: "proyectos"})[normalize(unit)] || unit;
}

function receptionProgressLabel(entry) {
  const lines = Array.isArray(entry.items) ? entry.items : [];
  const units = new Set(lines.map((line) => normalize(line.unidad || "unidad")));
  if (units.size <= 1) {
    const received = lines.reduce((sum, line) => sum + Number(line.cantidad || 0), 0);
    const requested = lines.reduce((sum, line) => sum + Number(line.cantidadSolicitada || 0), 0);
    return `${quantityLabel(received)} / ${quantityLabel(requested)} ${unitLabel(lines[0]?.unidad, requested)}`;
  }
  const complete = lines.filter((line) =>
    Number(line.cantidad || 0) >= Number(line.cantidadSolicitada || 0) - 0.000001
  ).length;
  return `${complete} / ${lines.length} ${lines.length === 1 ? "línea completa" : "líneas completas"}`;
}

export default function ReceptionsPage({businessId, role}) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("todos");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const canManage = canManageReceptions(role);
  useEffect(() => {
    let active = true;
    listarRecepciones(businessId).then((values) => active && setItems(values))
      .catch((error) => active && setMessage(error.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [businessId]);
  const filtered = useMemo(() => items.filter((entry) => {
    const matchesStatus = status === "todos" || entry.estado === status;
    const haystack = normalize(`${entry.numero} ${entry.ordenCompraNumero} ${entry.proveedorSnapshot?.razonSocial}`);
    return matchesStatus && haystack.includes(normalize(search));
  }), [items, search, status]);
  const open = (entry) => navigate(entry.estado === "borrador" && canManage
    ? `/recepciones/${entry.id}/editar`
    : `/recepciones/${entry.id}`);
  return (
    <main className="erp-page po-history">
      <div className="erp-module-intro">
        <div className="erp-page-intro"><p>Confirma la recepción física; el inventario y la compra se registran automáticamente.</p></div>
        {canManage && <Button type="button" onClick={() => navigate("/ordenes-compra")}>Ver órdenes de compra</Button>}
      </div>
      {message && <p className="po-message po-message--error">{message}</p>}
      <section className="erp-panel erp-history-panel">
        <div className="erp-panel-header"><div><h2 className="erp-panel-title">Historial de recepciones</h2><p className="erp-secondary-text">{filtered.length} recepciones</p></div></div>
        <div className="erp-filters erp-history-filters po-history__toolbar">
          <label className="erp-field erp-history-search-field"><span className="erp-field__label">Buscar por recepcion, OC o proveedor</span><span className="clients-search-control"><AppIcon icon={Search} size={18} /><input className="erp-control" value={search} onChange={(event) => setSearch(event.target.value)} /></span></label>
          <label className="erp-field"><span className="erp-field__label">Estado</span><select className="erp-control" value={status} onChange={(event) => setStatus(event.target.value)}><option value="todos">Todos</option><option value="borrador">Preparadas</option><option value="confirmada">Recibidas</option><option value="cancelada">Canceladas</option></select></label>
        </div>
        {loading ? <div className="erp-empty-state">Cargando recepciones...</div> : <section className="erp-table-region">
          <table className="erp-table po-history__table"><thead><tr><th>Recepción</th><th>Proveedor</th><th>Origen OC</th><th>Fecha</th><th>Recibido</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
            {filtered.map((entry) => <tr key={entry.id}>
              <td><button type="button" className="po-inline-link" onClick={() => open(entry)}>{entry.numero}</button></td>
              <td><strong>{entry.proveedorSnapshot?.razonSocial || "Proveedor historico"}</strong></td>
              <td><button type="button" className="po-inline-link" onClick={() => navigate(`/ordenes-compra/${entry.ordenCompraId}`)}>{entry.ordenCompraNumero || "Abrir OC"}</button></td>
              <td>{entry.fechaRecepcion || "—"}</td>
              <td>{receptionProgressLabel(entry)}</td>
              <td><span className={`po-status po-status--${entry.estado}`}>{getReceptionStatusLabel(entry.estado)}</span></td>
              <td><div className="po-history__actions"><button type="button" onClick={() => open(entry)}>{entry.estado === "borrador" && canManage ? "Editar" : "Ver"}</button>{entry.compraId && <button type="button" onClick={() => navigate(`/compras/${entry.compraId}`)}>Abrir compra</button>}</div></td>
            </tr>)}
            {!filtered.length && <tr><td colSpan="7" className="po-history__empty">No hay recepciones coincidentes.</td></tr>}
          </tbody></table>
        </section>}
      </section>
    </main>
  );
}
