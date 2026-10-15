import React, {useMemo, useState} from "react";
import {MapPin, MapPinOff} from "lucide-react";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {canAssignWorkshopPlazas, deriveWorkshopPlazaOccupancy} from "../../domain/workshopPlazaModel.mjs";
import {listarOrdenesTrabajo} from "../../services/workOrderService";
import {
  asignarPlazaOT,
  getWorkshopPlazaErrorMessage,
  liberarPlazaOT,
} from "../../services/workshopPlazaService";

const TERMINAL_STATES = new Set(["cerrada", "cancelada"]);

export default function WorkOrderPlazaControl({businessId, onChanged, order, plazas, role}) {
  const canOperate = canAssignWorkshopPlazas(role) && !TERMINAL_STATES.has(order.estado);
  const [dialog, setDialog] = useState(null);
  const [orders, setOrders] = useState([]);
  const [selectedPlazaId, setSelectedPlazaId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const occupancy = useMemo(() => deriveWorkshopPlazaOccupancy(plazas, orders), [orders, plazas]);
  const options = useMemo(() => plazas.filter((plaza) => {
    if (plaza.estado !== "activa") return false;
    const occupied = occupancy.get(plaza.plazaId)?.order;
    return !occupied || occupied.otId === order.otId;
  }), [occupancy, order.otId, plazas]);

  const openAssign = async () => {
    setDialog("assign"); setSelectedPlazaId(order.plazaId || ""); setError(""); setLoading(true);
    try { setOrders(await listarOrdenesTrabajo(businessId)); }
    catch (failure) { setError(getWorkshopPlazaErrorMessage(failure)); }
    finally { setLoading(false); }
  };

  const assign = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!selectedPlazaId) { setError("Selecciona una Plaza activa y disponible."); return; }
    setBusy(true); setError("");
    try {
      await asignarPlazaOT(businessId, order.otId, selectedPlazaId, order.actualizadoEn?.toMillis?.());
      setDialog(null); await onChanged();
    } catch (failure) { setError(getWorkshopPlazaErrorMessage(failure)); }
    finally { setBusy(false); }
  };

  const release = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await liberarPlazaOT(businessId, order.otId, order.actualizadoEn?.toMillis?.());
      setDialog(null); await onChanged();
    } catch (failure) { setError(getWorkshopPlazaErrorMessage(failure)); }
    finally { setBusy(false); }
  };

  if (!canOperate) return null;
  return <>
    <Button type="button" variant="secondary" icon={MapPin} onClick={openAssign}>{order.plazaId ? "Cambiar Plaza" : "Asignar Plaza"}</Button>
    {order.plazaId && <Button type="button" variant="secondary" icon={MapPinOff} onClick={() => {setError(""); setDialog("release");}}>Liberar Plaza</Button>}
    <ResponsiveDialog open={dialog === "assign"} onClose={() => !busy && setDialog(null)} size="small" eyebrow={order.numeroOT} title={order.plazaId ? "Cambiar Plaza" : "Asignar Plaza"} description="Solo se muestran Plazas activas que no están asociadas a otra OT activa." footer={<><Button type="button" variant="secondary" disabled={busy} onClick={() => setDialog(null)}>Cancelar</Button><Button type="submit" form="work-order-plaza-form" disabled={busy || loading}>{busy ? "Asignando..." : order.plazaId ? "Confirmar cambio" : "Asignar Plaza"}</Button></>}>
      <form id="work-order-plaza-form" className="vehicle-form" onSubmit={assign} noValidate><label className="erp-field"><span className="erp-field__label">Plaza *</span><select className="erp-control" disabled={loading} value={selectedPlazaId} onChange={(event) => {setSelectedPlazaId(event.target.value); setError("");}}><option value="">{loading ? "Cargando Plazas..." : "Selecciona una Plaza"}</option>{options.map((plaza) => <option key={plaza.plazaId} value={plaza.plazaId}>{plaza.nombre}</option>)}</select></label>{!loading && !options.length && <div className="erp-empty-state">No hay Plazas activas disponibles.</div>}{error && <div className="vehicle-message vehicle-message--error" role="alert">{error}</div>}</form>
    </ResponsiveDialog>
    <ResponsiveDialog open={dialog === "release"} onClose={() => !busy && setDialog(null)} size="small" eyebrow={order.numeroOT} title="Liberar Plaza" description="La OT continuará existiendo sin una Plaza asignada." footer={<><Button type="button" variant="secondary" disabled={busy} onClick={() => setDialog(null)}>Cancelar</Button><Button type="button" disabled={busy} onClick={release}>{busy ? "Liberando..." : "Liberar Plaza"}</Button></>}>
      <p>¿Confirmas que deseas liberar la Plaza actual de esta orden de trabajo?</p>{error && <div className="vehicle-message vehicle-message--error" role="alert">{error}</div>}
    </ResponsiveDialog>
  </>;
}
