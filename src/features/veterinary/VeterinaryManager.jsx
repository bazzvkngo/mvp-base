import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import { Activity, PawPrint, Plus, CalendarDays, ClipboardList } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/ui/Button";
import EmptyState from "../../components/ui/EmptyState";
import LoadingState from "../../components/ui/LoadingState";
import ModuleHeader from "../../components/ui/ModuleHeader";
import VeterinaryDailyAppointments from "./agenda/VeterinaryDailyAppointments";
import useVeterinaryPatientDirectory from "./useVeterinaryPatientDirectory";
import "./veterinary-lists.css";

import {
  subscribeToInventory,
} from "../../services/inventoryService";

import {
  subscribeToVeterinaryAppointments,
  subscribeToVeterinaryAttentions,
  subscribeToVeterinaryPatients,
} from "./data/veterinaryDataService";

import {
  getVeterinaryPharmacyProducts,
  getVeterinaryServicesFromInventory,
} from "./domain/inventoryPharmacyIntegrationModel.mjs";


function VeterinaryManager({
  businessId,
}) {
  const navigate = useNavigate();
  const [
    inventoryItems,
    setInventoryItems,
  ] = useState([]);

  const [
    loadingInventory,
    setLoadingInventory,
  ] = useState(true);

  const [
    inventoryError,
    setInventoryError,
  ] = useState("");


  const [
    patients,
    setPatients,
  ] = useState([]);

  const [
    appointments,
    setAppointments,
  ] = useState([]);

  const [
    attentions,
    setAttentions,
  ] = useState([]);

  const [
    loadingVeterinaryData,
    setLoadingVeterinaryData,
  ] = useState(true);

  const [
    veterinaryDataError,
    setVeterinaryDataError,
  ] = useState("");


  useEffect(() => {
    if (!businessId) {
      setInventoryItems([]);
      setLoadingInventory(false);
      setInventoryError("");

      return undefined;
    }

    setLoadingInventory(true);
    setInventoryError("");

    return subscribeToInventory(
      businessId,

      (items) => {
        setInventoryItems(items);
        setLoadingInventory(false);
        setInventoryError("");
      },

      (error) => {
        console.error(
          "Error al cargar inventario para Clínica Veterinaria:",
          error?.code,
          error?.message
        );

        setInventoryItems([]);
        setLoadingInventory(false);
        setInventoryError(
          "No se pudo cargar el inventario del negocio."
        );
      }
    );
  }, [businessId]);


  useEffect(() => {
    if (!businessId) {
      setPatients([]);
      setAppointments([]);
      setAttentions([]);
      setLoadingVeterinaryData(false);
      setVeterinaryDataError("");

      return undefined;
    }

    setPatients([]);
    setAppointments([]);
    setAttentions([]);
    setLoadingVeterinaryData(true);
    setVeterinaryDataError("");

    const pending =
      new Set([
        "patients",
        "appointments",
        "attentions",
      ]);

    const markLoaded = (key) => {
      pending.delete(key);

      if (pending.size === 0) {
        setLoadingVeterinaryData(false);
      }
    };

    const handleError = (
      label,
      error
    ) => {
      console.error(
        `Error al cargar ${label} de Clínica Veterinaria:`,
        error?.code,
        error?.message
      );

      const errorCode =
        String(error?.code || "");

      if (
        errorCode.includes(
          "permission-denied"
        )
      ) {
        setVeterinaryDataError(
          "No tienes permisos para acceder a los datos clínicos de este negocio."
        );
      } else {
        setVeterinaryDataError(
          "No se pudieron cargar los datos clínicos. Revisa tu conexión e inténtalo nuevamente."
        );
      }

      setLoadingVeterinaryData(false);
    };

    const unsubscribePatients =
      subscribeToVeterinaryPatients(
        businessId,

        (items) => {
          setPatients(items);
          markLoaded("patients");
        },

        (error) => {
          handleError(
            "pacientes",
            error
          );
        }
      );

    const unsubscribeAppointments =
      subscribeToVeterinaryAppointments(
        businessId,

        (items) => {
          setAppointments(items);
          markLoaded("appointments");
        },

        (error) => {
          handleError(
            "citas",
            error
          );
        }
      );

    const unsubscribeAttentions =
      subscribeToVeterinaryAttentions(
        businessId,

        (items) => {
          setAttentions(items);
          markLoaded("attentions");
        },

        (error) => {
          handleError(
            "atenciones",
            error
          );
        }
      );

    return () => {
      unsubscribePatients();
      unsubscribeAppointments();
      unsubscribeAttentions();
    };
  }, [businessId]);


  const veterinaryServices =
    useMemo(
      () =>
        getVeterinaryServicesFromInventory(
          inventoryItems
        ),
      [inventoryItems]
    );


  const pharmacyProducts =
    useMemo(
      () =>
        getVeterinaryPharmacyProducts(
          inventoryItems
        ),
      [inventoryItems]
    );


  if (!businessId) {
    return (
      <section className="erp-page">
        <div
          className="erp-empty-state"
          role="alert"
        >
          Selecciona un negocio activo para utilizar
          Clínica Veterinaria.
        </div>
      </section>
    );
  }


  return (
    <section className="erp-page">
      <ModuleHeader
        className="veterinary-module-header"
        icon={Activity}
        title="Resumen clínico"
        description="Consulta los pacientes, las citas y las atenciones de tu clínica."
        actions={
          <>
            <Button type="button" icon={PawPrint} onClick={() => navigate("/clinica-veterinaria/pacientes")}>Ver pacientes</Button>
            <Button type="button" icon={CalendarDays} variant="secondary" onClick={() => navigate("/clinica-veterinaria/agenda")}>Ver agenda</Button>
            <Button type="button" icon={ClipboardList} variant="secondary"
              onClick={() => navigate("/clinica-veterinaria/ordenes")}>Ver órdenes de atención</Button>
          </>
        }
      />


      {loadingVeterinaryData || loadingInventory ? (
        <LoadingState variant="section" label="Cargando Clínica Veterinaria..." />
      ) : (
        <>
          {!veterinaryDataError && <VeterinaryDailyAppointments appointments={appointments} patients={patients} />}
          {veterinaryDataError ? (
            <div className="erp-empty-state" role="alert">
              {veterinaryDataError}
            </div>
          ) : patients.length === 0 ? (
            <EmptyState
              action={{ label: "Registrar paciente", icon: Plus, onClick: () => navigate("/clinica-veterinaria/pacientes/nuevo") }}
              description="Registra al primer paciente de la clínica para comenzar su atención."
              icon={PawPrint}
              title="Aún no hay pacientes"
            />
          ) : (
            <VeterinaryCounts label="Actividad clínica" counts={[
              ["Pacientes", patients.length],
              ["Citas", appointments.length],
              ["Atenciones", attentions.filter(({estado}) => estado === "en_atencion" || estado === "finalizada").length],
            ]} />
          )}

          {inventoryError ? (
            <div className="erp-empty-state" role="alert">
              {inventoryError}
            </div>
          ) : (
            <section className="erp-panel">
              <h2 className="erp-panel-title">Servicios y farmacia</h2>
              <VeterinaryCounts label="Disponibilidad en el inventario" counts={[
                ["Servicios disponibles", veterinaryServices.length],
                ["Productos de farmacia", pharmacyProducts.length],
              ]} />
            </section>
          )}
        </>
      )}
    </section>
  );
}

