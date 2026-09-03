import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
  adaptWorkAdditional,
  buildWorkAdditionalMutationPayload,
  canTransitionWorkAdditionalStatus,
  getEligibleWorkAdditionalOptions,
  isValidWorkAdditionalStatus,
  WORK_ADDITIONAL_ITEM_TYPES,
  WORK_ADDITIONAL_MODEL_VERSION,
  WORK_ADDITIONAL_STATUSES,
} from "../src/domain/workModel.mjs";

// SPEC 020 ETAPA 1: contrato de dominio y helpers puros de ADICIONALES
// FACTURABLES. Sin Firebase, sin Firestore, sin Functions, sin UI: sólo se
// prueba src/domain/workModel.mjs (mismo módulo que ya contiene adaptWorkExpense
// y getEligibleWorkQuoteOptions), con node plano, sin Vite ni Emulator Suite.

const validInput = () => ({
  negocioId: "biz-1",
  trabajoId: "trb-1",
  itemId: "item-1",
  tipoItem: "producto",
  cantidad: 2,
  precioUnitario: 15000,
  moneda: "clp",
  tareaId: "task-1",
  descripcion: "Extensión de cableado solicitada en terreno",
});

// --- Caso 1: adicional válido ---
{
  const payload = buildWorkAdditionalMutationPayload(validInput());
  assert.deepEqual(payload, {
    negocioId: "biz-1",
    trabajoId: "trb-1",
    itemId: "item-1",
    tipoItem: "producto",
    cantidad: 2,
    precioUnitario: 15000,
    moneda: "CLP",
    tareaId: "task-1",
    descripcion: "Extensión de cableado solicitada en terreno",
  });
}

// --- Caso 2: negocioId ausente ---
assert.throws(() => buildWorkAdditionalMutationPayload({...validInput(), negocioId: ""}), /negocio/i);

// --- Caso 3: trabajoId ausente ---
assert.throws(() => buildWorkAdditionalMutationPayload({...validInput(), trabajoId: ""}), /trabajo/i);

// --- Caso 4: itemId ausente ---
assert.throws(() => buildWorkAdditionalMutationPayload({...validInput(), itemId: ""}), /ítem/i);

// --- Caso 5: cantidad inválida ---
for (const cantidad of [0, -1, "abc", null]) {
  assert.throws(() => buildWorkAdditionalMutationPayload({...validInput(), cantidad}), /cantidad/i, `cantidad=${cantidad} debería ser rechazada`);
}

// --- Caso 6: precio inválido ---
for (const precioUnitario of [-1, "abc", null]) {
  assert.throws(() => buildWorkAdditionalMutationPayload({...validInput(), precioUnitario}), /precio/i, `precioUnitario=${precioUnitario} debería ser rechazado`);
}
// precio 0 es válido (servicio/actividad de cortesía con cobro cero es una decisión comercial legítima, no un error de forma)
assert.equal(buildWorkAdditionalMutationPayload({...validInput(), precioUnitario: 0}).precioUnitario, 0);

// --- Caso 7: moneda inválida ---
for (const moneda of ["", "US", "1234", "€€€"]) {
  assert.throws(() => buildWorkAdditionalMutationPayload({...validInput(), moneda}), /moneda/i, `moneda="${moneda}" debería ser rechazada`);
}

// --- Bonus: tipoItem inválido (misma restricción real de Venta/Cotización) ---
assert.throws(() => buildWorkAdditionalMutationPayload({...validInput(), tipoItem: "texto_libre"}), /tipo de ítem/i);
assert.equal(WORK_ADDITIONAL_ITEM_TYPES.includes("producto") && WORK_ADDITIONAL_ITEM_TYPES.includes("servicio") && WORK_ADDITIONAL_ITEM_TYPES.includes("actividad"), true);
assert.equal(WORK_ADDITIONAL_ITEM_TYPES.length, 3, "no se inventan tipos de ítem nuevos fuera del contrato de Venta/Cotización");

// --- Caso 8: estado inválido ---
assert.equal(isValidWorkAdditionalStatus("RECHAZADO_POR_CLIENTE"), false);
assert.equal(isValidWorkAdditionalStatus(""), false);
assert.equal(isValidWorkAdditionalStatus(undefined), false);
for (const estado of WORK_ADDITIONAL_STATUSES) assert.equal(isValidWorkAdditionalStatus(estado), true);
assert.equal(WORK_ADDITIONAL_STATUSES.length, 3, "SPEC 020 §5.3 define únicamente 3 estados, sin un cuarto estado RECHAZADO");

