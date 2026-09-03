import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";
import {canManageWorks, canViewWorkProfitability} from "../src/domain/workModel.mjs";

// PROJECTS_V3 ETAPA 1 (SPEC 019): selector de cotización buscable + fix de
// visibilidad de WorkBalanceSection para FINANZAS. Sin Firebase real: se usa
// exclusivamente Vite ssrLoadModule + renderToStaticMarkup (mismo patrón que
// Reports V4). WorksPage.jsx en sí no se puede cargar por este camino porque
// importa servicios que a su vez importan src/firebase/firebaseConfig.js
// (mismo hallazgo ya documentado en ETAPA 2/3 de Reports V4); por eso la
// visibilidad del balance se prueba sobre la función de permiso real
// (canViewWorkProfitability) y sobre un escaneo del código fuente que
// confirma cómo quedó cableada esa condición en el JSX.

function quoteOption({id, numero, cliente, rut, proyecto, total = 1000, moneda = "CLP"}) {
  return {
    quote: {id, numero, clienteNombre: cliente, clienteRut: rut, proyectoNombre: proyecto, total, moneda},
    sale: {id: `sale-${id}`, estado: "confirmada"},
  };
}

const optionA = quoteOption({id: "q1", numero: "COT-2026-0001", cliente: "Bagner SpA", rut: "76.111.111-1", proyecto: "Renovación de red"});
const optionB = quoteOption({id: "q2", numero: "COT-2026-0002", cliente: "Comercial Andes Ltda", rut: "76.222.222-2", proyecto: ""});
const optionC = quoteOption({id: "q3", numero: "COT-2026-0010", cliente: "Servicios del Sur SpA", rut: "76.333.333-3", proyecto: "Cableado estructurado"});
const options = [optionA, optionB, optionC];

const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});

