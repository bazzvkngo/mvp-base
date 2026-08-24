import assert from "node:assert/strict";
import { createRequire } from "node:module";
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
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
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
  const outsider = createClient("business-outsider");
  const adminApp = initializeAdminApp(
    { projectId: PROJECT_ID },
    "business-onboarding-admin"
  );
  const adminDb = getAdminFirestore(adminApp);

  try {
    const [ownerCredential, outsiderCredential] = await Promise.all([
      createUserWithEmailAndPassword(
        owner.auth,
        `owner-onboarding-${RUN_ID}@example.test`,
        "test-password-123"
      ),
      createUserWithEmailAndPassword(
        outsider.auth,
        `outsider-onboarding-${RUN_ID}@example.test`,
        "test-password-123"
      ),
    ]);
    const ownerUid = ownerCredential.user.uid;
    const outsiderUid = outsiderCredential.user.uid;
    const ownerCall = (name, data = {}) =>
      httpsCallable(owner.functions, name)(data);
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
        nombreComercial: validPayload.nombreComercial,
        rubroCodigo: validPayload.rubroCodigo,
        requestId: "business_missing_region_001",
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
      ...validPayload,
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
    assert.equal(createdBusiness.regionCodigo, "01");
    assert.equal(Object.hasOwn(createdBusiness, "comunaCodigo"), false);
    assert.equal(Object.hasOwn(createdBusiness, "comunaNombre"), false);
    assert.equal(createdBusiness.paisCodigo, "CL");
    assert.equal(createdBusiness.monedaCodigo, "CLP");
    assert.equal(createdBusiness.estado, "activo");

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

    const quickProfile = await adminDb
      .doc(`negocios/${businessId}/empresa/perfil`)
      .get();
    assert.equal(quickProfile.data()?.nombreComercial, validPayload.nombreComercial);
    assert.equal(quickProfile.data()?.rubroCodigo, validPayload.rubroCodigo);
    assert.equal(quickProfile.data()?.regionCodigo, "01");
    assert.equal(quickProfile.data()?.paisCodigo, "CL");
    assert.equal(quickProfile.data()?.monedaCodigo, "CLP");
    assert.equal(quickProfile.data()?.rut, undefined);
    assert.equal(quickProfile.data()?.comunaCodigo, undefined);
    assert.equal(
      getBusinessProfileCompletion(quickProfile.data()).recommendedComplete,
      false
    );

    const activeSession = await ownerCall("getBusinessSession");
    assert.equal(activeSession.data.accessState, "active");
    assert.equal(activeSession.data.needsOnboarding, false);
    assert.equal(activeSession.data.activeBusiness.id, businessId);
    assert.equal(activeSession.data.activeBusiness.role, "OWNER");

    const profileUpdate = await ownerCall("updateBusinessProfile", {
      businessId,
      profile: {
        ...validPayload,
        paisCodigo: "CL",
        monedaCodigo: "CLP",
        comunaCodigo: "01101",
        razonSocial: "Mauricio SPA",
        rut: "12.345.678-5",
        direccion: "Avenida Principal 100",
        telefono: "+56 9 1234 5678",
        email: "contacto@andes.example",
        sitioWeb: "https://andes.example",
        validezCotizacionDias: 15,
      },
    });
    assert.equal(profileUpdate.data.completion.minimumComplete, true);
    assert.equal(profileUpdate.data.completion.recommendedComplete, true);
    const savedProfile = await adminDb
      .doc(`negocios/${businessId}/empresa/perfil`)
      .get();
    assert.equal(savedProfile.data()?.comunaCodigo, "01101");
    assert.equal(savedProfile.data()?.rut, "12345678-5");
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
    await expectCallableCode("invalid-argument", () =>
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

    const regionChange = await ownerCall("updateBusinessProfile", {
      businessId,
      profile: {
        ...validPayload,
        regionCodigo: "02",
        paisCodigo: "CL",
        monedaCodigo: "CLP",
        validezCotizacionDias: 15,
      },
    });
    assert.equal(regionChange.data.profile.regionCodigo, "02");
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
        regionCodigo: "02",
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
        regionCodigo: "02",
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
        regionCodigo: "02",
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
      outsider.auth.currentUser ? signOut(outsider.auth) : Promise.resolve(),
    ]);
    await Promise.all([
      deleteApp(owner.app),
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
