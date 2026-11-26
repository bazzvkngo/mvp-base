import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import VeterinaryHomeView from "./VeterinaryHomeView";
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
    <VeterinaryHomeView
      appointments={appointments}
      attentions={attentions}
      patients={patients}
      loading={loadingVeterinaryData || loadingInventory}
      loadingLabel="Cargando Clínica Veterinaria..."
      error={veterinaryDataError}
    >
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
    </VeterinaryHomeView>
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

// Perfil de atenciones asignadas: las mismas consultas de la agenda y de las órdenes, que ya llegan filtradas a su
// cuenta, y sus pacientes por la consulta de pacientes asignados.
export function VeterinaryProfessionalHome({businessId, professionalUid}) {
  const [appointments, setAppointments] = useState(null);
  const [attentions, setAttentions] = useState(null);
  const [loadError, setLoadError] = useState("");
  const assignments = appointments && attentions ? [...appointments, ...attentions] : null;
  const {patients, error: patientError} = useVeterinaryPatientDirectory(businessId, professionalUid, assignments);

  useEffect(() => {
    if (!businessId) return undefined;
    const stopAppointments = subscribeToVeterinaryAppointments(businessId, setAppointments,
      () => setLoadError("No se pudieron consultar tus citas."), professionalUid);
    const stopAttentions = subscribeToVeterinaryAttentions(businessId, setAttentions,
      () => setLoadError("No se pudieron consultar tus órdenes."), professionalUid);
    return () => {
      stopAppointments();
      stopAttentions();
    };
  }, [businessId, professionalUid]);

  const error = loadError || patientError;
  return (
    <VeterinaryHomeView professional appointments={appointments} attentions={attentions} patients={patients}
      loading={!error && !(appointments && attentions && patients)} loadingLabel="Cargando tus citas..." error={error} />
  );
}

export default VeterinaryManager;
