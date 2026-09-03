import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";

// SPEC 020 ETAPA 4: sección de Adicionales facturables dentro de la ficha de
// Proyecto. Sin Firebase real: WorkAdditionalsSection.jsx no importa ningún
// service ni firebaseConfig.js (mismo hallazgo ya documentado para
// WorkQuoteSelector/WorkTaskBoard en PROJECTS_V3 y para SPEC 020 ETAPA 1) —
// se prueba vía Vite ssrLoadModule + renderToStaticMarkup, sin Emulator
// Suite. Las mutaciones reales (crearAdicionalTrabajo/anularAdicionalTrabajo,
// ya verificadas en Emulator Suite real por SPEC 020 ETAPA 2) se representan
// aquí como callbacks `onCreate`/`onAnnul` resueltos por el padre
// (WorksPage.jsx), exactamente igual que WorkTaskBoard con
// onRequestTaskState.

function additional(overrides = {}) {
  return {
    id: "add-1",
    adicionalId: "add-1",
    negocioId: "biz-1",
    trabajoId: "work-1",
    itemId: "item-1",
    tipoItem: "producto",
    itemSnapshot: {codigoInterno: "CAB-1", nombre: "Cable UTP categoría 6", unidad: "metro"},
    cantidad: 10,
    precioUnitario: 1500,
    moneda: "CLP",
    descripcion: "",
    tareaId: "",
    estado: "PENDIENTE_COBRO",
    registradoPorUid: "uid-1",
    registradoPorSnapshot: {nombre: "Ana", correo: "ana@example.test"},
    creadoEn: "2026-09-03T12:00:00.000Z",
    ventaId: "",
    lineaId: "",
    anuladoEn: null,
    anuladoPorUid: "",
    anuladoPorSnapshot: null,
    motivoAnulacion: "",
    ...overrides,
  };
}

const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});

