import {BUSINESS_PERMISSIONS, hasBusinessPermission} from "../domain/rbac.mjs";
import React, {useCallback, useMemo, useRef, useState} from "react";
import {useLocation, useNavigate} from "react-router-dom";
import {ArrowLeft, Save} from "lucide-react";
import Button from "../components/ui/Button";
import ClientSelector from "../features/clients/ClientSelector";
import VehicleFormFields from "../features/vehicles/VehicleFormFields";
import {buildVehicleMutationPayload, getVehicleFieldErrors, normalizeVehiclePlate} from "../domain/vehicleModel.mjs";
import {crearVehiculo, createVehicleRequestId, getVehicleErrorMessage, listarClientesSeleccionablesTaller} from "../services/vehicleService";

const EMPTY_VEHICLE = {patente: "", vin: "", marca: "", modelo: "", anio: "", color: "", tipo: ""};
// Desde «Nueva orden de trabajo» se llega con la patente buscada y, al guardar, se vuelve a esa pantalla con el
// vehículo ya seleccionado. Solo se acepta esa ruta de vuelta.
const NEW_WORK_ORDER_PATH = "/taller/ordenes/nueva";


function NewVehiclePage({businessId, role}) {
  const navigate = useNavigate();
  const location = useLocation();
  const returnToOrder = location.state?.returnTo === NEW_WORK_ORDER_PATH;
  const requestIdRef = useRef("");
  const [values, setValues] = useState(() => ({
    ...EMPTY_VEHICLE, patente: returnToOrder ? normalizeVehiclePlate(location.state?.patente) : "",
  }));
  const [owner, setOwner] = useState(null);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [saving, setSaving] = useState(false);
  const canCreate = hasBusinessPermission(role, BUSINESS_PERMISSIONS.TALLER_CREATE);
  const ownerError = errors.clienteId;
  const selectedOwnerId = owner?.clienteId || "";
  const formErrors = useMemo(() => ({...errors, clienteId: undefined}), [errors]);
  const handleOwnerChange = useCallback((client) => {
    requestIdRef.current = "";
    setOwner(client);
    setErrors((current) => ({...current, clienteId: undefined}));
  }, []);

  const update = (field, value) => {
    requestIdRef.current = "";
    setValues((current) => ({...current, [field]: value}));
    setErrors((current) => ({...current, [field]: undefined}));
    setServerError("");
  };
  const submit = async (event) => {
    event.preventDefault();
    const nextErrors = getVehicleFieldErrors({...values, clienteId: selectedOwnerId}, {requiresOwner: true, countryCode: role?.paisCodigo || "CL"});
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    if (saving) return;
    if (!requestIdRef.current) requestIdRef.current = createVehicleRequestId();
    setSaving(true);
    setServerError("");
    try {
      const vehicle = await crearVehiculo(businessId, selectedOwnerId, buildVehicleMutationPayload(values), requestIdRef.current);
      requestIdRef.current = "";
      if (returnToOrder) navigate(NEW_WORK_ORDER_PATH, {replace: true, state: {vehiculoId: vehicle.vehiculoId}});
      else navigate(`/taller/vehiculos/${vehicle.vehiculoId}`, {replace: true, state: {feedback: "Vehículo creado correctamente."}});
    } catch (saveError) {
      setServerError(getVehicleErrorMessage(saveError));
    } finally { setSaving(false); }
  };

  if (!canCreate) return <main className="erp-page"><div className="erp-empty-state" role="alert">Tu membresía no permite crear vehículos en el negocio activo.</div></main>;
  return <main className="erp-page vehicles-page"><header className="erp-page-header"><div className="erp-page-header__content"><h1 className="erp-page-header__title">Nuevo vehículo</h1><p className="erp-page-header__description">{returnToOrder ? "Registra el vehículo y asigna su propietario. Al guardar volverás a la nueva orden de trabajo con el vehículo seleccionado." : "Registra un vehículo y asigna su propietario actual."}</p></div></header><form className="erp-panel vehicle-form" onSubmit={submit} noValidate><section><h2 className="erp-panel-title">Propietario actual</h2><ClientSelector businessId={businessId} loadClients={listarClientesSeleccionablesTaller} nameOnly value={owner} snapshot={owner} onChange={handleOwnerChange} />{ownerError && <p className="vehicle-field-error" role="alert">{ownerError}</p>}</section><section><h2 className="erp-panel-title">Datos del vehículo</h2><VehicleFormFields countryCode={role?.paisCodigo || "CL"} values={values} errors={formErrors} onChange={update} /></section>{serverError && <div className="vehicle-message vehicle-message--error" role="alert">{serverError}</div>}<div className="vehicle-form-actions"><Button type="button" variant="secondary" icon={ArrowLeft} disabled={saving} onClick={() => navigate(returnToOrder ? NEW_WORK_ORDER_PATH : "/taller/vehiculos")}>Volver</Button><Button type="submit" icon={Save} disabled={saving}>{saving ? "Guardando..." : "Guardar vehículo"}</Button></div></form></main>;
}

export default NewVehiclePage;
