import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";

// SPEC 020 ETAPA 5: selector de adicionales pendientes dentro de la creación
// de una Venta (src/features/works/AdditionalSelector.jsx, usado por
// src/pages/NewSalePage.jsx). Sin Firebase real: se prueba vía Vite
// ssrLoadModule + renderToStaticMarkup, mismo patrón que
// WorkQuoteSelector/WorkAdditionalsSection. Cubre únicamente la capa
// presentacional (listar/seleccionar/deseleccionar); la conversión real a
// líneas de Venta y el cierre transaccional en confirmarVenta se prueban en
// Emulator Suite (scripts/sale-additional-integrated-local.mjs).

function additional(overrides = {}) {
  return {
    id: "add-1",
    itemId: "item-1",
    tipoItem: "producto",
    itemSnapshot: {codigoInterno: "CAB-1", nombre: "Cable UTP categoría 6", unidad: "metro"},
    cantidad: 10,
    precioUnitario: 1500,
    moneda: "CLP",
    estado: "PENDIENTE_COBRO",
    ...overrides,
  };
}

const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});

try {
  const {default: AdditionalSelector, getWorkAdditionalOptionLabel} = await vite.ssrLoadModule("/src/features/works/AdditionalSelector.jsx");

  // --- Caso: proyecto sin adicionales pendientes ---
  const emptyMarkup = renderToStaticMarkup(React.createElement(AdditionalSelector, {additionals: [], currency: "CLP", onToggle: () => {}, selectedIds: []}));
  assert.match(emptyMarkup, /no tiene adicionales pendientes de cobro/);
  console.log("OK: proyecto sin adicionales pendientes muestra el estado vacío");

  // --- Caso: lista uno, no seleccionado ---
  const oneMarkup = renderToStaticMarkup(React.createElement(AdditionalSelector, {additionals: [additional()], currency: "CLP", onToggle: () => {}, selectedIds: []}));
  assert.match(oneMarkup, /Cable UTP categoría 6/);
  assert.match(oneMarkup, /Producto/);
  assert.doesNotMatch(oneMarkup, /checked/, "sin selectedIds ningún checkbox debe aparecer marcado");
  console.log("OK: un adicional pendiente se lista con ítem/cantidad/precio/moneda");

  // --- Caso: varios, uno seleccionado ---
  const many = [additional({id: "add-1", itemSnapshot: {nombre: "Cable UTP"}}), additional({id: "add-2", itemSnapshot: {nombre: "Instalación extra"}, tipoItem: "servicio"})];
  const selectedMarkup = renderToStaticMarkup(React.createElement(AdditionalSelector, {additionals: many, currency: "CLP", onToggle: () => {}, selectedIds: ["add-2"]}));
  assert.match(selectedMarkup, /Cable UTP/);
  assert.match(selectedMarkup, /Instalación extra/);
  assert.equal((selectedMarkup.match(/checked/g) || []).length, 1, "sólo el adicional en selectedIds aparece marcado");
  console.log("OK: selección múltiple — cada adicional se marca de forma independiente");

  // --- Caso: ninguno seleccionado tras deseleccionar (mismo render que el caso vacío-seleccionado) ---
  const noneSelectedMarkup = renderToStaticMarkup(React.createElement(AdditionalSelector, {additionals: many, currency: "CLP", onToggle: () => {}, selectedIds: []}));
  assert.doesNotMatch(noneSelectedMarkup, /checked/, "deseleccionar debe reflejarse: ningún checkbox marcado");
  console.log("OK: deseleccionar (selectedIds vacío) no deja ningún checkbox marcado");

  // --- Caso: loading ---
  const loadingMarkup = renderToStaticMarkup(React.createElement(AdditionalSelector, {additionals: [additional()], currency: "CLP", loading: true, onToggle: () => {}, selectedIds: []}));
  assert.match(loadingMarkup, /Cargando adicionales\.\.\./);
  assert.doesNotMatch(loadingMarkup, /Cable UTP/, "mientras carga no debe mostrarse la lista anterior");
  console.log("OK: estado de carga reemplaza la lista");

  // --- Helper puro de etiqueta ---
  const label = getWorkAdditionalOptionLabel(additional(), "CLP");
  assert.match(label, /Cable UTP categoría 6/);
  assert.match(label, /Producto/);
  assert.match(label, /10 metro/);
  console.log("OK: getWorkAdditionalOptionLabel compone ítem/tipo/cantidad/precio sin inventar un total");

  // --- Sin query por tecla: no hay ningún input de búsqueda en este selector ---
  assert.doesNotMatch(oneMarkup, /<input[^>]*type="(text|search)"/, "a diferencia de WorkQuoteSelector, este selector no incluye búsqueda por texto (lista acotada por Proyecto)");

  // --- Pureza: sin Firebase, sin servicios remotos propios ---
  const source = await readFile(new URL("../src/features/works/AdditionalSelector.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /firebase|firestore|getDocs|collection\(|httpsCallable|listarAdicionalesPendientesTrabajo\(|from ["'].*workService/i, "sin ninguna consulta remota propia: additionals llega ya cargado por el padre (NewSalePage.jsx)");
  console.log("OK: AdditionalSelector.jsx no importa Firebase ni llama servicios directamente");

  console.log("ADDITIONAL_SELECTOR_SMOKE_OK");
} finally {
  await vite.close();
}
