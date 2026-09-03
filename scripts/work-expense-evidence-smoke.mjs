import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";
import {
  buildWorkExpenseEvidenceFileName,
  getWorkExpenseEvidenceTypeLabel,
  MAX_WORK_EXPENSE_EVIDENCE_BYTES,
  MAX_WORK_EXPENSE_EVIDENCE_FILES,
  validateWorkExpenseEvidenceSelection,
  WORK_EXPENSE_EVIDENCE_TYPES,
} from "../src/domain/workModel.mjs";

// SPEC 020 ETAPA 4: control de evidencia documental de gastos, integrado
// dentro del gasto ya existente (WorkExpenseEvidence.jsx, renderizado por
// FinancialSection en WorksPage.jsx). Sin Firebase real: se prueba el
// componente vía Vite ssrLoadModule + renderToStaticMarkup (mismo patrón que
// WorkQuoteSelector/WorkTaskBoard/WorkAdditionalsSection), y los helpers
// puros de workModel.mjs (validación/saneo de nombre de archivo) vía node
// plano. El upload real (subirEvidenciaGastoTrabajo -> Storage ->
// adjuntarEvidenciaGastoTrabajo) ya está cubierto por
// scripts/work-expense-evidence-integrated-local.mjs (Emulator Suite real,
// SPEC 020 ETAPA 3): este smoke no lo repite, cubre exclusivamente la capa
// presentacional/UX nueva de ETAPA 4.

function evidenceEntry(overrides = {}) {
  return {
    id: "ev-1",
    storagePath: "negocios/biz-1/trabajos/work-1/gastos/expense-1/documento-abc123.pdf",
    nombreArchivo: "documento-abc123.pdf",
    tipoMime: "application/pdf",
    tamanoBytes: 12345,
    subidoPorUid: "uid-1",
    subidoPorSnapshot: {nombre: "Ana", correo: "ana@example.test"},
    subidoEn: "2026-09-03T12:00:00.000Z",
    ...overrides,
  };
}

const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});

