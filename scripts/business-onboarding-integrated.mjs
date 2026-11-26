import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { getBusinessCompletionStatus } from "../src/domain/businessCompletion.mjs";
import { LEGAL_DOCUMENTS_VERSION } from "../src/domain/legalDocuments.mjs";
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

// Rubros que dejaron de ser seleccionables pero siguen en el catálogo.
const RETIRED_CATEGORIES = Object.freeze([
  ["SEGURIDAD_TELECOMUNICACIONES", "Seguridad electrónica y telecomunicaciones"],
  ["AUTOMATIZACION_CONTROL", "Automatización y control"],
  ["MANTENIMIENTO_INSTALACIONES", "Mantenimiento e instalaciones técnicas"],
  ["AUTOMOTRIZ_MOVILIDAD", "Automotriz y movilidad"],
  ["CONSTRUCCION_OBRAS", "Construcción y obras especializadas"],
  ["SOFTWARE_SOLUCIONES_DIGITALES", "Software y soluciones digitales"],
  ["SERVICIOS_DIGITALES_CREATIVOS", "Servicios digitales y creativos"],
]);

const validPayload = Object.freeze({
  nombreComercial: "Mauricio SPA",
  rubroCodigo: "TECNOLOGIA_INFORMATICA",
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
    for (const [retiredCode] of RETIRED_CATEGORIES) {
      await assert.rejects(
        () =>
          ownerCall("createFirstBusiness", {
            nombreComercial: validPayload.nombreComercial,
            rubroCodigo: retiredCode,
            regionCodigo: validPayload.regionCodigo,
            requestId: `business_retired_${retiredCode.toLowerCase()}_001`,
          }),
        (error) =>
          String(error?.code || "").includes("invalid-argument") &&
          String(error?.message || "").includes("Selecciona un rubro válido."),
        retiredCode
      );
    }
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
    // Países cerrados para empresas nuevas: Paraguay (cerrado al abrir Bolivia, acta 7.6.1) y el resto.
    for (const paisCodigo of ["PY", "BR", "PE", "AR", "CO", "EC", "UY", "MX"]) {
      await expectCallableCode("invalid-argument", () =>
        ownerCall("createFirstBusiness", {
          nombreComercial: "Empresa con moneda decimal",
          rubroCodigo: validPayload.rubroCodigo,
          paisCodigo,
          requestId: `business_decimal_country_rejected_${paisCodigo}`,
        })
      );
    }
    // Bolivia: la región enviada se valida contra los departamentos del catálogo del país
    // (un código inexistente o una región de Chile se rechaza; sin región se tolera, como hoy).
    for (const regionCodigo of ["XX", "13"]) {
      await expectCallableCode("invalid-argument", () =>
        ownerCall("createFirstBusiness", {
          nombreComercial: "Empresa Bolivia",
          rubroCodigo: validPayload.rubroCodigo,
          paisCodigo: "BO",
          regionCodigo,
          requestId: `business_bo_region_rejected_${regionCodigo}`,
        })
      );
    }
    // Y un departamento de Bolivia no vale en Chile.
    await expectCallableCode("invalid-argument", () =>
      ownerCall("createFirstBusiness", {
        nombreComercial: "Empresa Chile",
        rubroCodigo: validPayload.rubroCodigo,
        paisCodigo: "CL",
        regionCodigo: "LP",
        requestId: "business_cl_with_bo_region_rejected_001",
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
    // SPEC 033: un rubro sin mapeo deja la lista vacía (no el campo ausente).
    assert.deepEqual(createdBusiness.modulosHabilitados, []);
    assert.deepEqual(firstResponse.data.business.modulosHabilitados, []);
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
    // Campo ausente = lista vacia, en activeBusiness y en businesses[].
    assert.deepEqual(activeSession.data.activeBusiness.modulosHabilitados, []);
    assert.ok(activeSession.data.businesses.length > 0);
    for (const sessionBusiness of activeSession.data.businesses) {
      assert.deepEqual(sessionBusiness.modulosHabilitados, []);
    }
    // El registro de verticales nace vacio en el Core: un id escrito en el
    // documento que no esta en el registro no llega a la sesion. La lista con
    // ids validos se prueba en vertical-modules-smoke con un registro inyectado.
    await adminDb.doc(`negocios/${businessId}`).update({
      modulosHabilitados: ["modulo-desconocido"],
    });
    const unknownModuleSession = await ownerCall("getBusinessSession");
    assert.deepEqual(unknownModuleSession.data.activeBusiness.modulosHabilitados, []);
    await adminDb.doc(`negocios/${businessId}`).update({
      modulosHabilitados: AdminFieldValue.delete(),
    });
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
        rubroCodigo: "INGENIERIA_CONSULTORIA",
        regionEstado: "Exterior",
        validezCotizacionDias: 15,
      },
    });
    assert.equal(upgradedHistoricalBusiness.data.profile.rubroCodigo, "INGENIERIA_CONSULTORIA");
    assert.equal(upgradedHistoricalBusiness.data.profile.rubroNombre, "Ingeniería y consultoría técnica");
    const [upgradedBusiness, upgradedProfile] = await Promise.all([
      adminDb.collection("negocios").doc(businessId).get(),
      adminDb.doc(`negocios/${businessId}/empresa/perfil`).get(),
    ]);
    assert.equal(upgradedBusiness.data()?.rubroCodigo, "INGENIERIA_CONSULTORIA");
    assert.equal(upgradedProfile.data()?.rubroCodigo, "INGENIERIA_CONSULTORIA");
    // Este negocio perdió el campo más arriba (admin lo borró): ausente equivale a [] (SPEC 031).
    const modulesOf = (data) => (Array.isArray(data?.modulosHabilitados) ? data.modulosHabilitados : []);
    assert.deepEqual(modulesOf(upgradedBusiness.data()), [], "el rubro heredado cambió a uno sin módulos: lista vacía");
    // SPEC 039: cambiar el rubro recalcula los módulos: son exactamente los del rubro nuevo.
    const expectedByCategory = {
      TALLER_AUTOMOTRIZ: ["taller"],
      CLINICA_VETERINARIA: ["veterinaria"],
      INGENIERIA_CONSULTORIA: [],
    };
    for (const nextCategory of ["TALLER_AUTOMOTRIZ", "CLINICA_VETERINARIA", "INGENIERIA_CONSULTORIA"]) {
      await ownerCall("updateBusinessProfile", {
        businessId,
        profile: {
          nombreComercial: validPayload.nombreComercial,
          rubroCodigo: nextCategory,
          regionEstado: "Exterior",
          validezCotizacionDias: 15,
        },
      });
      const afterCategoryChange = await adminDb.collection("negocios").doc(businessId).get();
      assert.equal(afterCategoryChange.data()?.rubroCodigo, nextCategory);
      assert.deepEqual(
        modulesOf(afterCategoryChange.data()),
        expectedByCategory[nextCategory],
        `cambiar el rubro a ${nextCategory} deja los módulos de ese rubro`
      );
    }

    // Un negocio que ya tenía un rubro hoy no seleccionable lo conserva al actualizar su perfil.
    for (const [retiredCode, retiredName] of RETIRED_CATEGORIES) {
      await Promise.all([
        adminDb.collection("negocios").doc(businessId).update({
          rubroCodigo: retiredCode,
          rubroNombre: retiredName,
        }),
        adminDb.doc(`negocios/${businessId}/empresa/perfil`).update({
          rubroCodigo: retiredCode,
          rubroNombre: retiredName,
        }),
      ]);
      const preserved = await ownerCall("updateBusinessProfile", {
        businessId,
        profile: {
          nombreComercial: validPayload.nombreComercial,
          rubroCodigo: retiredCode,
          regionEstado: "Exterior",
          validezCotizacionDias: 15,
        },
      });
      assert.equal(preserved.data.profile.rubroCodigo, retiredCode);
      assert.equal(preserved.data.profile.rubroNombre, retiredName);
    }

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

    // SPEC 033: el rubro elegido al crear el negocio habilita sus módulos verticales.
    const categoryClient = createClient("category-modules");
    try {
      const categoryCredential = await createUserWithEmailAndPassword(
        categoryClient.auth,
        `category-modules-${RUN_ID}@example.test`,
        "test-password-123"
      );
      const categoryUid = categoryCredential.user.uid;
      const categoryCall = (name, data = {}) =>
        httpsCallable(categoryClient.functions, name)(data);
      const storedModules = async (id) =>
        (await adminDb.collection("negocios").doc(id).get()).data()?.modulosHabilitados;
      const createdByCategoryUser = async () =>
        (await adminDb.collection("negocios").where("creadoPorUid", "==", categoryUid).get()).size;

      // Primer negocio con Taller automotriz.
      const tallerPayload = {
        nombreComercial: "Taller Los Andes",
        rubroCodigo: "TALLER_AUTOMOTRIZ",
        paisCodigo: "BO",
        monedaCodigo: "USD",
        locale: "en-US",
        identificadorFiscalTipo: "RFC",
        impuestoPredeterminadoTasa: 1,
        requestId: "category_modules_taller_first_001",
      };
      const tallerFirst = await categoryCall("createFirstBusiness", tallerPayload);
      const tallerId = tallerFirst.data.business.id;
      assert.equal(tallerFirst.data.idempotent, false);
      assert.equal(tallerFirst.data.business.rubroCodigo, "TALLER_AUTOMOTRIZ");
      assert.equal(tallerFirst.data.business.rubroNombre, "Taller automotriz");
      assert.deepEqual(tallerFirst.data.business.modulosHabilitados, ["taller"]);
      assert.deepEqual(await storedModules(tallerId), ["taller"]);
      const tallerSession = await categoryCall("getBusinessSession");
      assert.equal(tallerSession.data.activeBusiness.id, tallerId);
      assert.deepEqual(tallerSession.data.activeBusiness.modulosHabilitados, ["taller"]);
      assert.deepEqual(
        tallerSession.data.businesses.find((business) => business.id === tallerId)?.modulosHabilitados,
        ["taller"]
      );

      // Reintento con el mismo requestId: misma respuesta, sin negocio nuevo ni módulos distintos.
      const tallerRetry = await categoryCall("createFirstBusiness", tallerPayload);
      assert.equal(tallerRetry.data.idempotent, true);
      assert.equal(tallerRetry.data.business.id, tallerId);
      assert.deepEqual(tallerRetry.data.business.modulosHabilitados, ["taller"]);
      assert.deepEqual(await storedModules(tallerId), ["taller"]);
      assert.equal(await createdByCategoryUser(), 1);

      // Negocio adicional con Clínica veterinaria.
      const veterinariaPayload = {
        nombreComercial: "Veterinaria Norte",
        rubroCodigo: "CLINICA_VETERINARIA",
        regionCodigo: "01",
        requestId: "category_modules_vet_additional_001",
      };
      const veterinariaAdditional = await categoryCall("createAdditionalBusiness", veterinariaPayload);
      const veterinariaId = veterinariaAdditional.data.business.id;
      assert.equal(veterinariaAdditional.data.idempotent, false);
      assert.equal(veterinariaAdditional.data.business.rubroNombre, "Clínica veterinaria");
      assert.deepEqual(veterinariaAdditional.data.business.modulosHabilitados, ["veterinaria"]);
      assert.deepEqual(await storedModules(veterinariaId), ["veterinaria"]);
      const veterinariaSession = await categoryCall("getBusinessSession");
      assert.equal(veterinariaSession.data.activeBusiness.id, veterinariaId);
      assert.deepEqual(veterinariaSession.data.activeBusiness.modulosHabilitados, ["veterinaria"]);
      assert.deepEqual(
        veterinariaSession.data.businesses.find((business) => business.id === tallerId)?.modulosHabilitados,
        ["taller"],
        "cada negocio conserva sus propios módulos"
      );
      const veterinariaRetry = await categoryCall("createAdditionalBusiness", veterinariaPayload);
      assert.equal(veterinariaRetry.data.idempotent, true);
      assert.equal(veterinariaRetry.data.business.id, veterinariaId);
      assert.deepEqual(veterinariaRetry.data.business.modulosHabilitados, ["veterinaria"]);
      assert.equal(await createdByCategoryUser(), 2);

      // Negocio adicional con Taller automotriz: mismo resultado que el primero.
      const tallerAdditional = await categoryCall("createAdditionalBusiness", {
        nombreComercial: "Taller Sur",
        rubroCodigo: "TALLER_AUTOMOTRIZ",
        regionCodigo: "01",
        requestId: "category_modules_taller_additional_001",
      });
      assert.deepEqual(tallerAdditional.data.business.modulosHabilitados, ["taller"]);
      assert.deepEqual(await storedModules(tallerAdditional.data.business.id), ["taller"]);

      // Negocio adicional con un rubro sin mapeo: lista vacía.
      const plainAdditional = await categoryCall("createAdditionalBusiness", {
        nombreComercial: "Servicios Centro",
        rubroCodigo: "TECNOLOGIA_INFORMATICA",
        regionCodigo: "01",
        requestId: "category_modules_plain_additional_001",
      });
      assert.deepEqual(plainAdditional.data.business.modulosHabilitados, []);
      assert.deepEqual(await storedModules(plainAdditional.data.business.id), []);

      // SPEC 039: cambiar el rubro después recalcula los módulos: Taller a un rubro sin módulo los
      // vacía (los datos del taller no se borran), y de vuelta a Taller reaparece.
      const changeCategory = (businessId, rubroCodigo, viaInformation = false) =>
        categoryCall(viaInformation ? "updateBusinessInformation" : "updateBusinessProfile", {
          businessId,
          profile: {
            nombreComercial: tallerPayload.nombreComercial,
            rubroCodigo,
            regionEstado: "La Paz",
            validezCotizacionDias: 15,
          },
        });
      // Datos del módulo anterior: no se borran al cambiar el rubro.
      await adminDb.doc(`negocios/${tallerId}/vehiculos/vehiculo-spec039`).set({
        negocioId: tallerId,
        patente: "SPEC039",
        creadoEn: AdminFieldValue.serverTimestamp(),
      });
      await changeCategory(tallerId, "TECNOLOGIA_INFORMATICA");
      const tallerAfterChange = await adminDb.collection("negocios").doc(tallerId).get();
      assert.equal(tallerAfterChange.data()?.rubroCodigo, "TECNOLOGIA_INFORMATICA");
      assert.deepEqual(tallerAfterChange.data()?.modulosHabilitados, [], "Taller a un rubro sin módulo: lista vacía");
      assert.equal(
        (await adminDb.doc(`negocios/${tallerId}/vehiculos/vehiculo-spec039`).get()).exists,
        true,
        "los datos del módulo anterior no se borran"
      );
      const sessionWithoutModule = await categoryCall("getBusinessSession");
      assert.deepEqual(
        sessionWithoutModule.data.businesses.find((business) => business.id === tallerId)?.modulosHabilitados,
        []
      );
      // De vuelta a Taller: el módulo reaparece, con los datos intactos.
      await changeCategory(tallerId, "TALLER_AUTOMOTRIZ");
      assert.deepEqual(await storedModules(tallerId), ["taller"]);
      // Entre rubros con módulo: exactamente los del rubro nuevo.
      await changeCategory(tallerId, "CLINICA_VETERINARIA");
      assert.deepEqual(await storedModules(tallerId), ["veterinaria"]);
      // Un rubro sin módulo a otro sin módulo: lista vacía.
      await changeCategory(tallerId, "TECNOLOGIA_INFORMATICA");
      assert.deepEqual(await storedModules(tallerId), []);
      await changeCategory(tallerId, "ELECTRICIDAD_ENERGIA_CLIMATIZACION");
      assert.deepEqual(await storedModules(tallerId), []);
      // Solo cuando el rubro realmente cambia: guardar el mismo rubro no toca la lista guardada.
      await changeCategory(tallerId, "TALLER_AUTOMOTRIZ");
      assert.deepEqual(await storedModules(tallerId), ["taller"]);
      await adminDb.doc(`negocios/${tallerId}`).update({modulosHabilitados: ["taller", "veterinaria"]});
      await changeCategory(tallerId, "TALLER_AUTOMOTRIZ");
      assert.deepEqual(await storedModules(tallerId), ["taller", "veterinaria"], "sin cambio de rubro no se recalcula");
      // La otra Function que escribe el rubro (updateBusinessInformation, la de Empresa) recalcula igual.
      await changeCategory(tallerId, "CLINICA_VETERINARIA", true);
      assert.deepEqual(await storedModules(tallerId), ["veterinaria"]);
      await changeCategory(tallerId, "TECNOLOGIA_INFORMATICA", true);
      assert.deepEqual(await storedModules(tallerId), []);
      await changeCategory(tallerId, "TALLER_AUTOMOTRIZ", true);
      assert.deepEqual(await storedModules(tallerId), ["taller"]);
      const afterChangeSession = await categoryCall("getBusinessSession");
      assert.deepEqual(
        afterChangeSession.data.businesses.find((business) => business.id === tallerId)?.modulosHabilitados,
        ["taller"]
      );
      // Cada negocio conserva los suyos: cambiar el rubro de uno no toca a los demás.
      assert.deepEqual(await storedModules(veterinariaId), ["veterinaria"]);
      // El SDK cliente sigue sin poder escribir el campo.
      await expectDenied(() =>
        updateDoc(doc(categoryClient.db, "negocios", tallerId), {modulosHabilitados: ["taller", "veterinaria"]})
      );
      assert.deepEqual(await storedModules(tallerId), ["taller"]);
    } finally {
      if (categoryClient.auth.currentUser) await signOut(categoryClient.auth);
      await deleteApp(categoryClient.app);
    }

    // SPEC 024 etapa 2: aceptación de términos y privacidad.
    const legalClient = createClient("legal-user");
    const anonymousLegalClient = createClient("legal-anonymous");
    try {
      const ownerLegalSession = await ownerCall("getBusinessSession");
      assert.deepEqual(
        { ...ownerLegalSession.data.legalAcceptance, acceptedAt: null },
        {
          currentVersion: LEGAL_DOCUMENTS_VERSION,
          acceptedVersion: null,
          acceptedAt: null,
          isCurrent: false,
        }
      );

      const legalCredential = await createUserWithEmailAndPassword(
        legalClient.auth,
        `legal-onboarding-${RUN_ID}@example.test`,
        "test-password-123"
      );
      const legalUid = legalCredential.user.uid;
      const legalCall = (name, data = {}) =>
        httpsCallable(legalClient.functions, name)(data);
      const legalUserRef = adminDb.collection("usuarios").doc(legalUid);
      const legalHistoryRef = legalUserRef.collection("aceptacionesLegales");

      await expectCallableCode("unauthenticated", () =>
        httpsCallable(
          anonymousLegalClient.functions,
          "acceptLegalTerms"
        )({ version: LEGAL_DOCUMENTS_VERSION })
      );
      await expectCallableCode("invalid-argument", () =>
        legalCall("acceptLegalTerms", { version: "1999-01-01" })
      );
      await expectCallableCode("invalid-argument", () =>
        legalCall("acceptLegalTerms", {})
      );
      assert.equal((await legalUserRef.get()).exists, false);
      assert.equal((await legalHistoryRef.get()).size, 0);

      const beforeSession = await legalCall("getBusinessSession");
      assert.equal(beforeSession.data.accessState, "onboarding");
      assert.equal(beforeSession.data.legalAcceptance.isCurrent, false);

      const firstAcceptance = await legalCall("acceptLegalTerms", {
        version: LEGAL_DOCUMENTS_VERSION,
      });
      assert.deepEqual(firstAcceptance.data, {
        accepted: true,
        alreadyAccepted: false,
        version: LEGAL_DOCUMENTS_VERSION,
      });
      const acceptedUser = (await legalUserRef.get()).data();
      assert.equal(acceptedUser.aceptacionLegal.version, LEGAL_DOCUMENTS_VERSION);
      assert.ok(acceptedUser.aceptacionLegal.aceptadoEn);
      assert.equal(acceptedUser.email, legalCredential.user.email);
      assert.ok(acceptedUser.creadoEn);
      const historyAfterFirst = await legalHistoryRef.get();
      assert.equal(historyAfterFirst.size, 1);
      assert.equal(historyAfterFirst.docs[0].id, LEGAL_DOCUMENTS_VERSION);
      assert.equal(historyAfterFirst.docs[0].data().uid, legalUid);
      assert.deepEqual(historyAfterFirst.docs[0].data().documentos, [
        "privacidad",
        "terminos",
      ]);

      const acceptedSession = await legalCall("getBusinessSession");
      assert.equal(acceptedSession.data.legalAcceptance.isCurrent, true);
      assert.equal(
        acceptedSession.data.legalAcceptance.acceptedVersion,
        LEGAL_DOCUMENTS_VERSION
      );
      assert.equal(
        acceptedSession.data.legalAcceptance.acceptedAt,
        acceptedUser.aceptacionLegal.aceptadoEn.toDate().toISOString()
      );

      const secondAcceptance = await legalCall("acceptLegalTerms", {
        version: LEGAL_DOCUMENTS_VERSION,
      });
      assert.equal(secondAcceptance.data.alreadyAccepted, true);
      const userAfterSecond = (await legalUserRef.get()).data();
      assert.ok(
        userAfterSecond.aceptacionLegal.aceptadoEn.isEqual(
          acceptedUser.aceptacionLegal.aceptadoEn
        )
      );
      assert.ok(userAfterSecond.creadoEn.isEqual(acceptedUser.creadoEn));
      assert.equal((await legalHistoryRef.get()).size, 1);

      // Versión anterior aceptada: se pide de nuevo y el historial conserva ambas.
      await legalUserRef.set(
        {
          aceptacionLegal: { version: "1999-01-01", aceptadoEn: new Date(0) },
        },
        { merge: true }
      );
      assert.equal(
        (await legalCall("getBusinessSession")).data.legalAcceptance.isCurrent,
        false
      );
      const reacceptance = await legalCall("acceptLegalTerms", {
        version: LEGAL_DOCUMENTS_VERSION,
      });
      assert.equal(reacceptance.data.alreadyAccepted, false);
      assert.equal(
        (await legalUserRef.get()).data().aceptacionLegal.version,
        LEGAL_DOCUMENTS_VERSION
      );

      await legalUserRef.set({ estadoPlataforma: "suspendido" }, { merge: true });
      await legalUserRef.update({
        aceptacionLegal: AdminFieldValue.delete(),
      });
      await expectCallableCode("permission-denied", () =>
        legalCall("acceptLegalTerms", { version: LEGAL_DOCUMENTS_VERSION })
      );
      assert.equal(
        (await legalUserRef.get()).data().aceptacionLegal,
        undefined
      );
      await legalUserRef.set({ estadoPlataforma: "activo" }, { merge: true });

      // El cliente no puede falsear la aceptación ni el historial.
      await expectDenied(() =>
        updateDoc(doc(legalClient.db, "usuarios", legalUid), {
          aceptacionLegal: {
            version: LEGAL_DOCUMENTS_VERSION,
            aceptadoEn: new Date(),
          },
        })
      );
      await expectDenied(() =>
        setDoc(
          doc(
            legalClient.db,
            "usuarios",
            legalUid,
            "aceptacionesLegales",
            "forged"
          ),
          { uid: legalUid, version: LEGAL_DOCUMENTS_VERSION }
        )
      );
      await expectDenied(() =>
        getDocs(collection(legalClient.db, "usuarios", legalUid, "aceptacionesLegales"))
      );
      assert.equal(
        (await legalUserRef.get()).data().aceptacionLegal,
        undefined
      );
    } finally {
      if (legalClient.auth.currentUser) await signOut(legalClient.auth);
      await Promise.all([
        deleteApp(legalClient.app),
        deleteApp(anonymousLegalClient.app),
      ]);
    }

    // Aceptación y primer negocio en ambos órdenes: ninguno pisa los campos
    // del otro en usuarios/{uid}.
    const runLegalOrderScenario = async (name, acceptFirst) => {
      const client = createClient(`legal-order-${name}`);
      try {
        const credential = await createUserWithEmailAndPassword(
          client.auth,
          `legal-order-${name}-${RUN_ID}@example.test`,
          "test-password-123"
        );
        const uid = credential.user.uid;
        const call = (callableName, data = {}) =>
          httpsCallable(client.functions, callableName)(data);
        const userRef = adminDb.collection("usuarios").doc(uid);
        const historyRef = userRef.collection("aceptacionesLegales");
        const accept = () =>
          call("acceptLegalTerms", { version: LEGAL_DOCUMENTS_VERSION });
        const createBusiness = () =>
          call("createFirstBusiness", {
            ...validPayload,
            requestId: `legal_order_${name}_${RUN_ID}`,
          });

        let afterFirstStep;
        if (acceptFirst) {
          assert.equal((await accept()).data.alreadyAccepted, false);
          afterFirstStep = (await userRef.get()).data();
          assert.equal(afterFirstStep.email, credential.user.email);
          assert.ok(afterFirstStep.creadoEn);
          assert.ok(afterFirstStep.aceptacionLegal.aceptadoEn);

          const session = await call("getBusinessSession");
          assert.equal(session.data.accessState, "onboarding");
          assert.equal(session.data.needsOnboarding, true);
          assert.equal(session.data.legalAcceptance.isCurrent, true);

          const created = await createBusiness();
          assert.ok(created.data.business.id);
        } else {
          const created = await createBusiness();
          assert.ok(created.data.business.id);
          afterFirstStep = (await userRef.get()).data();
          assert.equal(afterFirstStep.email, credential.user.email);
          assert.ok(afterFirstStep.creadoEn);
          assert.equal(afterFirstStep.aceptacionLegal, undefined);
          assert.equal((await historyRef.get()).size, 0);

          assert.equal((await accept()).data.alreadyAccepted, false);
        }

        const finalUser = (await userRef.get()).data();
        assert.equal(finalUser.email, credential.user.email);
        assert.ok(finalUser.creadoEn.isEqual(afterFirstStep.creadoEn));
        assert.equal(finalUser.aceptacionLegal.version, LEGAL_DOCUMENTS_VERSION);
        assert.ok(finalUser.aceptacionLegal.aceptadoEn);
        if (acceptFirst) {
          assert.ok(
            finalUser.aceptacionLegal.aceptadoEn.isEqual(
              afterFirstStep.aceptacionLegal.aceptadoEn
            )
          );
        }
        assert.ok(finalUser.negocioActivoId);
        assert.ok(finalUser.primerNegocioId);
        assert.equal(finalUser.negocioActivoId, finalUser.primerNegocioId);

        const history = await historyRef.get();
        assert.equal(history.size, 1);
        assert.equal(history.docs[0].id, LEGAL_DOCUMENTS_VERSION);

        const finalSession = await call("getBusinessSession");
        assert.equal(finalSession.data.accessState, "active");
        assert.equal(finalSession.data.legalAcceptance.isCurrent, true);
      } finally {
        if (client.auth.currentUser) await signOut(client.auth);
        await deleteApp(client.app);
      }
    };
    await runLegalOrderScenario("accept-first", true);
    await runLegalOrderScenario("business-first", false);

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
