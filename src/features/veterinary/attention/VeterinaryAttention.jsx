import React, {useEffect, useId, useState} from "react";
import {ArrowLeft} from "lucide-react";
import {Link, useNavigate, useParams} from "react-router-dom";
import Button from "../../../components/ui/Button";
import LoadingState from "../../../components/ui/LoadingState";
import {auth} from "../../../firebase/firebaseConfig";
import useBusinessFormat from "../../../hooks/useBusinessFormat";
import {formatDate} from "../../../utils/formatters";
import {
  FOLLOW_UP_ERROR_FIELDS,
  followUpPayload,
  getFollowUpFieldErrors,
  VeterinaryClinicalFollowUpFields,
  VeterinaryClinicalFollowUpSummary,
} from "./VeterinaryClinicalFollowUp";
import VeterinaryPhotoMap from "./VeterinaryPhotoMap";
import VeterinaryPrescriptions from "./VeterinaryPrescriptions";
import {triageLabels} from "../agenda/VeterinaryReceptionForm";
import {subscribeToInventory} from "../../../services/inventoryService";
import {
  consultarPacientesVeterinariosAsignados,
  guardarAtencionVeterinaria,
  listarCatalogoVeterinarioParaAtencion,
  listarProfesionalesDerivacionVeterinaria,
  operarOrdenVeterinaria,
  subscribeToVeterinaryAttentions,
} from "../data/veterinaryDataService";
import VeterinaryField from "../VeterinaryField";
import {getVeterinaryAttentionFieldErrors} from "../domain/attentionModel.mjs";
import {getVeterinaryClinicalClosureFieldErrors, VETERINARY_CLINICAL_OUTCOME_LABELS} from "../domain/clinicalClosureModel.mjs";
import {buildVeterinaryInventoryCatalog} from "../domain/inventoryPharmacyIntegrationModel.mjs";
import "../veterinary-lists.css";

const PENDING_ITEM_MESSAGE = "Tienes un ítem seleccionado sin añadir. Pulsa «Añadir ítem» o quita la selección antes de cerrar la atención.";
const REQUIRED_SALE_ITEM_MESSAGE = "Añade al menos un servicio o producto de Inventario para cerrar la atención y preparar la venta.";

const fields = [
  ["motivoConsulta", "Motivo de consulta", 1000, true, "Describe por qué se atiende al paciente"],
  ["diagnostico", "Diagnóstico", 4000, true, "Registra el diagnóstico y los hallazgos relevantes"],
  ["tratamiento", "Tratamiento", 4000, true, "Describe el tratamiento realizado o indicado"],
  ["indicaciones", "Indicaciones", 4000, false, "Anota los cuidados y controles para el tutor"],
];

// Ítems del borrador guardado: solo itemId y cantidad; nombre, tipo y unidad vuelven a leerse de Inventario.
// Un ítem que ya no está activo en Inventario se omite y se avisa.
function restoreDraftItems(draftItems, catalog) {
  const items = [];
  let missing = 0;
  for (const {itemId, cantidad} of draftItems ?? []) {
    const entry = catalog.find((candidate) => candidate.itemId === itemId);
    if (entry) items.push({...entry, cantidad});
    else missing += 1;
  }
  return {items, missing};
}

