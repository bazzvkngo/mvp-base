import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { getBusinessCompletionStatus } from "../src/domain/businessCompletion.mjs";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signOut,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const PROJECT_ID = "tesis-inventario-ia";
const RUN_ID = Date.now().toString(36);
const emulatorEndpoint = (environmentName, fallbackPort) => {
  const [host = "127.0.0.1", port = fallbackPort] = String(
    process.env[environmentName] || `127.0.0.1:${fallbackPort}`
  ).split(":");
  return {host, port: Number(port)};
};
const authEmulator = emulatorEndpoint("FIREBASE_AUTH_EMULATOR_HOST", 9099);
const firestoreEmulator = emulatorEndpoint("FIRESTORE_EMULATOR_HOST", 8080);
const functionsEmulator = emulatorEndpoint("FUNCTIONS_EMULATOR_HOST", 5001);
const requireFromFunctions = createRequire(
  new URL("../functions/package.json", import.meta.url)
);
const {
  deleteApp: deleteAdminApp,
  initializeApp: initializeAdminApp,
} = requireFromFunctions("firebase-admin/app");
const { getFirestore: getAdminFirestore } = requireFromFunctions(
  "firebase-admin/firestore"
);
const { getAuth: getAdminAuth } = requireFromFunctions("firebase-admin/auth");
const { FieldValue: AdminFieldValue } = requireFromFunctions(
  "firebase-admin/firestore"
);
const { getBusinessProfileCompletion } = requireFromFunctions(
  "./businessOnboarding.js"
);

function createClient(name) {
  const app = initializeApp(
    {
      apiKey: "demo-key",
      appId: `demo-${name}`,
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
    },
    name
  );
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, "us-central1");
  connectAuthEmulator(auth, `http://${authEmulator.host}:${authEmulator.port}`, {
    disableWarnings: true,
  });
  connectFirestoreEmulator(
    db,
    firestoreEmulator.host,
    firestoreEmulator.port
  );
  connectFunctionsEmulator(
    functions,
    functionsEmulator.host,
    functionsEmulator.port
  );
  return { app, auth, db, functions };
}

async function expectDenied(operation) {
  await assert.rejects(operation, (error) =>
    String(error?.code || "").includes("permission-denied")
  );
}

async function expectCallableCode(expectedCode, operation) {
  await assert.rejects(operation, (error) =>
    String(error?.code || "").includes(expectedCode)
  );
}

const validPayload = Object.freeze({
  nombreComercial: "Mauricio SPA",
  rubroCodigo: "SOFTWARE_SOLUCIONES_DIGITALES",
  regionCodigo: "01",
});

