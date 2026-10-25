import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

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
  role,
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
      key,
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

      markLoaded(key);
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
            "patients",
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
            "appointments",
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
            "attentions",
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
      <div className="erp-module-intro">
        <div className="erp-page-intro">
          <h1>
            Clínica Veterinaria
          </h1>

          <p>
            Gestión clínica de pacientes, agenda,
            atenciones y farmacia veterinaria.
          </p>

          <p>
            Rol activo:{" "}
            <strong>
              {role || "Sin rol"}
            </strong>
          </p>
        </div>
      </div>


      <div className="erp-panel">
        <h2>
          Modelo de datos veterinario
        </h2>

        {loadingVeterinaryData && (
          <p>
            Cargando datos clínicos...
          </p>
        )}

        {veterinaryDataError && (
          <div
            className="erp-empty-state"
            role="alert"
          >
            {veterinaryDataError}
          </div>
        )}

        {!loadingVeterinaryData &&
          !veterinaryDataError && (
            <>
              <p>
                Pacientes:{" "}
                <strong>
                  {patients.length}
                </strong>
              </p>

              <p>
                Citas:{" "}
                <strong>
                  {appointments.length}
                </strong>
              </p>

              <p>
                Atenciones:{" "}
                <strong>
                  {attentions.length}
                </strong>
              </p>
            </>
          )}
      </div>


      {loadingInventory && (
        <div className="erp-empty-state">
          Cargando inventario...
        </div>
      )}


      {inventoryError && (
        <div
          className="erp-empty-state"
          role="alert"
        >
          {inventoryError}
        </div>
      )}


      {!loadingInventory &&
        !inventoryError && (
          <div className="erp-panel">
            <h2>
              Integración con Inventario
            </h2>

            <p>
              Servicios disponibles:{" "}
              <strong>
                {veterinaryServices.length}
              </strong>
            </p>

            <p>
              Productos de farmacia:{" "}
              <strong>
                {pharmacyProducts.length}
              </strong>
            </p>
          </div>
        )}
    </section>
  );
}


export default VeterinaryManager;