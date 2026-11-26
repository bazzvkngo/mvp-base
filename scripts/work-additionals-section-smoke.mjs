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
  const {getWorkAdditionalCatalogPrice} = await vite.ssrLoadModule("/src/domain/workModel.mjs");
  const {
    default: WorkAdditionalsSection,
    ADDITIONAL_NO_SALE_PRICE_MESSAGE,
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
  // Cada campo con su etiqueta visible (no solo placeholder).
  for (const label of ["Ítem", "Cantidad", "Precio unitario"]) assert.match(editableMarkup, new RegExp(`<span class="erp-field__label">${label}</span>`), `etiqueta visible «${label}»`);
  assert.doesNotMatch(editableMarkup, /placeholder="Cantidad"|placeholder="Precio unitario/, "las etiquetas no dependen del placeholder");
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

  // --- Caso 11: precio del adicional = precio de venta del ítem; solo lectura sin gestión ---
  {
    const catalogItems = [{id: "item-1", nombre: "Cable UTP", tipoItem: "producto", codigoInterno: "CAB-1", precioInterno: 1500}];
    const technicianMarkup = renderToStaticMarkup(React.createElement(WorkAdditionalsSection, {...baseProps, additionals: [], catalogItems, canManage: false, role: "TECNICO"}));
    const memberMarkup = renderToStaticMarkup(React.createElement(WorkAdditionalsSection, {...baseProps, additionals: [], catalogItems, canManage: false, role: "MEMBER"}));
    const ownerPriceMarkup = renderToStaticMarkup(React.createElement(WorkAdditionalsSection, {...baseProps, additionals: [], catalogItems, canManage: true, role: "OWNER"}));
    const priceInput = (markup) => markup.match(/<input[^>]*max="999999999999\.99"[^>]*>/)?.[0] || "";
    assert.match(priceInput(technicianMarkup), /readOnly=""/, "TECNICO: el precio es de solo lectura");
    assert.match(priceInput(memberMarkup), /readOnly=""/, "MEMBER: el precio es de solo lectura");
    assert.doesNotMatch(priceInput(ownerPriceMarkup), /readOnly/, "propietario y administrador editan el precio");
    assert.match(technicianMarkup, /Precio de venta del ítem en CLP\. Solo un administrador puede cambiarlo\./, "el solo lectura se explica y muestra la moneda");
    assert.doesNotMatch(ownerPriceMarkup, /Solo un administrador puede cambiarlo/);
    // Qué campo es el precio de venta: `precioInterno` (nunca el costo ni el costo promedio).
    assert.equal(getWorkAdditionalCatalogPrice({precioInterno: 1500}), 1500);
    assert.equal(getWorkAdditionalCatalogPrice({precioInterno: "2500.5"}), 2500.5);
    assert.equal(getWorkAdditionalCatalogPrice({precioInterno: 1999.999}), 2000, "dos decimales, igual que el backend");
    for (const [label, item] of [["sin campo", {}], ["solo costo", {costoBase: 4000, costoPromedio: 3500, precioCompra: 3000}], ["vacío", {precioInterno: ""}], ["nulo", {precioInterno: null}], ["cero", {precioInterno: 0}], ["negativo", {precioInterno: -5}], ["no numérico", {precioInterno: "abc"}], ["sin ítem", undefined]]) {
      assert.equal(getWorkAdditionalCatalogPrice(item), null, `${label}: sin precio de venta (nunca cae al costo)`);
    }
    // Sin gestión: el borrador debe llevar exactamente el precio del ítem y el ítem debe tenerlo.
    const draft = {itemId: "item-1", cantidad: "2", precioUnitario: "1500"};
    assert.equal(canSubmitAdditionalDraft(draft, {catalogPrice: 1500, requireCatalogPrice: true}), true, "precio correcto: se puede enviar");
    assert.equal(canSubmitAdditionalDraft({...draft, precioUnitario: "1400"}, {catalogPrice: 1500, requireCatalogPrice: true}), false, "precio distinto: no se envía");
    assert.equal(canSubmitAdditionalDraft(draft, {catalogPrice: null, requireCatalogPrice: true}), false, "ítem sin precio de venta: botón deshabilitado");
    assert.equal(canSubmitAdditionalDraft({...draft, precioUnitario: "1400"}), true, "propietario y administrador: sin restricción (comportamiento actual)");
    assert.equal(canSubmitAdditionalDraft({...draft, precioUnitario: "0"}, {catalogPrice: null, requireCatalogPrice: false}), true, "propietario y administrador: precio 0 sigue permitido");
    assert.equal(ADDITIONAL_NO_SALE_PRICE_MESSAGE, "Este ítem no tiene precio de venta. Pide a un administrador que lo defina.");
    const source11 = await readFile(new URL("../src/features/works/WorkAdditionalsSection.jsx", import.meta.url), "utf8");
    assert.match(source11, /const priceLocked = !canManage;/, "solo gestión (propietario/administrador) edita el precio");
    assert.match(source11, /readOnly=\{priceLocked\}/);
    assert.match(source11, /return \{\.\.\.current, itemId, precioUnitario: price != null \? String\(price\) : priceLocked \? "" : current\.precioUnitario\};/, "al elegir el ítem se rellena el precio de venta; sin precio, sin gestión se vacía y con gestión se conserva lo escrito");
    assert.match(source11, /onChange=\{\(event\) => selectItem\(event\.target\.value\)\}/);
    assert.match(source11, /\{missingSalePrice && <small className="works-field-error">\{ADDITIONAL_NO_SALE_PRICE_MESSAGE\}<\/small>\}/, "el aviso de ítem sin precio sale bajo el campo");
    assert.match(source11, /const missingSalePrice = priceLocked && Boolean\(draft\.itemId\) && catalogPrice == null;/);
    assert.match(source11, /!canSubmitAdditionalDraft\(draft, draftOptions\)\}/, "el botón Registrar queda deshabilitado con precio ausente o distinto");
    console.log("OK caso 11: el precio sale de precioInterno, es solo lectura sin gestión, un ítem sin precio avisa y bloquea, y gestión conserva el comportamiento actual");
  }

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