try {
  const {
    filterWorkQuoteOptions,
    getWorkQuoteSearchText,
    getWorkQuoteSummaryLabel,
  } = await vite.ssrLoadModule("/src/features/works/WorkQuoteSelector.jsx");

  // --- Casos 2-5: lógica pura de búsqueda (sin renderizar el diálogo) ---
  assert.deepEqual(filterWorkQuoteOptions(options, "COT-2026-0001"), [optionA]);
  console.log("OK caso 2: búsqueda por número/código de cotización");

  assert.deepEqual(filterWorkQuoteOptions(options, "Andes"), [optionB]);
  console.log("OK caso 3: búsqueda por cliente");

  assert.deepEqual(filterWorkQuoteOptions(options, "0001"), [optionA], "parcial: coincide con parte del número sin requerir el número completo");
  assert.deepEqual(filterWorkQuoteOptions(options, "cot-2026"), options, "parcial: el prefijo compartido coincide con las tres cotizaciones");
  assert.deepEqual(filterWorkQuoteOptions(options, "BAGNER"), [optionA], "case-insensitive");
  assert.deepEqual(filterWorkQuoteOptions(options, "andés"), [optionB], "insensible a tildes, igual que normalizeWorkSearch");
  console.log("OK caso 4: búsqueda parcial y case-insensitive (incluye tildes)");

  assert.deepEqual(filterWorkQuoteOptions(options, "no existe ninguna coincidencia"), []);
  console.log("OK caso 5: búsqueda sin resultados");

  // --- Caso 3 (SPEC 019 §3): sólo se usan campos reales, sin inventar ninguno ---
  assert.equal(getWorkQuoteSearchText(optionA), "COT-2026-0001 Bagner SpA 76.111.111-1 Renovación de red");
  assert.equal(getWorkQuoteSearchText(optionB), "COT-2026-0002 Comercial Andes Ltda 76.222.222-2");
  console.log("OK: el texto de búsqueda concatena únicamente numero/clienteNombre/clienteRut/proyectoNombre");

  // --- Caso 7: dataset vacío ---
  assert.deepEqual(filterWorkQuoteOptions([], ""), []);
  assert.deepEqual(filterWorkQuoteOptions([], "algo"), []);
  console.log("OK caso 7: dataset vacío no produce errores ni resultados fantasma");

  // --- Caso 1/6: render inicial y selección conservada (estado cerrado, sin abrir el diálogo) ---
  const {default: WorkQuoteSelector} = await vite.ssrLoadModule("/src/features/works/WorkQuoteSelector.jsx");
  const render = (props) => renderToStaticMarkup(React.createElement(WorkQuoteSelector, {
    currencyCode: "CLP", disabled: false, loading: false, onChange: () => {}, options, value: "", ...props,
  }));

  const empty = render({});
  assert.match(empty, /Sin cotización asociada/);
  assert.match(empty, /Seleccionar cotización/);
  console.log("OK caso 1: render inicial sin selección muestra el estado vacío y el botón de selección");

  const withSelection = render({value: "q2"});
  assert.match(withSelection, new RegExp(getWorkQuoteSummaryLabel(optionB, "CLP").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(withSelection, /Cambiar cotización/);
  console.log("OK caso 6: la cotización seleccionada se refleja en el resumen (value es la única fuente de verdad, no depende de ningún filtro)");

  const lockedWithSelection = render({disabled: true, value: "q2"});
  assert.match(lockedWithSelection, new RegExp(getWorkQuoteSummaryLabel(optionB, "CLP").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "bloqueado con selección debe seguir mostrando qué cotización quedó vinculada, igual que el <select> original");
  assert.doesNotMatch(lockedWithSelection, /Cambiar cotización|Seleccionar cotización/, "sin vínculo comercial ya fijado no se ofrece acción para cambiarlo");
  console.log("OK: bloqueado con vínculo ya fijado muestra la cotización vinculada, sin acción para cambiarla");

  const lockedWithoutSelection = render({disabled: true, value: ""});
  assert.match(lockedWithoutSelection, /Vínculo comercial existente/, "vínculo fijado por otra vía (cotizacionesVinculadas/ventasVinculadas) sin cotizacionId puntual usa el texto de respaldo");
  assert.doesNotMatch(lockedWithoutSelection, /Cambiar cotización|Seleccionar cotización/);
  console.log("OK: vínculo comercial ya fijado deshabilita el selector, igual que el <select> original");

  // --- Caso 8/9: sin nueva query por escritura, sin fuga cross-tenant ---
  const selectorSource = await readFile(
    new URL("../src/features/works/WorkQuoteSelector.jsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(selectorSource, /firebase|firestore|getDocs|collection\(|httpsCallable|getQuotes|listarVentas|onSnapshot/i);
  console.log("OK casos 8/9: el selector no realiza ninguna consulta propia; opera exclusivamente sobre `options`, ya acotado por negocio antes de llegar al componente");

  console.log("WORK_QUOTE_SELECTOR_SMOKE_OK");
} finally {
  await vite.close();
}

// --- Casos 10-13: visibilidad del balance por permiso real (sin permisos nuevos) ---
assert.equal(canViewWorkProfitability("OWNER"), true);
assert.equal(canViewWorkProfitability("ADMIN"), true);
assert.equal(canViewWorkProfitability("FINANZAS"), true);
assert.equal(canViewWorkProfitability("VENTAS"), false);
assert.equal(canViewWorkProfitability("COMPRAS"), false);
assert.equal(canViewWorkProfitability("MEMBER"), false);
assert.equal(canViewWorkProfitability("TECNICO"), false);
assert.equal(canViewWorkProfitability(""), false);
console.log("OK casos 10/11/13: FINANZAS ve el balance por el mismo permiso ya usado para pedirlo; roles sin profitability.read no lo ven");

assert.equal(canManageWorks("OWNER"), true);
assert.equal(canManageWorks("ADMIN"), true);
assert.equal(canManageWorks("FINANZAS"), false, "FINANZAS ve el balance pero no administra el Proyecto: canManage sigue siendo un permiso distinto");
console.log("OK caso 12: OWNER/ADMIN siguen operando exactamente igual (canManageWorks no cambió)");

// El gate en WorksPage.jsx debe usar el permiso real, no un hardcode paralelo.
const worksPageSource = await readFile(
  new URL("../src/pages/WorksPage.jsx", import.meta.url),
  "utf8"
);
assert.match(
  worksPageSource,
  /\{canViewWorkProfitability\(role\)\s*&&\s*<WorkBalanceSection/,
  "el balance debe gatearse con canViewWorkProfitability(role), no con canManage ni un hardcode de roles"
);
assert.doesNotMatch(
  worksPageSource,
  /canManage\s*&&\s*<WorkBalanceSection/,
  "no debe quedar el gate anterior (canManage) controlando el balance"
);
assert.doesNotMatch(
  worksPageSource,
  /role\s*===\s*["']OWNER["']\s*\|\|\s*role\s*===\s*["']ADMIN["']\s*\|\|\s*role\s*===\s*["']FINANZAS["']/,
  "no debe introducirse un hardcode OWNER||ADMIN||FINANZAS en paralelo al helper RBAC"
);
console.log("OK caso 14: el fix quedó cableado sobre el permiso RBAC real (canViewWorkProfitability), sin backend/RBAC nuevo ni hardcode paralelo");

console.log("PROJECTS_V3_STAGE1_SMOKE_OK");