// --- Caso 9: PENDIENTE_COBRO -> INCORPORADO_A_VENTA ---
assert.equal(canTransitionWorkAdditionalStatus("PENDIENTE_COBRO", "INCORPORADO_A_VENTA"), true);

// --- Caso 10: PENDIENTE_COBRO -> ANULADO ---
assert.equal(canTransitionWorkAdditionalStatus("PENDIENTE_COBRO", "ANULADO"), true);

// --- Caso 11: ANULADO -> incorporación rechazada ---
assert.equal(canTransitionWorkAdditionalStatus("ANULADO", "INCORPORADO_A_VENTA"), false);
assert.equal(canTransitionWorkAdditionalStatus("ANULADO", "ANULADO"), false);

// --- Caso 12: INCORPORADO_A_VENTA -> reutilización en otra Venta rechazada ---
assert.equal(canTransitionWorkAdditionalStatus("INCORPORADO_A_VENTA", "INCORPORADO_A_VENTA"), false);

// --- Caso 13: transición inversa rechazada ---
assert.equal(canTransitionWorkAdditionalStatus("INCORPORADO_A_VENTA", "PENDIENTE_COBRO"), false);
assert.equal(canTransitionWorkAdditionalStatus("ANULADO", "PENDIENTE_COBRO"), false);
assert.equal(canTransitionWorkAdditionalStatus("PENDIENTE_COBRO", "PENDIENTE_COBRO"), false, "un estado no transiciona a sí mismo");

// --- Caso 14: múltiples adicionales independientes ---
{
  const workA = [
    adaptWorkAdditional({adicionalId: "a1", trabajoId: "trb-A", estado: "PENDIENTE_COBRO", itemId: "item-1", cantidad: 1, precioUnitario: 1000, moneda: "CLP"}),
    adaptWorkAdditional({adicionalId: "a2", trabajoId: "trb-A", estado: "ANULADO", itemId: "item-2", cantidad: 1, precioUnitario: 2000, moneda: "CLP"}),
  ];
  const workB = [
    adaptWorkAdditional({adicionalId: "b1", trabajoId: "trb-B", estado: "PENDIENTE_COBRO", itemId: "item-3", cantidad: 1, precioUnitario: 3000, moneda: "CLP"}),
  ];
  const eligibleA = getEligibleWorkAdditionalOptions([...workA, ...workB], {workId: "trb-A"});
  assert.deepEqual(eligibleA.map((entry) => entry.adicionalId), ["a1"], "sólo el pendiente del propio trabajo, nunca de otro");
  const eligibleB = getEligibleWorkAdditionalOptions([...workA, ...workB], {workId: "trb-B"});
  assert.deepEqual(eligibleB.map((entry) => entry.adicionalId), ["b1"]);
  // La evaluación de un trabajo no muta ni afecta los adicionales del otro (pureza)
  assert.equal(workA[0].estado, "PENDIENTE_COBRO");
  assert.equal(workA[1].estado, "ANULADO");
}

// --- Caso 15: monedas diferentes no se agregan ni convierten ---
{
  const mixed = [
    adaptWorkAdditional({adicionalId: "c1", trabajoId: "trb-C", estado: "PENDIENTE_COBRO", itemId: "item-4", cantidad: 1, precioUnitario: 10000, moneda: "CLP"}),
    adaptWorkAdditional({adicionalId: "c2", trabajoId: "trb-C", estado: "PENDIENTE_COBRO", itemId: "item-5", cantidad: 1, precioUnitario: 50, moneda: "USD"}),
  ];
  const eligible = getEligibleWorkAdditionalOptions(mixed, {workId: "trb-C"});
  assert.equal(eligible.length, 2);
  assert.equal(eligible.find((entry) => entry.adicionalId === "c1").moneda, "CLP");
  assert.equal(eligible.find((entry) => entry.adicionalId === "c2").moneda, "USD");
  // Ningún campo agregado/convertido: cada adicional expone únicamente su propio precioUnitario, sin un total combinado del conjunto
  for (const entry of eligible) assert.equal(typeof entry.totalCombinado, "undefined");
}