async function main() {
  const owner = createClient("business-owner");
  const businessAdmin = createClient("business-admin");
  const outsider = createClient("business-outsider");
  const adminApp = initializeAdminApp(
    { projectId: PROJECT_ID },
    "business-onboarding-admin"
  );
  const adminDb = getAdminFirestore(adminApp);
  const adminAuth = getAdminAuth(adminApp);

  try {
    const [ownerCredential, businessAdminCredential, outsiderCredential] = await Promise.all([
      createUserWithEmailAndPassword(
        owner.auth,
        `owner-onboarding-${RUN_ID}@example.test`,
        "test-password-123"
      ),
      createUserWithEmailAndPassword(
        businessAdmin.auth,
        `admin-onboarding-${RUN_ID}@example.test`,
        "test-password-123"
      ),
      createUserWithEmailAndPassword(
        outsider.auth,
        `outsider-onboarding-${RUN_ID}@example.test`,
        "test-password-123"
      ),
    ]);
    const ownerUid = ownerCredential.user.uid;
    const businessAdminUid = businessAdminCredential.user.uid;
    const outsiderUid = outsiderCredential.user.uid;
    const ownerCall = (name, data = {}) =>
      httpsCallable(owner.functions, name)(data);
    const businessAdminCall = (name, data = {}) =>
      httpsCallable(businessAdmin.functions, name)(data);
    const outsiderCall = (name, data = {}) =>
      httpsCallable(outsider.functions, name)(data);

    await expectDenied(() =>
      setDoc(doc(owner.db, "usuarios", ownerUid), {
        email: ownerCredential.user.email,
        negocioActivoId: "forged-business",
      })
    );

    const initialSession = await ownerCall("getBusinessSession");
    assert.equal(initialSession.data.accessState, "onboarding");
    assert.equal(initialSession.data.needsOnboarding, true);

    await expectCallableCode("invalid-argument", () =>
      ownerCall("createFirstBusiness", {
        nombreComercial: "",
        rubroCodigo: validPayload.rubroCodigo,
        requestId: "business_missing_name_001",
      })
    );
    await expectCallableCode("invalid-argument", () =>
      ownerCall("createFirstBusiness", {
        nombreComercial: validPayload.nombreComercial,
        rubroCodigo: "CATEGORIA_INEXISTENTE",
        regionCodigo: validPayload.regionCodigo,
        requestId: "business_unknown_category_001",
      })
    );
    await expectCallableCode("invalid-argument", () =>
      ownerCall("createFirstBusiness", {
        nombreComercial: validPayload.nombreComercial,
        rubroCodigo: "OTRO",
        rubroOtro: "   ",
        regionCodigo: validPayload.regionCodigo,
        requestId: "business_empty_other_001",
      })
    );
    await expectCallableCode("invalid-argument", () =>
      ownerCall("createFirstBusiness", {
        nombreComercial: "Empresa exterior nueva",
        rubroCodigo: validPayload.rubroCodigo,
        paisCodigo: "OTHER",
        requestId: "business_legacy_country_rejected_001",
      })
    );
    assert.equal(
      (
        await adminDb
          .collection("negocios")
          .where("creadoPorUid", "==", ownerUid)
          .get()
      ).size,
      0
    );

    const requestPayload = {
      nombreComercial: validPayload.nombreComercial,
      rubroCodigo: validPayload.rubroCodigo,
      paisCodigo: "BO",
      monedaCodigo: "USD",
      locale: "en-US",
      identificadorFiscalTipo: "RFC",
      impuestoPredeterminadoTasa: 1,
      requestId: "business_create_retry_001",
    };
    const [firstResponse, duplicateResponse] = await Promise.all([
      ownerCall("createFirstBusiness", requestPayload),
      ownerCall("createFirstBusiness", requestPayload),
    ]);
    assert.equal(
      firstResponse.data.business.id,
      duplicateResponse.data.business.id
    );
    const businessId = firstResponse.data.business.id;

    const createdBusinesses = await adminDb
      .collection("negocios")
      .where("creadoPorUid", "==", ownerUid)
      .get();
    assert.equal(createdBusinesses.size, 1);
    const createdBusiness = createdBusinesses.docs[0].data();
    assert.equal(createdBusiness.nombreComercial, validPayload.nombreComercial);
    assert.equal(createdBusiness.regionCodigo, "");
    assert.equal(Object.hasOwn(createdBusiness, "comunaCodigo"), false);
    assert.equal(Object.hasOwn(createdBusiness, "comunaNombre"), false);
    assert.equal(createdBusiness.paisCodigo, "BO");
    assert.equal(createdBusiness.monedaCodigo, "BOB");
    assert.equal(createdBusiness.locale, "es-BO");
    assert.equal(createdBusiness.identificadorFiscalTipo, "NIT");
    assert.equal(createdBusiness.contratoJurisdiccionalVersion, 1);
    assert.equal(createdBusiness.estado, "activo");
    const taxSettings = (await adminDb
      .doc(`negocios/${businessId}/configuracion/impuestos`)
      .get()).data();
    assert.equal(taxSettings.impuestoPredeterminadoNombre, "IVA");
    assert.equal(taxSettings.impuestoPredeterminadoTasa, 13);
    assert.equal(taxSettings.configuracionTributariaBaseCompleta, true);

    const membershipId = `${businessId}__${ownerUid}`;
    const membershipSnapshot = await adminDb
      .collection("membresias")
      .doc(membershipId)
      .get();
    assert.equal(membershipSnapshot.exists, true);
    assert.equal(membershipSnapshot.data().rol, "OWNER");
    assert.equal(membershipSnapshot.data().estado, "activo");
    const userSnapshot = await adminDb.collection("usuarios").doc(ownerUid).get();
    assert.equal(userSnapshot.data().negocioActivoId, businessId);
    assert.equal(userSnapshot.data().primerNegocioId, businessId);
    assert.equal(userSnapshot.data().rubroCodigo, undefined);
    assert.equal(userSnapshot.data().regionCodigo, undefined);
    assert.equal(userSnapshot.data().rut, undefined);

    await Promise.all([
      adminDb.collection("usuarios").doc(businessAdminUid).set({
        email: businessAdminCredential.user.email,
        negocioActivoId: businessId,
        estado: "activo",
      }),
      adminDb.collection("membresias")
        .doc(`${businessId}__${businessAdminUid}`)
        .set({
          negocioId: businessId,
          uid: businessAdminUid,
          rol: "ADMIN",
          estado: "activo",
        }),
    ]);

    const blockedOperationalCalls = [
      ["crearCliente", {businessId, cliente: {nombreRazonSocial: "Bloqueado"}}],
      ["crearProveedor", {businessId, requestId: `blocked-provider-${RUN_ID}`, proveedor: {razonSocial: "Bloqueado"}}],
      ["listarMiembrosNegocio", {businessId}],
      ["obtenerBalanceTrabajo", {businessId, trabajoId: "blocked-work"}],
      ["initializeInventoryCatalog", {businessId}],
      ["normalizeInventoryItems", {businessId, fileData: {hojas: [{nombre: "Hoja 1", filas: [["item"]]}]}}],
      ["suggestQuoteItems", {businessId, description: "Trabajo bloqueado"}],
    ];
    for (const [functionName, payload] of blockedOperationalCalls) {
      await expectCallableCode("failed-precondition", () =>
        ownerCall(functionName, payload)
      );
    }
    for (const state of ["EN_REVISION", "RECHAZADA"]) {
      await adminDb.collection("negocios").doc(businessId).update({
        verificacionEmpresa: {estado: state},
      });
      await expectCallableCode("failed-precondition", () =>
        ownerCall("listarMiembrosNegocio", {businessId})
      );
    }
    await adminDb.collection("negocios").doc(businessId).update({
      verificacionEmpresa: {estado: "VERIFICADA"},
    });
    const verifiedMembers = await ownerCall("listarMiembrosNegocio", {businessId});
    assert.equal(verifiedMembers.data.miembros.length, 2);
    await adminDb.collection("negocios").doc(businessId).update({
      verificacionEmpresa: {estado: "NO_VERIFICADA"},
    });
    console.log("OK hard gate Functions: estados bloqueados y VERIFICADA habilita");

    const quickProfile = await adminDb
      .doc(`negocios/${businessId}/empresa/perfil`)
      .get();
    assert.equal(quickProfile.data()?.nombreComercial, validPayload.nombreComercial);
    assert.equal(quickProfile.data()?.rubroCodigo, validPayload.rubroCodigo);
    assert.equal(quickProfile.data()?.regionCodigo, "");
    assert.equal(quickProfile.data()?.paisCodigo, "BO");
    assert.equal(quickProfile.data()?.monedaCodigo, "BOB");
    assert.equal(quickProfile.data()?.rut, undefined);
    assert.equal(quickProfile.data()?.comunaCodigo, undefined);
    assert.equal(
      getBusinessProfileCompletion(quickProfile.data()).minimumComplete,
      false
    );
    assert.equal(
      getBusinessProfileCompletion(quickProfile.data()).recommendedComplete,
      false
    );

    const activeSession = await ownerCall("getBusinessSession");
    assert.equal(activeSession.data.accessState, "active");
    assert.equal(activeSession.data.needsOnboarding, false);
    assert.equal(activeSession.data.activeBusiness.id, businessId);
    assert.equal(activeSession.data.activeBusiness.role, "OWNER");
    assert.equal(activeSession.data.activeBusiness.ownerEmailVerified, false);
    assert.equal(activeSession.data.activeBusiness.paisCodigo, "BO");
    assert.equal(activeSession.data.activeBusiness.monedaCodigo, "BOB");
    const adminSession = await businessAdminCall("getBusinessSession");
    assert.equal(adminSession.data.activeBusiness.role, "ADMIN");
    assert.equal(adminSession.data.activeBusiness.ownerEmailVerified, false);
    const ownerPendingCompletion = getBusinessCompletionStatus(
      quickProfile.data(),
      {ownerEmailVerified: activeSession.data.activeBusiness.ownerEmailVerified}
    );
    const adminPendingCompletion = getBusinessCompletionStatus(
      quickProfile.data(),
      {ownerEmailVerified: adminSession.data.activeBusiness.ownerEmailVerified}
    );
    assert.equal(ownerPendingCompletion.percent, adminPendingCompletion.percent);
    assert.equal(
      ownerPendingCompletion.pendingItems.some((item) => item.id === "ownerEmail"),
      true
    );

    await adminAuth.updateUser(ownerUid, {emailVerified: true});
    const [verifiedOwnerSession, verifiedAdminSession] = await Promise.all([
      ownerCall("getBusinessSession"),
      businessAdminCall("getBusinessSession"),
    ]);
    assert.equal(verifiedOwnerSession.data.activeBusiness.ownerEmailVerified, true);
    assert.equal(verifiedAdminSession.data.activeBusiness.ownerEmailVerified, true);
    const ownerVerifiedCompletion = getBusinessCompletionStatus(
      quickProfile.data(),
      {ownerEmailVerified: verifiedOwnerSession.data.activeBusiness.ownerEmailVerified}
    );
    const adminVerifiedCompletion = getBusinessCompletionStatus(
      quickProfile.data(),
      {ownerEmailVerified: verifiedAdminSession.data.activeBusiness.ownerEmailVerified}
    );
    assert.equal(ownerVerifiedCompletion.percent, adminVerifiedCompletion.percent);
    assert.equal(ownerVerifiedCompletion.percent, ownerPendingCompletion.percent + 10);

    const profileUpdate = await ownerCall("updateBusinessProfile", {
      businessId,
      profile: {
        nombreComercial: validPayload.nombreComercial,
        rubroCodigo: validPayload.rubroCodigo,
        regionEstado: "La Paz",
        direccion: "Avenida Principal 100",
        telefono: "+56 9 1234 5678",
        email: "contacto@andes.example",
        sitioWeb: "https://andes.example",
        validezCotizacionDias: 15,
      },
    });
    assert.equal(profileUpdate.data.completion.minimumComplete, true);
    assert.equal(profileUpdate.data.completion.recommendedComplete, false);
    const savedProfile = await adminDb
      .doc(`negocios/${businessId}/empresa/perfil`)
      .get();
    assert.equal(savedProfile.data()?.paisCodigo, "BO");
    assert.equal(savedProfile.data()?.monedaCodigo, "BOB");
    assert.equal(savedProfile.data()?.locale, "es-BO");
    assert.equal(savedProfile.data()?.identificadorFiscalTipo, "NIT");
    assert.equal(savedProfile.data()?.rut, undefined);
    assert.equal(savedProfile.data()?.negocioId, businessId);
    assert.equal(
      (await adminDb.collection("usuarios").doc(ownerUid).get()).data()?.rut,
      undefined
    );
    await expectCallableCode("permission-denied", () =>
      outsiderCall("updateBusinessProfile", {
        businessId,
        profile: {
          ...validPayload,
          paisCodigo: "CL",
          monedaCodigo: "CLP",
        },
      })
    );
    await expectCallableCode("failed-precondition", () =>
      ownerCall("updateBusinessProfile", {
        businessId,
        profile: {
          ...validPayload,
          paisCodigo: "CL",
          monedaCodigo: "CLP",
          comunaCodigo: "13101",
        },
      })
    );
    await expectCallableCode("failed-precondition", () =>
      businessAdminCall("updateBusinessInformation", {
        businessId,
        profile: {
          nombreComercial: validPayload.nombreComercial,
          rubroCodigo: validPayload.rubroCodigo,
          regionEstado: "La Paz",
          locale: "en-US",
        },
      })
    );
    await expectCallableCode("failed-precondition", () =>
      businessAdminCall("updateBusinessSettings", {
        businessId,
        section: "impuestos",
        settings: {
          impuestoPredeterminadoNombre: "IVA alterado",
          impuestoPredeterminadoTasa: 1,
        },
      })
    );

    const regionChange = await ownerCall("updateBusinessProfile", {
      businessId,
      profile: {
        nombreComercial: validPayload.nombreComercial,
        rubroCodigo: validPayload.rubroCodigo,
        regionEstado: "Santa Cruz",
        validezCotizacionDias: 15,
      },
    });
    assert.equal(regionChange.data.profile.regionEstado, "Santa Cruz");
    assert.equal(regionChange.data.profile.comunaCodigo, "");
    const [profileAfterRegionChange, businessAfterRegionChange] =
      await Promise.all([
        adminDb.doc(`negocios/${businessId}/empresa/perfil`).get(),
        adminDb.collection("negocios").doc(businessId).get(),
      ]);
    assert.equal(profileAfterRegionChange.data()?.comunaCodigo, undefined);
    assert.equal(profileAfterRegionChange.data()?.comunaNombre, undefined);
    assert.equal(profileAfterRegionChange.data()?.ciudad, undefined);
    assert.equal(businessAfterRegionChange.data()?.comunaCodigo, undefined);

    const legacyCountryPatch = {
      paisCodigo: "OTHER",
      paisNombre: "Otro país",
      monedaCodigo: "EUR",
      monedaNombre: "Euro",
      locale: "es",
      regionCodigo: "",
      regionNombre: "Exterior",
      regionEstado: "Exterior",
    };
    await Promise.all([
      adminDb.collection("negocios").doc(businessId).update({
        ...legacyCountryPatch,
        contratoJurisdiccionalVersion: AdminFieldValue.delete(),
      }),
      adminDb.doc(`negocios/${businessId}/empresa/perfil`).update({
        ...legacyCountryPatch,
        contratoJurisdiccionalVersion: AdminFieldValue.delete(),
      }),
    ]);
    const preservedLegacyCountry = await ownerCall("updateBusinessProfile", {
      businessId,
      profile: {
        nombreComercial: "Mauricio SPA actualizado",
        rubroCodigo: validPayload.rubroCodigo,
        paisCodigo: "OTHER",
        monedaCodigo: "EUR",
        locale: "es",
        regionEstado: "Exterior",
        telefono: "+00 123456",
      },
    });
    assert.equal(preservedLegacyCountry.data.profile.paisCodigo, "OTHER");
    assert.equal(preservedLegacyCountry.data.profile.monedaCodigo, "EUR");
    assert.equal(preservedLegacyCountry.data.profile.telefono, "+00 123456");
    await expectCallableCode("failed-precondition", () =>
      ownerCall("updateBusinessProfile", {
        businessId,
        profile: {
          ...validPayload,
          paisCodigo: "CL",
          monedaCodigo: "CLP",
        },
      })
    );

    await Promise.all([
      adminDb.collection("negocios").doc(businessId).update({
        rubroCodigo: "RUBRO_HISTORICO",
        rubroNombre: "Oficio histórico",
      }),
      adminDb.doc(`negocios/${businessId}/empresa/perfil`).update({
        rubroCodigo: "RUBRO_HISTORICO",
        rubroNombre: "Oficio histórico",
      }),
    ]);
    const historicalUpdate = await ownerCall("updateBusinessProfile", {
      businessId,
      profile: {
        nombreComercial: validPayload.nombreComercial,
        rubroCodigo: "RUBRO_HISTORICO",
        rubroNombre: "Oficio histórico",
        regionEstado: "Exterior",
        validezCotizacionDias: 15,
      },
    });
    assert.equal(historicalUpdate.data.profile.rubroCodigo, "RUBRO_HISTORICO");
    assert.equal(historicalUpdate.data.profile.rubroNombre, "Oficio histórico");

    await Promise.all([
      adminDb.collection("negocios").doc(businessId).update({
        rubroCodigo: AdminFieldValue.delete(),
        rubroNombre: "Oficio ancestral",
      }),
      adminDb.doc(`negocios/${businessId}/empresa/perfil`).update({
        rubroCodigo: AdminFieldValue.delete(),
        rubroNombre: "Oficio ancestral",
      }),
    ]);
    const textOnlyHistoricalUpdate = await ownerCall("updateBusinessProfile", {
      businessId,
      profile: {
        nombreComercial: validPayload.nombreComercial,
        rubroCodigo: "",
        rubroNombre: "Oficio ancestral",
        regionEstado: "Exterior",
        validezCotizacionDias: 15,
      },
    });
    assert.equal(textOnlyHistoricalUpdate.data.profile.rubroCodigo, undefined);
    assert.equal(textOnlyHistoricalUpdate.data.profile.rubroNombre, "Oficio ancestral");
    assert.equal(textOnlyHistoricalUpdate.data.completion.minimumComplete, true);

    const upgradedHistoricalBusiness = await ownerCall("updateBusinessProfile", {
      businessId,
      profile: {
        nombreComercial: validPayload.nombreComercial,
        rubroCodigo: "AUTOMOTRIZ_MOVILIDAD",
        regionEstado: "Exterior",
        validezCotizacionDias: 15,
      },
    });
    assert.equal(upgradedHistoricalBusiness.data.profile.rubroCodigo, "AUTOMOTRIZ_MOVILIDAD");
    assert.equal(upgradedHistoricalBusiness.data.profile.rubroNombre, "Automotriz y movilidad");
    const [upgradedBusiness, upgradedProfile] = await Promise.all([
      adminDb.collection("negocios").doc(businessId).get(),
      adminDb.doc(`negocios/${businessId}/empresa/perfil`).get(),
    ]);
    assert.equal(upgradedBusiness.data()?.rubroCodigo, "AUTOMOTRIZ_MOVILIDAD");
    assert.equal(upgradedProfile.data()?.rubroCodigo, "AUTOMOTRIZ_MOVILIDAD");

    const secondRequest = await ownerCall("createFirstBusiness", {
      ...validPayload,
      nombreComercial: "Intento de duplicado",
      requestId: "business_create_second_001",
    });
    assert.equal(secondRequest.data.business.id, businessId);
    assert.equal(secondRequest.data.idempotent, true);
    assert.equal(
      (
        await adminDb
          .collection("negocios")
          .where("creadoPorUid", "==", ownerUid)
          .get()
      ).size,
      1
    );
    await expectCallableCode("failed-precondition", () =>
      ownerCall("createFirstBusiness", {
        ...validPayload,
        nombreComercial: "Cambio sobre la misma solicitud",
        requestId: "business_create_retry_001",
      })
    );

    assert.equal((await getDoc(doc(owner.db, "negocios", businessId))).exists(), true);
    await expectDenied(() =>
      getDoc(doc(outsider.db, "negocios", businessId))
    );
    await expectDenied(() =>
      setDoc(doc(outsider.db, "negocios", "forged-business"), {
        nombreComercial: "No permitido",
        estado: "activo",
      })
    );
    await expectDenied(() =>
      setDoc(doc(outsider.db, "membresias", `${businessId}__${outsiderUid}`), {
        negocioId: businessId,
        uid: outsiderUid,
        rol: "OWNER",
        estado: "activo",
      })
    );
    await expectDenied(() =>
      updateDoc(doc(owner.db, "usuarios", ownerUid), {
        negocioActivoId: "forged-business",
      })
    );

    const outsiderSession = await outsiderCall("getBusinessSession");
    assert.equal(outsiderSession.data.accessState, "onboarding");
    assert.equal(outsiderSession.data.membershipCount, 0);

    const otherBusiness = await outsiderCall("createFirstBusiness", {
      nombreComercial: "Taller Experimental",
      rubroCodigo: "OTRO_SERVICIO_PROYECTOS",
      regionCodigo: "01",
      comunaCodigo: "",
      requestId: "business_other_category_001",
    });
    assert.equal(otherBusiness.data.business.rubroCodigo, "OTRO_SERVICIO_PROYECTOS");
    assert.equal(otherBusiness.data.business.rubroNombre, "Otro servicio por proyectos");
    const storedOtherBusiness = await adminDb
      .collection("negocios")
      .doc(otherBusiness.data.business.id)
      .get();
    assert.equal(storedOtherBusiness.data()?.rubroNombre, "Otro servicio por proyectos");
    assert.equal(storedOtherBusiness.data()?.rubroOtro, undefined);
    assert.equal(storedOtherBusiness.data()?.comunaCodigo, undefined);

    const fallbackBusinessRef = adminDb.collection("negocios").doc();
    const fallbackMembershipRef = adminDb
      .collection("membresias")
      .doc(`${fallbackBusinessRef.id}__${ownerUid}`);
    await Promise.all([
      fallbackBusinessRef.set({
        ...validPayload,
        rubroNombre: "Ingeniería y consultoría técnica",
        paisNombre: "Chile",
        regionNombre: "Metropolitana de Santiago",
        comunaNombre: "Santiago",
        monedaNombre: "Peso chileno",
        estado: "activo",
        creadoPorUid: ownerUid,
      }),
      fallbackMembershipRef.set({
        negocioId: fallbackBusinessRef.id,
        uid: ownerUid,
        rol: "ADMIN",
        estado: "activo",
      }),
      adminDb.collection("usuarios").doc(ownerUid).set(
        { negocioActivoId: "missing-business" },
        { merge: true }
      ),
    ]);
    const fallbackSession = await ownerCall("getBusinessSession");
    assert.equal(fallbackSession.data.accessState, "active");
    assert.ok([businessId, fallbackBusinessRef.id].includes(
      fallbackSession.data.activeBusiness.id
    ));
    assert.equal(
      (await adminDb.collection("usuarios").doc(ownerUid).get()).data()
        .negocioActivoId,
      fallbackSession.data.activeBusiness.id
    );

    await Promise.all([
      adminDb.collection("negocios").doc(businessId).update({ estado: "inactivo" }),
      fallbackBusinessRef.update({ estado: "inactivo" }),
    ]);
    const unavailableSession = await ownerCall("getBusinessSession");
    assert.equal(unavailableSession.data.accessState, "onboarding");
    assert.equal(unavailableSession.data.needsOnboarding, true);
    await expectDenied(() => getDoc(doc(owner.db, "negocios", businessId)));

    const ownerMemberships = await getDocs(
      query(
        collection(owner.db, "membresias"),
        where("uid", "==", ownerUid)
      )
    );
    assert.equal(ownerMemberships.size, 2);
    await expectDenied(() =>
      getDocs(
        query(
          collection(outsider.db, "membresias"),
          where("uid", "==", ownerUid)
        )
      )
    );

    console.log(
      "BUSINESS_ONBOARDING_INTEGRATED_OK",
      JSON.stringify({
        ownerUid,
        outsiderUid,
        businessId,
        role: membershipSnapshot.data().rol,
        duplicateCreatePrevented: true,
        isolationVerified: true,
        inactiveBusinessState: unavailableSession.data.accessState,
        quickCreationVerified: true,
        companyProfileUpdateVerified: true,
      })
    );
  } finally {
    await Promise.all([
      owner.auth.currentUser ? signOut(owner.auth) : Promise.resolve(),
      businessAdmin.auth.currentUser
        ? signOut(businessAdmin.auth)
        : Promise.resolve(),
      outsider.auth.currentUser ? signOut(outsider.auth) : Promise.resolve(),
    ]);
    await Promise.all([
      deleteApp(owner.app),
      deleteApp(businessAdmin.app),
      deleteApp(outsider.app),
      deleteAdminApp(adminApp),
    ]);
  }
}

main().catch((error) => {
  console.error(
    "BUSINESS_ONBOARDING_INTEGRATED_FAILED",
    error?.code || "",
    error?.message || error
  );
  process.exitCode = 1;
});
