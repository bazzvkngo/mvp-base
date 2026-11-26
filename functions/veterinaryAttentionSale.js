"use strict";

const {createHash} = require("node:crypto");
const {assertBusinessCanOperate} = require("./businessOperations");
const {resolveBaseTaxSettings} = require("./businessJurisdiction");
const {documentLocalizationSnapshot} = require("./localization");
const {roundMoney} = require("./money");
const {assertBusinessModuleEnabled} = require("./moduleAccess");
const {clientSnapshotFromDocument, crearVentaHandler} = require("./salePersistence");
const {resolveVeterinaryAppointmentTimeZone} = require("./veterinaryAppointmentPersistence");
const {importVeterinaryModel} = require("./veterinaryModels");

const VETERINARY_SALE_INTENTS = "ventasPendientesVeterinaria";
const INTENT_ID = /^[a-zA-Z0-9_-]{1,120}$/;
const TERMINAL_ERRORS = ["invalid-argument", "failed-precondition", "not-found", "permission-denied", "already-exists"];

function requestIdForAttention(businessId, atencionId) {
  return "vet-" + createHash("sha256").update(businessId + "/" + atencionId).digest("hex");
}

async function stageVeterinarySale(tx, attentionRef, {pacienteId}, entries, context, now = new Date()) {
  const {businessRef, businessId, businessSnapshot, taxSettings, uid, HttpsError, audit} = context;
  const patientSnap = await tx.get(businessRef.collection("pacientesVeterinarios").doc(pacienteId));
  const patient = patientSnap.data();
  const clienteId = patient?.tutorClienteId;
  if (patient?.negocioId !== businessId || typeof clienteId !== "string" || !INTENT_ID.test(clienteId)) {
    throw new HttpsError("failed-precondition", "El paciente necesita un tutor activo para crear la venta.");
  }
  const tutor = await tx.get(businessRef.collection("clientes").doc(clienteId));
  clientSnapshotFromDocument(tutor, businessId, clienteId, HttpsError);

  const business = businessSnapshot.data();
  const {montoDecimales} = documentLocalizationSnapshot(business, taxSettings);
  const {getTodayIsoDate} = await importVeterinaryModel("appointmentModel");
  const timeZone = resolveVeterinaryAppointmentTimeZone(business.paisCodigo) || "UTC";
  const fechaVenta = getTodayIsoDate({now, timeZone});
  const items = entries.map(({reference, snapshot}) => {
    const {itemId, cantidad} = reference;
    const currentPrice = Number(snapshot.precioInterno ?? 0);
    if (!Number.isFinite(currentPrice) || currentPrice < 0) {
      throw new HttpsError("failed-precondition", "Revisa el precio en Inventario de " + reference.nombre + ".");
    }
    return {lineaId: itemId, itemId, cantidad, precioUnitario: roundMoney(currentPrice, montoDecimales), descuentoPct: 0};
  });

  tx.create(businessRef.collection(VETERINARY_SALE_INTENTS).doc(attentionRef.id), {
    negocioId: businessId,
    atencionId: attentionRef.id,
    cerradoPorUid: uid,
    cerradoEn: now,
    estado: "pendiente",
    creadoEn: audit.actualizadoEn,
    venta: {clienteId, items, fechaVenta, observaciones: "Atención veterinaria " + attentionRef.id},
  });
  return {ventaEstado: "pendiente"};
}

async function updateSaleStatus(db, intentRef, attentionRef, FieldValue, status, extra) {
  await db.runTransaction(async (tx) => {
    const [pending, attention] = await tx.getAll(intentRef, attentionRef);
    const source = pending.data();
    if (source?.estado === "generada" || attention.get("ventaId")) return;
    if (!pending.exists || attention.get("estado") !== "finalizada" ||
        attention.get("finalizadoPorUid") !== source.cerradoPorUid ||
        attention.get("negocioId") !== source.negocioId) return;
    tx.update(intentRef, {estado: status, ...extra, actualizadoEn: FieldValue.serverTimestamp()});
    tx.update(attentionRef, {ventaEstado: status, ...extra});
  });
}

async function deliverVeterinarySale({db, FieldValue, HttpsError, businessId, atencionId}) {
  if (typeof businessId !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(businessId) ||
      typeof atencionId !== "string" || !INTENT_ID.test(atencionId)) return;
  const businessRef = db.collection("negocios").doc(businessId);
  const intentRef = businessRef.collection(VETERINARY_SALE_INTENTS).doc(atencionId);
  const attentionRef = businessRef.collection("atencionesVeterinarias").doc(atencionId);
  const [intentSnap, attentionSnap, businessSnap, taxSnap] = await db.getAll(
      intentRef, attentionRef, businessRef, businessRef.collection("configuracion").doc("impuestos"),
  );
  const intent = intentSnap.data();
  const attention = attentionSnap.data();
  if (intent?.negocioId !== businessId || intent.atencionId !== atencionId || intent.estado === "generada" ||
      attention?.negocioId !== businessId || attention.estado !== "finalizada" ||
      attention.finalizadoPorUid !== intent.cerradoPorUid || attention.ventaId) return;
  try {
    const business = businessSnap.data();
    if (business?.estado !== "activo" || business.eliminadoEn) {
      throw new HttpsError("failed-precondition", "La empresa ya no está disponible.");
    }
    assertBusinessModuleEnabled(businessSnap, "veterinaria", HttpsError);
    assertBusinessCanOperate(business, resolveBaseTaxSettings(business, taxSnap.data() || {}), HttpsError);
    const uid = intent.cerradoPorUid;
    const storedRequest = {
      auth: {uid},
      data: {businessId, requestId: requestIdForAttention(businessId, atencionId), venta: intent.venta},
    };
    // La capacidad se origina en el cierre clínico autorizado y guardado.
    // Solo permite invocar el creador del borrador con este documento interno.
    const {venta} = await crearVentaHandler(storedRequest, {
      db,
      FieldValue,
      HttpsError,
      requireBusinessAccess: (request) => {
        if (request !== storedRequest) throw new HttpsError("permission-denied", "Solicitud de venta no autorizada.");
        return {uid, businessId, businessRef};
      },
    }, intent.cerradoEn.toDate());
    await updateSaleStatus(db, intentRef, attentionRef, FieldValue, "generada", {
      ventaId: venta.id, ventaNumero: venta.numero, ventaError: FieldValue.delete(),
    });
  } catch (error) {
    if (!TERMINAL_ERRORS.includes(error.code)) throw error;
    await updateSaleStatus(db, intentRef, attentionRef, FieldValue, "error", {
      ventaError: "Revisa que el tutor y los ítems sigan disponibles en Clientes e Inventario y vuelve a intentar.",
    });
  }
}

module.exports = {deliverVeterinarySale, stageVeterinarySale, VETERINARY_SALE_INTENTS};
