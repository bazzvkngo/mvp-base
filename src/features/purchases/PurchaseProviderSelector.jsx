import React from "react";
import InlinePartySelector from "../../components/ui/InlinePartySelector";
import {getFiscalIdentifierLabel} from "../../domain/fiscalIdentifier.mjs";
import {matchesProviderSearch} from "../../domain/providerModel.mjs";
import useBusinessFormat from "../../hooks/useBusinessFormat";

// Proveedor de la Compra (borrador): mismo selector en línea que el cliente de Venta, con los datos del proveedor.
// La lista, el filtro (matchesProviderSearch) y el onChange son los de siempre; solo cambia la presentación.
const NOUN = Object.freeze({singular: "proveedor", plural: "proveedores", pluralTitle: "Proveedores", route: "/proveedores", purpose: "comprar"});
const getId = (provider) => provider?.proveedorId;
const getName = (provider) => provider?.razonSocial;
const getFiscal = (provider) => {
  const value = provider?.identificadorFiscalValor || provider?.rut || "";
  return `${provider?.identificadorFiscalTipo || "Identificación fiscal"} ${value || "no informada"}`.trim();
};
const getContact = (provider) => provider?.personaContacto || provider?.email || "";

// Las opciones de la lista muestran solo el valor del identificador (la etiqueta ya está en el buscador).
const getOptionFiscal = (provider) => provider?.identificadorFiscalValor || provider?.rut || "";

// `purpose` (opcional) completa la frase "Crea uno en Proveedores para poder …" cuando aún no hay proveedores: Compra usa
// "comprar" (por defecto) y Orden de compra "pedir".
export default function PurchaseProviderSelector({disabled, historicalNote, onChange, originalSnapshot, providers, purpose = NOUN.purpose, value}) {
  const {countryCode} = useBusinessFormat();
  const noun = purpose === NOUN.purpose ? NOUN : {...NOUN, purpose};
  return (
    <InlinePartySelector
      disabled={disabled}
      fiscalLabel={getFiscalIdentifierLabel(countryCode)}
      getContact={getContact}
      getFiscal={getFiscal}
      getId={getId}
      getName={getName}
      getOptionFiscal={getOptionFiscal}
      historicalNote={historicalNote}
      matches={matchesProviderSearch}
      noun={noun}
      onChange={onChange}
      originalSnapshot={originalSnapshot}
      parties={providers}
      value={value}
    />
  );
}