try {
  const {default: WorkExpenseEvidence} = await vite.ssrLoadModule("/src/features/works/WorkExpenseEvidence.jsx");
  const noop = () => {};

  // --- Caso 11: gasto sin evidencia ---
  const emptyMarkup = renderToStaticMarkup(React.createElement(WorkExpenseEvidence, {entries: [], onOpen: noop, onUpload: noop}));
  assert.match(emptyMarkup, /Sin evidencia adjunta\./);
  console.log("OK caso 11: gasto sin evidencia muestra el estado vacío");

  // --- Caso 12: gasto con una evidencia ---
  const oneMarkup = renderToStaticMarkup(React.createElement(WorkExpenseEvidence, {entries: [evidenceEntry()], onOpen: noop, onUpload: noop}));
  assert.match(oneMarkup, /documento-abc123\.pdf/);
  assert.match(oneMarkup, />PDF</);
  console.log("OK caso 12: una evidencia muestra su nombre y tipo");

  // --- Caso 13: múltiples evidencias ---
  const many = [
    evidenceEntry({id: "ev-1", nombreArchivo: "boleta-1.pdf", tipoMime: "application/pdf"}),
    evidenceEntry({id: "ev-2", nombreArchivo: "foto-2.jpg", tipoMime: "image/jpeg"}),
    evidenceEntry({id: "ev-3", nombreArchivo: "foto-3.png", tipoMime: "image/png"}),
  ];
  const manyMarkup = renderToStaticMarkup(React.createElement(WorkExpenseEvidence, {entries: many, onOpen: noop, onUpload: noop}));
  for (const entry of many) assert.match(manyMarkup, new RegExp(entry.nombreArchivo.replace(".", "\\.")));
  assert.equal((manyMarkup.match(/<li>/g) || []).length, 3, "cada evidencia es una entrada independiente, ninguna se reemplaza silenciosamente");
  console.log("OK caso 13: múltiples evidencias conviven, cada una independiente y visible");

  // --- Caso 14: máximo 5 ---
  const fiveEntries = Array.from({length: 5}, (_, index) => evidenceEntry({id: `ev-${index}`, nombreArchivo: `documento-${index}.pdf`}));
  const atLimitMarkup = renderToStaticMarkup(React.createElement(WorkExpenseEvidence, {canAttach: true, entries: fiveEntries, onOpen: noop, onUpload: noop}));
  assert.match(atLimitMarkup, /Se alcanzó el máximo de 5 archivos\./);
  assert.doesNotMatch(atLimitMarkup, /Adjuntar evidencia/, "al llegar al máximo, el control de subida se reemplaza por el aviso, nunca conviven");
  console.log("OK caso 14: al llegar a 5 evidencias, la UI bloquea un nuevo intento sin depender sólo del backend");

  // --- Casos 15/16/17: formatos permitidos ---
  assert.equal(validateWorkExpenseEvidenceSelection({type: "application/pdf", size: 1000}, 0).ok, true, "PDF permitido");
  assert.equal(validateWorkExpenseEvidenceSelection({type: "image/jpeg", size: 1000}, 0).ok, true, "JPG permitido");
  assert.equal(validateWorkExpenseEvidenceSelection({type: "image/png", size: 1000}, 0).ok, true, "PNG permitido");
  console.log("OK casos 15/16/17: PDF, JPG y PNG son aceptados por la validación de UX");

  // --- Caso 18: MIME/extensión inválido bloqueado en UX ---
  const invalidType = validateWorkExpenseEvidenceSelection({type: "text/plain", size: 1000}, 0);
  assert.equal(invalidType.ok, false);
  assert.match(invalidType.reason, /PDF, JPG o PNG/);
  console.log("OK caso 18: un tipo no permitido se bloquea en el cliente antes de intentar subir");

  // --- Caso 19: >5MB bloqueado en UX ---
  const oversized = validateWorkExpenseEvidenceSelection({type: "application/pdf", size: MAX_WORK_EXPENSE_EVIDENCE_BYTES + 1}, 0);
  assert.equal(oversized.ok, false);
  assert.match(oversized.reason, /5 MB/);
  assert.equal(validateWorkExpenseEvidenceSelection({type: "application/pdf", size: MAX_WORK_EXPENSE_EVIDENCE_BYTES}, 0).ok, true, "exactamente 5 MB sigue siendo válido");
  console.log("OK caso 19: un archivo mayor a 5 MB se bloquea en el cliente antes de intentar subir");

  // --- Caso 20: gasto anulado conserva evidencia ---
  const annulledExpenseEvidenceMarkup = renderToStaticMarkup(React.createElement(WorkExpenseEvidence, {canAttach: false, entries: [evidenceEntry()], onOpen: noop, onUpload: noop}));
  assert.match(annulledExpenseEvidenceMarkup, /documento-abc123\.pdf/, "la evidencia histórica sigue visible aunque el gasto ya no admita adjuntar más (anulado o sólo lectura)");
  console.log("OK caso 20: la evidencia ya asociada se sigue mostrando aunque canAttach sea false (gasto anulado o sin autorización)");

  // --- Caso 21: gasto anulado no permite nuevo upload ---
  assert.doesNotMatch(annulledExpenseEvidenceMarkup, /Adjuntar evidencia/, "canAttach=false (gasto anulado, según contrato de backend) nunca ofrece subir uno nuevo");
  console.log("OK caso 21: sin canAttach no se ofrece ningún control de subida, coherente con que el backend rechaza evidencia sobre un gasto anulado");

  // --- Caso 22: readonly puede ver pero no subir ---
  // canAttach ya encapsula tanto "gasto anulado" como "readOnly"/sin autorización: en ambos casos la UI se comporta igual (ver sin poder subir) — mismo render que el caso 20/21, mismo control resuelto por FinancialSection en WorksPage.jsx.
  const readOnlyMarkup = renderToStaticMarkup(React.createElement(WorkExpenseEvidence, {canAttach: false, entries: [evidenceEntry({nombreArchivo: "solo-lectura.pdf"})], onOpen: noop, onUpload: noop}));
  assert.match(readOnlyMarkup, /solo-lectura\.pdf/);
  assert.doesNotMatch(readOnlyMarkup, /Adjuntar evidencia/);
  console.log("OK caso 22: un usuario de sólo lectura ve la evidencia existente pero no el control de subida");

  // --- Caso 23: subida exitosa (verificado a nivel de contrato de nombre de archivo, no de red) ---
  // El registro real (Storage + adjuntarEvidenciaGastoTrabajo) ya está
  // probado en Emulator Suite por ETAPA 3; aquí se verifica que el nombre de
  // archivo que la UI va a enviar es siempre seguro y único, condición
  // necesaria para que el registro tenga éxito sin colisionar con otro
  // adjunto del mismo gasto.
  const fileNameA = buildWorkExpenseEvidenceFileName("Boleta café Enero.pdf", "application/pdf", {uniquePart: "aaa111"});
  const fileNameB = buildWorkExpenseEvidenceFileName("Boleta café Enero.pdf", "application/pdf", {uniquePart: "bbb222"});
  assert.match(fileNameA, /^[a-zA-Z0-9._-]{1,200}$/, "el nombre generado respeta el mismo alfabeto que ya exige adjuntarEvidenciaGastoTrabajo en el backend");
  assert.notEqual(fileNameA, fileNameB, "dos subidas del mismo archivo original nunca colisionan en el mismo storagePath");
  assert.match(fileNameA, /\.pdf$/);
  assert.equal(buildWorkExpenseEvidenceFileName("foto.jpg", "image/jpeg", {uniquePart: "x"}), "foto-x.jpg");
  assert.equal(buildWorkExpenseEvidenceFileName("foto.png", "image/png", {uniquePart: "x"}), "foto-x.png");
  console.log("OK caso 23: el nombre de archivo que habilita una subida exitosa es siempre seguro y único (no depende de que el original lo sea)");

  // --- Caso 24: error de upload no altera el gasto (sin estado de error propio en el componente) ---
  // WorkExpenseEvidence no intercepta errores de onUpload: cualquier fallo
  // (p. ej. el ya probado en Emulator Suite para MIME/tamaño real inválido,
  // ETAPA 3 casos 21/22) se propaga tal cual al mismo runAction/setError que
  // ya usa el resto de mutaciones de gastos en WorksPage.jsx — no hay ningún
  // camino en este componente que modifique `entries` a partir de un
  // intento fallido: sólo WorksPage, tras refrescar la ficha, decide qué
  // mostrar.
  const evidenceSource = await readFile(new URL("../src/features/works/WorkExpenseEvidence.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(evidenceSource, /catch\s*\(|\.catch\(/, "el componente no intercepta errores de onUpload: deja que se propaguen al mismo manejo ya usado por el resto de mutaciones de gastos");
  console.log("OK caso 24: un fallo de subida se propaga sin que el componente altere `entries` por su cuenta");

  // --- Helpers puros adicionales ---
  assert.equal(getWorkExpenseEvidenceTypeLabel("application/pdf"), "PDF");
  assert.equal(getWorkExpenseEvidenceTypeLabel("image/jpeg"), "JPG");
  assert.equal(getWorkExpenseEvidenceTypeLabel("image/png"), "PNG");
  assert.equal(getWorkExpenseEvidenceTypeLabel("text/plain"), "Archivo");
  assert.equal(WORK_EXPENSE_EVIDENCE_TYPES.length, 3, "sin tipos nuevos fuera de PDF/JPG/PNG");
  assert.equal(MAX_WORK_EXPENSE_EVIDENCE_FILES, 5);
  console.log("OK: helpers de etiqueta y límites documentales");

  // --- Pureza: sin Firebase, sin servicios remotos propios ---
  assert.doesNotMatch(evidenceSource, /firebase|firestore|getDocs|collection\(|httpsCallable|subirEvidenciaGastoTrabajo\(|adjuntarEvidenciaGastoTrabajo\(|uploadBytes|getDownloadURL|from ["'].*workService/i, "sin ninguna consulta o subida remota propia: todo llega por props/callbacks ya resueltos por el padre");
  console.log("OK: WorkExpenseEvidence.jsx no importa Firebase ni sube archivos directamente");

  console.log("WORK_EXPENSE_EVIDENCE_UI_SMOKE_OK");
} finally {
  await vite.close();
}
