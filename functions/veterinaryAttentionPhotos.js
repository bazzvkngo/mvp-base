"use strict";

const {createHash} = require("node:crypto");

const {isVeterinaryJpeg} = require("./veterinaryJpeg");

const MAX_RETIRED = 24;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PHOTOS = 12;
const MAX_MARKS = 20;
const VIEWS = ["general", "frontal", "lateral-izquierda", "lateral-derecha", "trasera", "superior", "inferior", "detalle"];
const validId = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(value);

function normalizeMarks(marks, HttpsError) {
  if (!Array.isArray(marks) || marks.length > MAX_MARKS) {
    throw new HttpsError("invalid-argument", "Puedes guardar hasta 20 marcas por foto.");
  }
  return marks.map((mark) => {
    const label = typeof mark?.zona === "string" ? mark.zona.trim() : "";
    const note = typeof mark?.nota === "string" ? mark.nota.trim() : "";
    if (!label || label.length > 100 || note.length > 500 ||
        ![mark.x, mark.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
      throw new HttpsError("invalid-argument", "Cada marca necesita una zona y una posición válida.");
    }
    return {zona: label, nota: note, x: mark.x, y: mark.y};
  });
}

async function fotosAtencionVeterinariaHandler(request, {db, bucket, HttpsError, FieldValue, requireBusinessAccess}) {
  const {uid, businessId, businessRef} = await requireBusinessAccess(
      request, {db, HttpsError}, {roles: ["OWNER", "ADMIN"], requiredVerticalModule: "veterinaria"},
  );
  const {operacion, atencionId, fotoId, vista, imagen, marcas, giro, revision} = request.data;
  if (!["subir", "leer", "mapear", "quitar"].includes(operacion) || !validId(atencionId) || !validId(fotoId)) {
    throw new HttpsError("invalid-argument", "Selecciona una atención y una foto válidas.");
  }
  const attentionRef = businessRef.collection("atencionesVeterinarias").doc(atencionId);
  const file = bucket.file("negocios/" + businessId + "/atencionesVeterinarias/" + atencionId + "/fotos/" + fotoId + ".jpg");
  const retiredRef = attentionRef.collection("fotosRetiradas").doc(fotoId);
  const photoFrom = (attention) => (attention.fotosClinicas ?? []).find((photo) => photo.fotoId === fotoId);
  const requireAttention = (snapshot, writable) => {
    const attention = snapshot.data();
    if (!attention || attention.negocioId !== businessId) {
      throw new HttpsError("not-found", "La atención no está disponible.");
    }
    if (writable && attention.estado !== "en_atencion") {
      throw new HttpsError("failed-precondition", "Solo puedes agregar fotos o marcas durante una atención abierta.");
    }
    return attention;
  };

  if (operacion === "leer") {
    const attention = requireAttention(await attentionRef.get(), false);
    if (!photoFrom(attention)) throw new HttpsError("not-found", "La foto no está disponible.");
    const [bytes] = await file.download();
    return {imagen: bytes.toString("base64")};
  }

  if (operacion === "quitar") {
    await db.runTransaction(async (tx) => {
      const attention = requireAttention(await tx.get(attentionRef), true);
      const retired = attention.fotosRetiradas ?? [];
      const tombstone = await tx.get(retiredRef);
      if (tombstone.exists || retired.some((photo) => photo.fotoId === fotoId)) return;
      const photo = photoFrom(attention);
      if (!photo) throw new HttpsError("not-found", "La foto no está disponible.");
      // Conserva los ID retirados aunque salgan del historial visible.
      for (const previous of retired.slice(0, Math.max(0, retired.length - MAX_RETIRED + 1))) {
        tx.set(attentionRef.collection("fotosRetiradas").doc(previous.fotoId), {retirada: true}, {merge: true});
      }
      tx.create(retiredRef, {retiradaEn: FieldValue.serverTimestamp(), retiradaPorUid: uid});
      tx.update(attentionRef, {
        fotosClinicas: attention.fotosClinicas.filter((item) => item.fotoId !== fotoId),
        fotosRetiradas: [...retired, {...photo, retiradaEn: new Date(), retiradaPorUid: uid}].slice(-MAX_RETIRED),
        actualizadoEn: FieldValue.serverTimestamp(),
        actualizadoPorUid: uid,
      });
    });
    return {fotoId};
  }

  if (operacion === "mapear") {
    if (![0, 90, 180, 270].includes(giro) || !Number.isSafeInteger(revision) || revision < 0) throw new HttpsError("invalid-argument", "El giro de la foto no es válido.");
    const normalized = normalizeMarks(marcas, HttpsError);
    const nextRevision = await db.runTransaction(async (tx) => {
      const attention = requireAttention(await tx.get(attentionRef), true);
      const current = photoFrom(attention);
      if (!current) throw new HttpsError("not-found", "La foto no está disponible.");
      if ((current.revision ?? 0) !== revision) {
        throw new HttpsError("failed-precondition", "Otra sesión modificó este mapa. Vuelve a abrir la foto y revisa las marcas.");
      }
      tx.update(attentionRef, {
        fotosClinicas: attention.fotosClinicas.map((photo) =>
          photo.fotoId === fotoId ? {...photo, marcas: normalized, giro, revision: revision + 1} : photo),
        actualizadoEn: FieldValue.serverTimestamp(),
        actualizadoPorUid: uid,
      });
      return revision + 1;
    });
    return {fotoId, revision: nextRevision};
  }

  if (!VIEWS.includes(vista) || typeof imagen !== "string" || imagen.length > Math.ceil(MAX_BYTES / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(imagen)) {
    throw new HttpsError("invalid-argument", "Selecciona una vista y una foto JPEG de hasta 2 MiB.");
  }
  const bytes = Buffer.from(imagen, "base64");
  if (bytes.length > MAX_BYTES || !isVeterinaryJpeg(bytes)) {
    throw new HttpsError("invalid-argument", "La imagen debe ser un JPEG válido de hasta 2 MiB.");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  const initial = requireAttention(await attentionRef.get(), true);
  if ((await retiredRef.get()).exists || initial.fotosRetiradas?.some((photo) => photo.fotoId === fotoId)) {
    throw new HttpsError("failed-precondition", "Esta foto ya fue retirada.");
  }
  const existing = photoFrom(initial);
  if (existing) {
    if (existing.hash === digest && existing.vista === vista) return {fotoId};
    throw new HttpsError("already-exists", "Ya existe una foto con ese identificador.");
  }
  if ((initial.fotosClinicas ?? []).length >= MAX_PHOTOS) {
    throw new HttpsError("failed-precondition", "Puedes guardar hasta 12 fotos por atención.");
  }

  let created = false;
  try {
    await file.save(bytes, {
      resumable: false,
      contentType: "image/jpeg",
      metadata: {metadata: {sha256: digest, vista}},
      preconditionOpts: {ifGenerationMatch: 0},
    });
    created = true;
  } catch (error) {
    if (Number(error.code) !== 412) throw error;
    const [metadata] = await file.getMetadata();
    if (metadata.metadata?.sha256 !== digest || metadata.metadata?.vista !== vista) {
      throw new HttpsError("already-exists", "Ya existe una foto con ese identificador.");
    }
  }
  await db.runTransaction(async (tx) => {
    const attention = requireAttention(await tx.get(attentionRef), true);
    if (photoFrom(attention)) return;
    if ((await tx.get(retiredRef)).exists || attention.fotosRetiradas?.some((photo) => photo.fotoId === fotoId)) {
      throw new HttpsError("failed-precondition", "Esta foto ya fue retirada.");
    }
    const photos = attention.fotosClinicas ?? [];
    if (photos.length >= MAX_PHOTOS) throw new HttpsError("failed-precondition", "Puedes guardar hasta 12 fotos por atención.");
    tx.update(attentionRef, {
      fotosClinicas: [...photos, {fotoId, vista, hash: digest, giro: 0, marcas: [], subidaPorUid: uid}],
      actualizadoEn: FieldValue.serverTimestamp(),
      actualizadoPorUid: uid,
    });
  }).catch(async (error) => {
    if (created && ["not-found", "failed-precondition"].includes(error.code)) {
      const current = (await attentionRef.get()).data();
      if (!(await retiredRef.get()).exists && (!current || (!photoFrom(current) && !current.fotosRetiradas?.some((photo) => photo.fotoId === fotoId)))) {
        const [metadata] = await file.getMetadata();
        await file.delete({ifGenerationMatch: metadata.generation});
      }
    }
    throw error;
  });
  return {fotoId};
}

module.exports = {fotosAtencionVeterinariaHandler};
