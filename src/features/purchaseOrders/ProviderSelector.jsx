import React, {useMemo, useState} from "react";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {matchesProviderSearch} from "../../domain/providerModel.mjs";

export default function ProviderSelector({
  disabled,
  emptyMessage = "Selecciona un proveedor.",
  onChange,
  originalSnapshot,
  providers,
  value,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const activeProviders = useMemo(() => providers.filter((provider) =>
    provider.estado === "activo" && matchesProviderSearch(provider, search)
  ), [providers, search]);
  const selected = providers.find((provider) => provider.proveedorId === value);
  const isHistorical = originalSnapshot?.proveedorId === value;
  const display = isHistorical ? originalSnapshot : selected;

  return (
    <section className="po-panel po-provider">
      <div className="po-provider__content">
        <span className="po-provider__badge">Proveedor registrado</span>
        {display ? (
          <>
            <strong className="po-provider__name">{display.razonSocial}</strong>
            <div className="po-provider__metadata">
              <span>RUT {display.rut || "no informado"}</span>
              <span>{display.personaContacto || display.email || "Sin contacto informado"}</span>
            </div>
            {isHistorical && <em className="po-provider__snapshot">Snapshot histórico conservado</em>}
          </>
        ) : <p>{emptyMessage}</p>}
      </div>
      {!disabled && (
        <button type="button" className="po-button po-button--secondary" onClick={() => setOpen(true)}>
          {display ? "Cambiar proveedor" : "Seleccionar proveedor"}
        </button>
      )}
      <ResponsiveDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Seleccionar proveedor"
        description="Solo se muestran proveedores activos del negocio."
        size="medium"
      >
        <div className="po-selector">
          <input
            aria-label="Buscar proveedor"
            placeholder="Buscar por razón social o RUT"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="po-selector__list">
            {activeProviders.map((provider) => (
              <button
                type="button"
                key={provider.proveedorId}
                onClick={() => {
                  onChange(provider.proveedorId);
                  setOpen(false);
                  setSearch("");
                }}
              >
                <strong>{provider.razonSocial}</strong>
                <span>{provider.rut} · {provider.condicionesPago || "Sin condición"}</span>
              </button>
            ))}
            {!activeProviders.length && <p>No hay proveedores activos coincidentes.</p>}
          </div>
        </div>
      </ResponsiveDialog>
    </section>
  );
}