function PriorAttentions({history, historyError}) {
  const headingId = useId();
  const {locale} = useBusinessFormat();
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>Antecedentes clínicos</h2>
      {historyError ? <p className="erp-secondary-text">{historyError}</p> : history.length === 0 ? (
        <p className="erp-secondary-text">El paciente aún no tiene atenciones anteriores finalizadas.</p>
      ) : (
        <>
          <p className="erp-secondary-text">
            Hasta tres atenciones finalizadas, de la más reciente a la más antigua.
          </p>
          <ul className="veterinary-record-list">
            {history.map((record) => (
              <li key={record.id}>
                <p><strong>{record.motivoConsulta || "Atención veterinaria"}</strong>
                  {" · "}{formatDate(record.finalizadaEn || record.iniciadaEn, locale)}
                </p>
                {record.diagnostico && <p><strong>Diagnóstico:</strong> {record.diagnostico}</p>}
                {record.tratamiento && <p><strong>Tratamiento:</strong> {record.tratamiento}</p>}
                {record.indicaciones && <p><strong>Indicaciones:</strong> {record.indicaciones}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ClinicalForm({attention, businessId, inventory, history, historyError, assignedOnly}) {
  const navigate = useNavigate();
  const formId = useId();
  const patientPath = "/clinica-veterinaria/pacientes/" + encodeURIComponent(attention.pacienteId);
  const canReadSale = !assignedOnly;
  const [pendingPhotos, setPendingPhotos] = useState(false);
  const closed = attention.estado === "finalizada";
  const managedOrder = Boolean(attention.origen);
  const canEdit = attention.estado === "en_atencion" &&
    (!managedOrder || attention.profesionalUid === auth.currentUser?.uid);
  const [savingPrescription, setSavingPrescription] = useState(false);
  const persist = (operation, payload) => managedOrder
    ? operarOrdenVeterinaria(businessId, attention.id, operation, payload)
    : guardarAtencionVeterinaria(businessId, attention.citaId, operation, payload);
  const catalog = buildVeterinaryInventoryCatalog(inventory);
  const [restored] = useState(() => {
    if (closed || !attention.borrador) return null;
    // Sin inventario no se puede restaurar ni juzgar qué ítems faltan: se conservan en el borrador guardado.
    return inventory ? restoreDraftItems(attention.borrador.items, catalog) : {items: [], missing: 0};
  });
  const [form, setForm] = useState(() => {
    const draft = closed ? null : attention.borrador;
    return {
      ...attention,
      ...(draft ? Object.fromEntries([...fields.map(([name]) => name), "resultadoClinico"]
        .filter((name) => typeof draft[name] === "string").map((name) => [name, draft[name]])) : {}),
      ...(draft ? followUpPayload(draft) : {}),
      items: closed
        ? [...(attention.servicios ?? []), ...(attention.productos ?? [])]
        : restored?.items ?? [],
    };
  });
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftNotice, setDraftNotice] = useState("");
  const [draftError, setDraftError] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [pendingItemError, setPendingItemError] = useState(false);
  const [retryingSale, setRetryingSale] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [referralDirectory, setReferralDirectory] = useState(null);
  const [referralRetry, setReferralRetry] = useState(0);
  const needsReferralDirectory = canEdit && form.resultadoClinico === "derivacion" && form.derivacion?.tipo === "interna";
  const referralUnavailable = needsReferralDirectory && !referralDirectory?.professionals?.length;

  useEffect(() => {
    setReferralDirectory(null);
    if (!needsReferralDirectory) return undefined;
    let active = true;
    listarProfesionalesDerivacionVeterinaria(businessId, attention.id)
      .then((professionals) => { if (active) setReferralDirectory({professionals}); })
      .catch(() => { if (active) setReferralDirectory({error: "No se pudieron cargar los profesionales veterinarios."}); });
    return () => { active = false; };
  }, [attention.id, businessId, needsReferralDirectory, referralRetry]);

  const add = () => {
    const item = catalog.find((entry) => entry.itemId === itemId);
    if (!item || !Number.isFinite(Number(quantity)) || Number(quantity) <= 0) return;
    setForm((current) => ({...current, items: [...current.items, {...item, cantidad: Number(quantity)}]}));
    setItemId("");
    setQuantity("1");
    setPendingItemError(false);
    setDraftNotice("");
    setError((current) => current === REQUIRED_SALE_ITEM_MESSAGE ? "" : current);
  };
  const setValue = (name, value, ...relatedErrors) => {
    setForm((current) => ({...current, [name]: value}));
    setFieldErrors((current) => ({...current, ...Object.fromEntries([name, ...relatedErrors].map((field) => [field, undefined]))}));
    setDraftNotice("");
  };

  // Guarda lo escrito sin exigir los obligatorios; cerrar la atención sigue exigiéndolos.
  async function saveDraft() {
    if (saving || draftSaving || !canEdit) return;
    setDraftSaving(true);
    setDraftNotice("");
    setDraftError("");
    try {
      await persist("borrador", {
        ...Object.fromEntries(fields.map(([name]) => [name, form[name] ?? ""])),
        resultadoClinico: form.resultadoClinico ?? "",
        ...followUpPayload(form),
        // Sin inventario cargado no se envía la lista: el borrador conserva los ítems ya guardados.
        ...(inventory ? {items: form.items.map(({itemId, cantidad}) => ({itemId, cantidad}))} : {}),
      });
      setDraftNotice("Borrador guardado. Puedes cerrar esta pantalla y continuar después.");
    } catch (failure) {
      const code = String(failure?.code || "").replace(/^functions\//, "");
      setDraftError(["invalid-argument", "failed-precondition", "not-found", "permission-denied"].includes(code)
        ? failure.message : "No se pudo guardar el borrador. Intenta nuevamente.");
    } finally {
      setDraftSaving(false);
    }
  }

  async function close(event) {
    event.preventDefault();
    if (saving || draftSaving || !canEdit || pendingPhotos || savingPrescription || referralUnavailable) return;
    const formElement = event.currentTarget;
    setError("");
    const context = {
      citaId: attention.citaId,
      atencionId: managedOrder ? attention.id : undefined,
      pacienteId: attention.pacienteId,
    };
    const attentionErrors = getVeterinaryAttentionFieldErrors({...form, ...context});
    const nextErrors = Object.fromEntries(
      [...fields.map(([name]) => name), "resultadoClinico"].flatMap((name) => {
        const message = name === "resultadoClinico"
          ? getVeterinaryClinicalClosureFieldErrors({...context, resultadoClinico: form.resultadoClinico}).resultadoClinico
          : attentionErrors[name];
        return message ? [[name, message]] : [];
      })
    );
    Object.assign(nextErrors, getFollowUpFieldErrors(form, referralDirectory?.professionals));
    setFieldErrors(nextErrors);
    // Un ítem elegido sin pulsar "Añadir ítem" no se registraría: se avisa y no se cierra.
    const hasPendingItem = itemId !== "";
    setPendingItemError(hasPendingItem);
    const firstError = Object.keys(nextErrors)[0];
    if (firstError) {
      formElement.elements.namedItem(firstError)?.focus?.();
      return;
    }
    if (hasPendingItem) return;
    const saleItems = inventory ? form.items.map(({itemId, cantidad}) => ({itemId, cantidad})) : attention.borrador?.items ?? [];
    if (managedOrder && !saleItems.length) {
      setError(REQUIRED_SALE_ITEM_MESSAGE);
      return;
    }
    setSaving(true);
    try {
      await persist("cerrar", {
        ...Object.fromEntries(fields.map(([name]) => [name, form[name] ?? ""])),
        resultadoClinico: form.resultadoClinico,
        ...followUpPayload(form),
        items: saleItems,
      });
      navigate(patientPath, {replace: true});
    } catch (failure) {
      const code = String(failure?.code || "").replace(/^functions\//, "");
      const rejectedFields = FOLLOW_UP_ERROR_FIELDS.filter((name) => typeof failure?.details?.[name] === "string");
      const firstRejected = rejectedFields[0];
      if (firstRejected && formElement.elements.namedItem(firstRejected)) {
        setFieldErrors((current) => ({...current, ...Object.fromEntries(rejectedFields.map((name) => [name, failure.details[name]]))}));
        formElement.elements.namedItem(firstRejected).focus();
      } else {
        setError(["invalid-argument", "failed-precondition", "not-found", "permission-denied", "already-exists", "aborted"].includes(code)
          ? failure.message : "No se pudo cerrar la atención. Intenta nuevamente.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function retrySale() {
    if (retryingSale) return;
    setRetryingSale(true);
    setRetryError("");
    try {
      await persist("generarVenta", {});
    } catch (failure) {
      const code = String(failure?.code || "").replace(/^functions\//, "");
      setRetryError(["failed-precondition", "not-found", "permission-denied"].includes(code)
        ? failure.message : "No se pudo reintentar la creación de la venta.");
    } finally {
      setRetryingSale(false);
    }
  }

  const values = closed ? attention : form;
  const items = closed ? [...(attention.servicios ?? []), ...(attention.productos ?? [])] : form.items;
  return (
    <>
      <form id={formId} className="erp-panel erp-form" onSubmit={close} noValidate>
        <h1>{closed ? "Atención finalizada" : "Atención clínica"}</h1>
        <Link to={patientPath}>Ver ficha del paciente</Link>
        {closed && attention.ventaEstado && (
          <section>
            <h2>Venta de la atención</h2>
            {attention.ventaEstado === "pendiente" && <p role="status">Preparando la venta en borrador.</p>}
            {attention.ventaEstado === "generada" && (
              <>
                <p role="status">{attention.ventaNumero ? "Venta " + attention.ventaNumero + " creada." : "Venta creada."}</p>
                {canReadSale && attention.ventaId && <Link to={"/ventas/" + encodeURIComponent(attention.ventaId)}>Abrir venta</Link>}
              </>
            )}
            {attention.ventaEstado === "error" && (
              <>
                <p role="alert">{retryError || attention.ventaError || "No se pudo crear la venta. Revisa los datos y vuelve a intentar."}</p>
                {(canReadSale || attention.profesionalUid === auth.currentUser?.uid) && (
                  <Button type="button" variant="secondary" onClick={retrySale} loading={retryingSale}>Reintentar crear venta</Button>
                )}
              </>
            )}
          </section>
        )}
        {managedOrder && (
          <section>
            <h2>Datos de la orden</h2>
            <dl>
              <dt>Profesional a cargo</dt>
              <dd>{attention.profesionalNombre || "Sin asignar"}</dd>
              <dt>Box de atención</dt>
              <dd>{attention.box || "Sin asignar"}</dd>
              <dt>Tipo de atención</dt>
              <dd>{attention.tipoAtencion || "Sin asignar"}</dd>
            </dl>
            {!closed && !canEdit && <p>Solo el profesional asignado puede registrar la atención.</p>}
          </section>
        )}
        {!closed && <PriorAttentions history={history} historyError={historyError} />}
        {attention.recepcion && attention.triage && (
          <section>
            <h2>Recepción y triage</h2>
            <p>Llegada: {attention.recepcion.horaLlegada} · Prioridad: {triageLabels[attention.triage.prioridad]}</p>
            {attention.recepcion.observacionesRecepcion && <p>{attention.recepcion.observacionesRecepcion}</p>}
            {attention.triage.observacionesTriage && <p>{attention.triage.observacionesTriage}</p>}
            <ul>
              {attention.triage.pesoKg != null && <li>Peso: {attention.triage.pesoKg} kg</li>}
              {attention.triage.temperaturaC != null && <li>Temperatura: {attention.triage.temperaturaC} °C</li>}
              {attention.triage.frecuenciaCardiaca != null && <li>Frecuencia cardíaca: {attention.triage.frecuenciaCardiaca} lat/min</li>}
              {attention.triage.frecuenciaRespiratoria != null && <li>Frecuencia respiratoria: {attention.triage.frecuenciaRespiratoria} resp/min</li>}
            </ul>
          </section>
        )}
        <div className="erp-form-grid">
          {fields.map(([name, label, maxLength, required, placeholder]) => (
            <VeterinaryField key={name} label={label} required={required && canEdit} error={fieldErrors[name]}>
              <textarea className="erp-control" name={name} maxLength={maxLength} readOnly={!canEdit}
                placeholder={canEdit ? placeholder : undefined}
                value={values[name] ?? ""} onChange={({target}) => setValue(name, target.value)} />
            </VeterinaryField>
          ))}
          <VeterinaryField label="Resultado clínico" required={canEdit} error={fieldErrors.resultadoClinico}>
            <select className="erp-control" name="resultadoClinico" disabled={!canEdit} value={values.resultadoClinico ?? ""}
              onChange={({target}) => setValue("resultadoClinico", target.value, ...FOLLOW_UP_ERROR_FIELDS)}>
              <option value="">Selecciona un resultado</option>
              {Object.entries(VETERINARY_CLINICAL_OUTCOME_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </VeterinaryField>
        </div>
        {canEdit && <VeterinaryClinicalFollowUpFields values={values} fieldErrors={fieldErrors} onChange={setValue}
          professionals={referralDirectory?.professionals ?? null} directoryError={referralDirectory?.error}
          onRetry={() => setReferralRetry((current) => current + 1)} />}
        {closed && <VeterinaryClinicalFollowUpSummary attention={attention} />}
        {restored?.missing > 0 && <p role="status">{restored.missing === 1
          ? "1 ítem del borrador ya no está disponible en Inventario y se omitió."
          : restored.missing + " ítems del borrador ya no están disponibles en Inventario y se omitieron."}</p>}
        <h2>Servicios y productos utilizados</h2>
        {canEdit && <p>Los servicios, medicamentos y productos añadidos quedarán en una venta en borrador al cerrar. El stock se descuenta al confirmar en Ventas.</p>}
        {canEdit && inventory && (
          <div className="erp-form-grid">
            <label className="erp-field"><span>Ítem de inventario</span>
              <select className="erp-control" value={itemId} aria-invalid={pendingItemError} onChange={({target}) => {
                setItemId(target.value);
                setPendingItemError(false);
              }}>
                <option value="">Selecciona un ítem</option>
                {catalog.filter((item) => !items.some((selected) => selected.itemId === item.itemId)).map((item) =>
                  <option key={item.itemId} value={item.itemId}>{item.nombre} ({item.tipoItem})</option>
                )}
              </select>
            </label>
            <label className="erp-field"><span>Cantidad</span>
              <input className="erp-control" type="number" step="any" min="0" value={quantity} onChange={({target}) => setQuantity(target.value)} />
            </label>
            <Button type="button" disabled={!itemId || !(Number(quantity) > 0)} onClick={add}>Añadir ítem</Button>
          </div>
        )}
        {canEdit && !inventory && <p>No se pudo cargar el catálogo. Al cerrar se conservarán los ítems del borrador.</p>}
        {items.length > 0 && <ul>{items.map((item) => (
          <li key={item.itemId}>{item.nombre} · {item.cantidad} {item.unidad}
            {canEdit && <Button type="button" variant="secondary" aria-label={"Quitar " + item.nombre}
              onClick={() => { setForm((current) => ({...current, items: current.items.filter((entry) => entry.itemId !== item.itemId)})); setDraftNotice(""); }}>Quitar</Button>}
          </li>
        ))}</ul>}
      </form>
      {managedOrder && <VeterinaryPrescriptions attention={attention} businessId={businessId}
        assignedOnly={assignedOnly} canIssue={canEdit && !saving} onSavingChange={setSavingPrescription} />}
      <VeterinaryPhotoMap businessId={businessId} attention={attention} readOnly={!canEdit} onPendingChange={setPendingPhotos} />
      {canEdit && (
        <div className="erp-panel">
          {error && <p role="alert">{error}</p>}
          {draftError && <p role="alert">{draftError}</p>}
          {draftNotice && <p role="status">{draftNotice}</p>}
          {pendingItemError && <p className="veterinary-field-error" role="alert">{PENDING_ITEM_MESSAGE}</p>}
          {pendingPhotos && <p>Sube o quita las fotos pendientes antes de cerrar la atención.</p>}
          <Button type="button" variant="secondary" loading={draftSaving} disabled={saving} onClick={saveDraft}>Guardar borrador</Button>
          <Button type="submit" form={formId} loading={saving}
            disabled={pendingPhotos || draftSaving || savingPrescription || referralUnavailable}>Cerrar atención</Button>
        </div>
      )}
    </>
  );
}

export default function VeterinaryAttention({businessId, professionalUid}) {
  const {citaId, atencionId} = useParams();
  const navigate = useNavigate();
  const [attentions, setAttentions] = useState(null);
  // undefined = cargando, null = no se pudo consultar. El borrador necesita el catálogo para restaurar sus ítems.
  const [inventory, setInventory] = useState(undefined);
  const [assignedHistory, setAssignedHistory] = useState(null);
  const [assignedCatalog, setAssignedCatalog] = useState(null);
  const [error, setError] = useState("");
  const attention = attentions?.find((item) => item.id === (atencionId || citaId));
  const historyPatientId = professionalUid && attention?.estado === "en_atencion" ? attention.pacienteId : "";
  const catalogOrderId = professionalUid && attention?.estado === "en_atencion" ? attention.id : "";

  useEffect(() => {
    if (!businessId) return undefined;
    const stopAttention = subscribeToVeterinaryAttentions(
      businessId, setAttentions, () => setError("No se pudo consultar la atención."), professionalUid,
    );
    const stopInventory = !professionalUid ? subscribeToInventory(businessId, setInventory, () => setInventory(null)) : null;
    return () => {
      stopAttention();
      stopInventory?.();
    };
  }, [businessId, professionalUid]);

  useEffect(() => {
    if (!businessId || !historyPatientId) return undefined;
    let active = true;
    consultarPacientesVeterinariosAsignados(businessId, historyPatientId)
      .then(({attentions: history}) => { if (active) setAssignedHistory({patientId: historyPatientId, history}); })
      .catch(() => {
        if (active) setAssignedHistory({patientId: historyPatientId, error: "No se pudieron cargar los antecedentes. Intenta abrir la ficha del paciente."});
      });
    return () => { active = false; };
  }, [businessId, historyPatientId, professionalUid]);

  useEffect(() => {
    if (!businessId || !catalogOrderId) return undefined;
    let active = true;
    const setResult = (items) => {
      if (active) setAssignedCatalog({orderId: catalogOrderId, items});
    };
    listarCatalogoVeterinarioParaAtencion(businessId, catalogOrderId).then(setResult).catch(() => setResult(null));
    return () => { active = false; };
  }, [businessId, catalogOrderId, professionalUid]);

  if (!businessId || error) return <p role="alert">{error || "Selecciona una empresa activa."}</p>;
  const historyResult = assignedHistory?.patientId === historyPatientId ? assignedHistory : null;
  const activeInventory = !professionalUid ? inventory : catalogOrderId && assignedCatalog?.orderId === catalogOrderId
    ? assignedCatalog.items : null;
  if (!attentions || (!professionalUid && inventory === undefined) ||
      (historyPatientId && !historyResult) || (catalogOrderId && assignedCatalog?.orderId !== catalogOrderId)) {
    return <LoadingState variant="section" label="Cargando atención clínica..." />;
  }
  const previousAttentions = professionalUid ? (historyResult?.history ?? []).slice(0, 3)
    : attentions.filter((item) => attention && item.id !== attention.id && item.negocioId === businessId &&
      item.pacienteId === attention.pacienteId && item.estado === "finalizada")
      .sort((a, b) => (b.finalizadaEn?.toMillis?.() ?? b.iniciadaEn?.toMillis?.() ?? 0) -
        (a.finalizadaEn?.toMillis?.() ?? a.iniciadaEn?.toMillis?.() ?? 0)).slice(0, 3);

  const ordersPath = "/clinica-veterinaria/ordenes";
  const returnPath = atencionId ? ordersPath : "/clinica-veterinaria/citas/" + encodeURIComponent(citaId);
  return (
    <section className="erp-page">
      <nav aria-label="Clínica Veterinaria">
        <Button type="button" variant="secondary" icon={ArrowLeft} onClick={() => navigate(returnPath)}>
          {atencionId ? "Volver a órdenes" : "Volver a la cita"}
        </Button>
      </nav>
      {attention && ["en_atencion", "finalizada"].includes(attention.estado)
        ? <ClinicalForm key={attention.id} attention={attention} businessId={businessId}
          inventory={activeInventory} history={previousAttentions} historyError={historyResult?.error} assignedOnly={Boolean(professionalUid)} />
        : <div className="erp-empty-state">
          <p>{attention?.estado === "en_espera" ? "La atención todavía no ha comenzado."
            : attention?.estado === "cancelada" ? "La orden está cancelada." : "No se encontró la atención."}</p>
          {atencionId && attention?.estado === "en_espera" && (
            <Link to={ordersPath + "/" + encodeURIComponent(atencionId)}>Ver la orden</Link>
          )}
        </div>}
    </section>
  );
}
