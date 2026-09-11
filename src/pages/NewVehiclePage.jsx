import React, {useCallback, useMemo, useState} from "react";
import {useNavigate} from "react-router-dom";
import {ArrowLeft, Save} from "lucide-react";
import Button from "../components/ui/Button";
import ClientSelector from "../features/clients/ClientSelector";
import VehicleFormFields from "../features/vehicles/VehicleFormFields";
import {buildVehicleMutationPayload, getVehicleFieldErrors} from "../domain/vehicleModel.mjs";
import {crearVehiculo, getVehicleErrorMessage} from "../services/vehicleService";

const EMPTY_VEHICLE = {patente: "", vin: "", marca: "", modelo: "", anio: "", color: "", tipo: ""};
const MANAGE_ROLES = new Set(["OWNER", "ADMIN"]);

function NewVehiclePage({businessId, role}) {
  const navigate = useNavigate();
  const [values, setValues] = useState(EMPTY_VEHICLE);
  const [owner, setOwner] = useState(null);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [saving, setSaving] = useState(false);
  const canManage = MANAGE_ROLES.has(String(role || "").toUpperCase());
  const ownerError = errors.clienteId;
  const selectedOwnerId = owner?.clienteId || "";
  const formErrors = useMemo(() => ({...errors, clienteId: undefined}), [errors]);
  const handleOwnerChange = useCallback((client) => {
    setOwner(client);
    setErrors((current) => ({...current, clienteId: undefined}));
  }, []);

  const update = (field, value) => {
    setValues((current) => ({...current, [field]: value}));
    setErrors((current) => ({...current, [field]: undefined}));
    setServerError("");
  };
  const submit = async (event) => {
    event.preventDefault();
    const nextErrors = getVehicleFieldErrors({...values, clienteId: selectedOwnerId}, {requiresOwner: true});
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    setServerError("");
    try {
      const vehicle = await crearVehiculo(businessId, selectedOwnerId, buildVehicleMutationPayload(values));
      navigate(`/taller/vehiculos/${vehicle.vehiculoId}`, {replace: true, state: {feedback: "Vehículo creado correctamente."}});
    } catch (saveError) {
      setServerError(getVehicleErrorMessage(saveError));
    } finally { setSaving(false); }
  };

  if (!canManage) return <main className="erp-page"><div className="erp-empty-state" role="alert">Tu membresía no permite crear vehículos en el negocio activo.</div></main>;
  return <main className="erp-page vehicles-page"><header className="erp-page-header"><div className="erp-page-header__content"><h1 className="erp-page-header__title">Nuevo vehículo</h1><p className="erp-page-header__description">Registra un vehículo y asigna su propietario actual.</p></div></header><form className="erp-panel vehicle-form" onSubmit={submit} noValidate><section><h2 className="erp-panel-title">Propietario actual</h2><ClientSelector businessId={businessId} value={owner} snapshot={owner} onChange={handleOwnerChange} />{ownerError && <p className="vehicle-field-error" role="alert">{ownerError}</p>}</section><section><h2 className="erp-panel-title">Datos del vehículo</h2><VehicleFormFields values={values} errors={formErrors} onChange={update} /></section>{serverError && <div className="vehicle-message vehicle-message--error" role="alert">{serverError}</div>}<div className="vehicle-form-actions"><Button type="button" variant="secondary" icon={ArrowLeft} disabled={saving} onClick={() => navigate("/taller/vehiculos")}>Volver</Button><Button type="submit" icon={Save} disabled={saving}>{saving ? "Guardando..." : "Guardar vehículo"}</Button></div></form></main>;
}

export default NewVehiclePage;