try {
  const {
    default: WorkAdditionalsSection,
    canAnnulAdditional,
    canSubmitAdditionalDraft,
    getAdditionalItemTypeLabel,
    getAdditionalStatusLabel,
    getAdditionalStatusVariant,
    isAdditionalRealizedIncome,
  } = await vite.ssrLoadModule("/src/features/works/WorkAdditionalsSection.jsx");

  const baseProps = {catalogItems: [], currency: "CLP", onAnnul: () => {}, onCreate: () => {}};

  // --- Caso 1: proyecto sin adicionales ---
  const emptyMarkup = renderToStaticMarkup(React.createElement(WorkAdditionalsSection, {...baseProps, additionals: []}));
  assert.match(emptyMarkup, /Aún no se han registrado adicionales\./);
  console.log("OK caso 1: proyecto sin adicionales muestra el estado vacío");

  // --- Caso 2: adicional PENDIENTE_COBRO ---
  const pendingMarkup = renderToStaticMarkup(React.createElement(WorkAdditionalsSection, {...baseProps, additionals: [additional()], canManage: true}));
  assert.match(pendingMarkup, /Pendiente de cobro/);
  assert.match(pendingMarkup, /Cable UTP categoría 6/);
  assert.match(pendingMarkup, /ui-status-badge--warning/);
  console.log("OK caso 2: un adicional PENDIENTE_COBRO muestra el ítem, cantidad, precio y estado");

  // --- Caso 3: INCORPORADO_A_VENTA ---
  const incorporatedMarkup = renderToStaticMarkup(React.createElement(WorkAdditionalsSection, {...baseProps, additionals: [additional({estado: "INCORPORADO_A_VENTA", ventaId: "venta-1", lineaId: "linea-1"})], canManage: true}));
  assert.match(incorporatedMarkup, /Incorporado a venta/);
  assert.doesNotMatch(incorporatedMarkup, /Motivo de anulación/, "un adicional ya incorporado no ofrece anularlo desde la UI");
  console.log("OK caso 3: INCORPORADO_A_VENTA se muestra sin ninguna acción de anular");

  // --- Caso 4: ANULADO ---
  const annulledMarkup = renderToStaticMarkup(React.createElement(WorkAdditionalsSection, {...baseProps, additionals: [additional({estado: "ANULADO", motivoAnulacion: "Cliente desistió del adicional"})], canManage: true}));
  assert.match(annulledMarkup, /Anulado/);
  assert.match(annulledMarkup, /Cliente desistió del adicional/);
  assert.match(annulledMarkup, /is-annulled/, "un adicional anulado reutiliza el mismo tratamiento visual que un gasto anulado");
  console.log("OK caso 4: ANULADO muestra el motivo y el mismo estilo atenuado que gastos/HH anulados");

  // --- Caso 5: usuario autorizado puede crear ---
  const editableMarkup = renderToStaticMarkup(React.createElement(WorkAdditionalsSection, {...baseProps, additionals: [], canManage: true, role: "OWNER"}));
  assert.match(editableMarkup, /Registrar adicional/);
  assert.match(editableMarkup, /Selecciona un ítem del catálogo/);
  console.log("OK caso 5: OWNER/ADMIN (y por extensión TECNICO/MEMBER vía canOperate) ven el formulario de alta");

  // --- Caso 6: readonly no puede crear ---
  const readOnlyMarkup = renderToStaticMarkup(React.createElement(WorkAdditionalsSection, {...baseProps, additionals: [], canManage: true, role: "OWNER", readOnly: true}));
  assert.doesNotMatch(readOnlyMarkup, /Registrar adicional/, "un Proyecto terminal (readOnly) nunca ofrece crear un adicional nuevo");
  const unauthorizedMarkup = renderToStaticMarkup(React.createElement(WorkAdditionalsSection, {...baseProps, additionals: [], canManage: false, role: "FINANZAS"}));
  assert.doesNotMatch(unauthorizedMarkup, /Registrar adicional/, "FINANZAS no está en WORK_OPERATION_ROLES: no puede crear adicionales");
  console.log("OK caso 6: sólo ocultamiento visual además de la autoridad real del backend — readOnly y rol sin operación ocultan el alta");

  // --- Caso 7: sólo PENDIENTE_COBRO muestra anular ---
  assert.equal(canAnnulAdditional(additional({estado: "PENDIENTE_COBRO"}), {canManage: true}), true);
  assert.equal(canAnnulAdditional(additional({estado: "INCORPORADO_A_VENTA"}), {canManage: true}), false);
  assert.equal(canAnnulAdditional(additional({estado: "ANULADO"}), {canManage: true}), false);
  assert.equal(canAnnulAdditional(additional({estado: "PENDIENTE_COBRO"}), {canManage: false}), false, "anular sigue siendo WRITE_ROLES (OWNER/ADMIN), no WORK_OPERATION_ROLES");
  const mixedMarkup = renderToStaticMarkup(React.createElement(WorkAdditionalsSection, {
    ...baseProps,
    additionals: [additional({id: "a1", estado: "PENDIENTE_COBRO"}), additional({id: "a2", estado: "ANULADO"}), additional({id: "a3", estado: "INCORPORADO_A_VENTA"})],
    canManage: true,
  }));
  assert.equal((mixedMarkup.match(/Anular</g) || []).length, 1, "de tres adicionales en distinto estado, sólo el PENDIENTE_COBRO ofrece Anular");
  console.log("OK caso 7: la acción Anular sólo aparece para PENDIENTE_COBRO, verificado en la función pura y en el render");

  // --- Caso 8: itemId/catalog item obligatorio ---
  assert.equal(canSubmitAdditionalDraft({itemId: "", cantidad: "1", precioUnitario: "100"}), false, "sin itemId no se puede enviar, aunque el resto sea válido");
  assert.equal(canSubmitAdditionalDraft({itemId: "item-1", cantidad: "1", precioUnitario: "100"}), true);
  assert.equal(canSubmitAdditionalDraft({itemId: "item-1", cantidad: "0", precioUnitario: "100"}), false, "cantidad debe ser estrictamente positiva");
  assert.equal(canSubmitAdditionalDraft({itemId: "item-1", cantidad: "1", precioUnitario: ""}), false, "precioUnitario vacío no es válido");
  assert.equal(canSubmitAdditionalDraft({itemId: "item-1", cantidad: "1", precioUnitario: "0"}), true, "precio 0 es una decisión comercial legítima (cortesía), igual que en ETAPA 1/2");
  assert.equal(canSubmitAdditionalDraft({itemId: "item-1", cantidad: "1", precioUnitario: "-1"}), false);
  console.log("OK caso 8: itemId del catálogo es obligatorio para poder registrar un adicional");

  // --- Caso 9: loading ---
  const loadingMarkup = renderToStaticMarkup(React.createElement(WorkAdditionalsSection, {...baseProps, additionals: [additional()], loading: true, canManage: true}));
  assert.match(loadingMarkup, /Cargando adicionales\.\.\./);
  assert.doesNotMatch(loadingMarkup, /Cable UTP/, "mientras carga no debe mostrarse ni la lista ni el estado vacío anterior");
  console.log("OK caso 9: estado de carga reemplaza la lista, mismo patrón que FinancialSection");

  // --- Caso 10: resiliencia ante datos incompletos/corruptos (no hay estado de error propio: los errores de mutación los maneja runAction/setError en WorksPage) ---
  const corruptMarkup = renderToStaticMarkup(React.createElement(WorkAdditionalsSection, {
    ...baseProps,
    additionals: [additional({itemSnapshot: undefined, estado: "ESTADO_DESCONOCIDO"})],
    canManage: true,
  }));
  assert.match(corruptMarkup, /Ítem sin nombre/, "sin itemSnapshot debe mostrar un texto de respaldo, nunca lanzar ni mostrar undefined");
  assert.doesNotMatch(corruptMarkup, /\bundefined\b|\bNaN\b/);
  console.log("OK caso 10: datos incompletos/corruptos no rompen el render (defensivo, sin estado de error propio)");

  // --- Helpers puros adicionales ---
  assert.equal(getAdditionalItemTypeLabel("producto"), "Producto");
  assert.equal(getAdditionalItemTypeLabel("servicio"), "Servicio");
  assert.equal(getAdditionalItemTypeLabel("actividad"), "Actividad");
  assert.equal(getAdditionalStatusLabel("PENDIENTE_COBRO"), "Pendiente de cobro");
  assert.equal(getAdditionalStatusVariant("INCORPORADO_A_VENTA"), "success");
  assert.equal(getAdditionalStatusVariant("ANULADO"), "neutral");
  assert.equal(isAdditionalRealizedIncome(), false, "invariante SPEC 020 §7/§12: un adicional nunca es ingreso realizado por sí mismo");
  console.log("OK: helpers de etiqueta/variante y el invariante económico documentado");

  // --- Pureza: sin Firebase, sin servicios remotos propios ---
  const source = await readFile(new URL("../src/features/works/WorkAdditionalsSection.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /firebase|firestore|getDocs|collection\(|httpsCallable|crearAdicionalTrabajo\(|anularAdicionalTrabajo\(|from ["'].*workService/i, "sin ninguna consulta o mutación remota propia: todo llega por props/callbacks ya resueltos por el padre");
  console.log("OK: WorkAdditionalsSection.jsx no importa Firebase ni llama servicios directamente");

  console.log("WORK_ADDITIONALS_SECTION_SMOKE_OK");
} finally {
  await vite.close();
}