function VeterinaryCounts({ label, counts }) {
  return (
    <div className="erp-metric-grid" role="group" aria-label={label}>
      {counts.map(([name, value]) => (
        <div className="erp-metric-card" key={name}>
          <span className="erp-metric-card__label">{name}</span>
          <strong className="erp-metric-card__value">{value}</strong>
        </div>
      ))}
    </div>
  );
}

export function VeterinaryProfessionalHome({businessId, professionalUid}) {
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState(null);
  const [appointmentsError, setAppointmentsError] = useState("");
  const {patients, error: patientError} = useVeterinaryPatientDirectory(businessId, professionalUid, appointments);

  useEffect(() => {
    if (!businessId) return undefined;
    return subscribeToVeterinaryAppointments(businessId, setAppointments,
      () => setAppointmentsError("No se pudieron consultar tus citas."), professionalUid);
  }, [businessId, professionalUid]);

  const error = appointmentsError || patientError;
  return (
    <section className="erp-page">
      <ModuleHeader className="veterinary-module-header" icon={Activity}
        title="Resumen clínico" description="Consulta tus citas y órdenes de atención asignadas."
        actions={
          <>
            <Button type="button" icon={CalendarDays} onClick={() => navigate("/clinica-veterinaria/agenda")}>Mis citas</Button>
            <Button type="button" variant="secondary" icon={ClipboardList}
              onClick={() => navigate("/clinica-veterinaria/ordenes")}>Mis órdenes</Button>
          </>
        } />
      {error ? <p className="erp-empty-state" role="alert">{error}</p>
        : appointments && patients ? <VeterinaryDailyAppointments appointments={appointments} patients={patients} />
        : <LoadingState variant="section" label="Cargando tus citas..." />}
    </section>
  );
}

export default VeterinaryManager;
