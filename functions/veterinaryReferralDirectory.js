"use strict";

const {
  canReceiveVeterinaryReferral,
  getVeterinaryProfessionalDisplayName,
  getVeterinaryProfessionalProfileRef,
  requireVeterinaryProfessionalAccess,
} = require("./veterinaryProfessionalAccess");

async function listarProfesionalesDerivacionVeterinariaHandler(request, dependencies) {
  const {db, HttpsError} = dependencies;
  const {assignedOnly, businessId, businessRef, uid} = await requireVeterinaryProfessionalAccess(request, dependencies);
  const atencionId = request.data?.atencionId;
  if (typeof atencionId !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(atencionId)) {
    throw new HttpsError("invalid-argument", "Selecciona una atención válida.");
  }

  const attention = (await businessRef.collection("atencionesVeterinarias").doc(atencionId).get()).data();
  if (attention?.negocioId !== businessId || (assignedOnly && attention.profesionalUid !== uid)) {
    throw new HttpsError("not-found", "La atención no está disponible.");
  }
  if (attention.estado !== "en_atencion") {
    throw new HttpsError("failed-precondition", "Abre la atención para elegir un profesional de la clínica.");
  }

  const memberships = await db.collection("membresias").where("negocioId", "==", businessId)
      .where("estado", "==", "activo").where("rol", "==", "MEMBER").get();
  const candidates = memberships.docs.flatMap((snapshot) => {
    const member = snapshot.data();
    if (typeof member.uid !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(member.uid) ||
        snapshot.id !== `${businessId}__${member.uid}`) return [];
    const profileRef = getVeterinaryProfessionalProfileRef(businessRef, member);
    return profileRef ? [{member, profileRef}] : [];
  });
  if (!candidates.length) return {profesionales: []};

  const refs = [...new Map(candidates.map(({profileRef}) => [profileRef.path, profileRef])).values()];
  const profiles = new Map((await db.getAll(...refs)).map((profile) => [profile.ref.path, profile.data()]));
  const professionals = candidates.filter(({member, profileRef}) =>
    canReceiveVeterinaryReferral(member, profiles.get(profileRef.path), {businessId, uid: member.uid}),
  );
  const profesionales = await Promise.all(professionals.map(async ({member}) => ({
    uid: member.uid,
    nombre: await getVeterinaryProfessionalDisplayName(db, member.uid),
  })));
  return {profesionales: profesionales.sort((left, right) => left.nombre.localeCompare(right.nombre, "es"))};
}

module.exports = {listarProfesionalesDerivacionVeterinariaHandler};