// --- Caso 16: adicional pendiente no se considera ingreso ---
{
  const pending = adaptWorkAdditional({adicionalId: "d1", trabajoId: "trb-D", estado: "PENDIENTE_COBRO", itemId: "item-6", cantidad: 3, precioUnitario: 4000, moneda: "CLP"});
  // ETAPA 1 no calcula ingreso/costo/margen/balance (SPEC 020 §7): el adaptador
  // nunca sintetiza un campo monetario derivado, sólo expone cantidad/precioUnitario tal cual.
  for (const forbiddenField of ["ingreso", "ingresoRealizado", "total", "totalLinea", "montoTotal", "subtotal"]) {
    assert.equal(typeof pending[forbiddenField], "undefined", `adaptWorkAdditional no debe sintetizar '${forbiddenField}'`);
  }
  assert.equal(pending.estado, "PENDIENTE_COBRO");
  // Mientras esté PENDIENTE_COBRO es elegible para incorporarse; una vez incorporado deja de estarlo (nunca doble conteo)
  assert.deepEqual(getEligibleWorkAdditionalOptions([pending], {workId: "trb-D"}).map((entry) => entry.adicionalId), ["d1"]);
  const incorporated = {...pending, estado: "INCORPORADO_A_VENTA", ventaId: "venta-1", lineaId: "linea-1"};
  assert.deepEqual(getEligibleWorkAdditionalOptions([incorporated], {workId: "trb-D"}), []);
}

// --- adaptWorkAdditional: forma completa, versión, aliasing id/adicionalId, defaults seguros ---
{
  const raw = {
    adicionalId: "ad-1",
    negocioId: "biz-9",
    trabajoId: "trb-9",
    itemId: "item-9",
    tipoItem: "servicio",
    cantidad: "4",
    precioUnitario: "12000",
    moneda: "clp",
    descripcion: "  Instalación adicional  ",
    tareaId: "task-9",
    registradoPorUid: "uid-1",
    registradoPorSnapshot: {nombre: "Ana"},
    creadoEn: "2026-09-01T12:00:00.000Z",
  };
  const adapted = adaptWorkAdditional(raw);
  assert.equal(adapted.id, "ad-1");
  assert.equal(adapted.adicionalId, "ad-1");
  assert.equal(adapted.modeloAdicionalVersion, WORK_ADDITIONAL_MODEL_VERSION);
  assert.equal(adapted.cantidad, 4);
  assert.equal(adapted.precioUnitario, 12000);
  assert.equal(adapted.moneda, "CLP");
  assert.equal(adapted.descripcion, "Instalación adicional");
  assert.equal(adapted.estado, "PENDIENTE_COBRO");
  assert.equal(adapted.ventaId, "");
  assert.equal(adapted.lineaId, "");
  assert.equal(adapted.anuladoEn, null);
  // Estado desconocido/corrupto en el almacenamiento nunca se interpreta como ya resuelto
  assert.equal(adaptWorkAdditional({...raw, estado: "ESTADO_INEXISTENTE"}).estado, "PENDIENTE_COBRO");
  // tipoItem corrupto nunca rompe el adaptador (lectura defensiva, igual que adaptWorkExpense)
  assert.equal(adaptWorkAdditional({...raw, tipoItem: "cualquier_cosa"}).tipoItem, "producto");
}

// --- Congelamiento de catálogos (no se agregan estados/tipos por mutación accidental) ---
assert.equal(Object.isFrozen(WORK_ADDITIONAL_STATUSES), true);
assert.equal(Object.isFrozen(WORK_ADDITIONAL_ITEM_TYPES), true);

// --- Caso 17: pureza — sin Firebase, sin red, sin Firestore ---
{
  const source = await readFile(new URL("../src/domain/workModel.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import /m, "src/domain/workModel.mjs debe seguir sin ninguna dependencia externa (0 imports)");
  for (const forbidden of ["firebase", "firestore", "fetch(", "XMLHttpRequest", "getFunctions", "httpsCallable"]) {
    assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false, `workModel.mjs no debe mencionar '${forbidden}'`);
  }
}

console.log("work-additional-model-smoke: OK (SPEC 020 ETAPA 1 — contrato y helpers puros de Adicionales)");
