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
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  setDoc,
  updateDoc,
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

function createClient(name) {
  const app = initializeApp(
    {
      apiKey: "demo-key",
      appId: `demo-${name}-${RUN_ID}`,
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
    },
    `${name}-${RUN_ID}`
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

const baseBusiness = Object.freeze({
  rubroCodigo: "INGENIERIA_CONSULTORIA",
  regionCodigo: "13",
});

async function createAccount(client, label) {
  return createUserWithEmailAndPassword(
    client.auth,
    `${label}-${RUN_ID}@example.test`,
    "test-password-123"
  );
}

function callable(client, name, data = {}) {
  return httpsCallable(client.functions, name)(data);
}

async function expectCallableCode(code, operation) {
  await assert.rejects(operation, (error) =>
    String(error?.code || "").includes(code)
  );
}

async function expectDenied(operation) {
  await assert.rejects(operation, (error) =>
    String(error?.code || "").includes("permission-denied")
  );
}

async function main() {
  const owner = createClient("multi-owner");
  const outsider = createClient("multi-outsider");
  const concurrent = createClient("multi-concurrent");
  const invitee = createClient("multi-invitee");
  const adminApp = initializeAdminApp(
    { projectId: PROJECT_ID },
    `multi-admin-${RUN_ID}`
  );
  const adminDb = getAdminFirestore(adminApp);

  try {
    const [ownerCredential, outsiderCredential, concurrentCredential, inviteeCredential] =
      await Promise.all([
        createAccount(owner, "multi-owner"),
        createAccount(outsider, "multi-outsider"),
        createAccount(concurrent, "multi-concurrent"),
        createAccount(invitee, "multi-invitee"),
      ]);
    const ownerUid = ownerCredential.user.uid;
    const outsiderUid = outsiderCredential.user.uid;
    const concurrentUid = concurrentCredential.user.uid;
    const inviteeUid = inviteeCredential.user.uid;

    const first = await callable(owner, "createFirstBusiness", {
      ...baseBusiness,
      nombreComercial: "Negocio Principal",
      requestId: "multi_owner_first_001",
    });
    const firstBusinessId = first.data.business.id;

    await expectCallableCode("invalid-argument", () =>
      callable(owner, "createAdditionalBusiness", {
        nombreComercial: "Empresa exterior nueva",
        rubroCodigo: "INGENIERIA_CONSULTORIA",
        paisCodigo: "OTHER",
        regionEstado: "Exterior",
        requestId: "multi_owner_other_rejected_001",
      })
    );

    const additionalPayload = {
      nombreComercial: "Mauricio SPA",
      rubroCodigo: "SOFTWARE_SOLUCIONES_DIGITALES",
      paisCodigo: "BO",
      monedaCodigo: "USD",
      regionEstado: "La Paz",
      requestId: "multi_owner_additional_001",
    };
    const second = await callable(
      owner,
      "createAdditionalBusiness",
      additionalPayload
    );
    const secondBusinessId = second.data.business.id;
    assert.notEqual(secondBusinessId, firstBusinessId);
    assert.equal(second.data.business.role, "OWNER");
    assert.equal(second.data.business.paisCodigo, "BO");
    assert.equal(second.data.business.monedaCodigo, "BOB");
    assert.equal(second.data.business.comunaCodigo, undefined);

    const retry = await callable(
      owner,
      "createAdditionalBusiness",
      additionalPayload
    );
    assert.equal(retry.data.business.id, secondBusinessId);
    assert.equal(retry.data.idempotent, true);

    const [firstBusiness, secondBusiness, secondMembership, secondProfile, ownerUser] = await Promise.all([
      adminDb.collection("negocios").doc(firstBusinessId).get(),
      adminDb.collection("negocios").doc(secondBusinessId).get(),
      adminDb
        .collection("membresias")
        .doc(`${secondBusinessId}__${ownerUid}`)
        .get(),
      adminDb.doc(`negocios/${secondBusinessId}/empresa/perfil`).get(),
      adminDb.collection("usuarios").doc(ownerUid).get(),
    ]);
    assert.equal(secondBusiness.exists, true);
    assert.equal(secondMembership.data()?.rol, "OWNER");
    assert.equal(secondProfile.data()?.nombreComercial, "Mauricio SPA");
    assert.equal(secondProfile.data()?.rubroCodigo, "SOFTWARE_SOLUCIONES_DIGITALES");
    assert.equal(secondProfile.data()?.paisCodigo, "BO");
    assert.equal(secondProfile.data()?.monedaCodigo, "BOB");
    assert.equal(secondProfile.data()?.regionEstado, "La Paz");
    assert.equal(secondProfile.data()?.rut, undefined);
    assert.equal(secondProfile.data()?.comunaCodigo, undefined);
    assert.equal(ownerUser.data()?.negocioActivoId, secondBusinessId);
    assert.equal(firstBusiness.data()?.rubroCodigo, baseBusiness.rubroCodigo);
    assert.equal(secondBusiness.data()?.rubroCodigo, "SOFTWARE_SOLUCIONES_DIGITALES");
    assert.equal(secondBusiness.data()?.comunaCodigo, undefined);

    const outsiderBusiness = await callable(outsider, "createFirstBusiness", {
      ...baseBusiness,
      nombreComercial: "Negocio Ajeno",
      requestId: "multi_outsider_first_001",
    });
    const outsiderBusinessId = outsiderBusiness.data.business.id;

    const ownerSession = await callable(owner, "getBusinessSession");
    assert.equal(ownerSession.data.businesses.length, 2);
    assert.deepEqual(
      new Set(ownerSession.data.businesses.map((business) => business.id)),
      new Set([firstBusinessId, secondBusinessId])
    );
    assert.equal(
      ownerSession.data.businesses.some((business) => business.id === outsiderBusinessId),
      false
    );
    assert.equal(ownerSession.data.plan.ownerBusinessLimit, null);
    assert.equal(ownerSession.data.plan.ownedBusinessCount, 2);
    assert.equal(ownerSession.data.plan.canCreateBusiness, true);
    assert.equal(ownerSession.data.plan.limitEnforced, false);

    await expectCallableCode("permission-denied", () =>
      callable(owner, "setActiveBusiness", { businessId: outsiderBusinessId })
    );
    await expectDenied(() =>
      setDoc(doc(owner.db, "usuarios", ownerUid), {
        negocioActivoId: outsiderBusinessId,
      })
    );

    await callable(owner, "setActiveBusiness", { businessId: firstBusinessId });
    const persistedSession = await callable(owner, "getBusinessSession");
    assert.equal(persistedSession.data.activeBusiness.id, firstBusinessId);
    assert.equal(
      (await adminDb.collection("usuarios").doc(ownerUid).get()).data()
        .negocioActivoId,
      firstBusinessId
    );

    const third = await callable(owner, "createAdditionalBusiness", {
      ...baseBusiness,
      nombreComercial: "ZZ Tercer negocio permitido",
      requestId: "multi_owner_third_001",
    });
    const fourth = await callable(owner, "createAdditionalBusiness", {
      ...baseBusiness,
      nombreComercial: "ZZZ Cuarto negocio permitido",
      requestId: "multi_owner_fourth_001",
    });
    const expandedSession = await callable(owner, "getBusinessSession");
    assert.equal(third.data.plan.ownedBusinessCount, 3);
    assert.equal(fourth.data.plan.ownedBusinessCount, 4);
    assert.equal(expandedSession.data.businesses.length, 4);
    assert.equal(expandedSession.data.plan.canCreateBusiness, true);
    assert.equal(
      expandedSession.data.businesses.some(
        (business) => business.id === outsiderBusinessId
      ),
      false
    );
    assert.equal(
      (
        await adminDb
          .collection("negocios")
          .where("creadoPorUid", "==", ownerUid)
          .get()
      ).size,
      4
    );

    await Promise.all([
      adminDb.doc(`negocios/${firstBusinessId}/inventario/item-a`).set({
        negocioId: firstBusinessId,
        nombre: "Inventario A",
      }),
      adminDb.doc(`negocios/${secondBusinessId}/inventario/item-b`).set({
        negocioId: secondBusinessId,
        nombre: "Inventario B",
      }),
    ]);
    assert.equal(
      (await getDoc(doc(owner.db, "negocios", firstBusinessId, "inventario", "item-a"))).data()?.nombre,
      "Inventario A"
    );
    assert.equal(
      (await getDoc(doc(owner.db, "negocios", secondBusinessId, "inventario", "item-b"))).data()?.nombre,
      "Inventario B"
    );
    await expectDenied(() =>
      getDoc(doc(outsider.db, "negocios", firstBusinessId, "inventario", "item-a"))
    );
    await setDoc(
      doc(owner.db, "negocios", firstBusinessId, "referencias", "reference-a"),
      {
        negocioId: firstBusinessId,
        itemId: "item-a",
        itemNombre: "Inventario A",
        nombreFuente: "Fuente autorizada",
        precioObservado: 1000,
        fechaConsulta: "2026-08-02",
        estado: "activa",
      }
    );
    await expectDenied(() =>
      setDoc(
        doc(
          outsider.db,
          "negocios",
          firstBusinessId,
          "referencias",
          "forged-reference"
        ),
        {
          negocioId: firstBusinessId,
          itemId: "item-a",
          nombreFuente: "No autorizado",
          precioObservado: 1,
          fechaConsulta: "2026-08-02",
          estado: "activa",
        }
      )
    );

    const invitedAdminBusinessRef = adminDb.collection("negocios").doc();
    const invitedMemberBusinessRef = adminDb.collection("negocios").doc();
    await Promise.all([
      invitedAdminBusinessRef.set({
        ...baseBusiness,
        nombreComercial: "Administrado por invitación",
        estado: "activo",
        creadoPorUid: outsiderUid,
      }),
      invitedMemberBusinessRef.set({
        ...baseBusiness,
        nombreComercial: "Membresía invitada",
        estado: "activo",
        creadoPorUid: outsiderUid,
      }),
      adminDb.collection("membresias").doc(`${invitedAdminBusinessRef.id}__${inviteeUid}`).set({
        negocioId: invitedAdminBusinessRef.id,
        uid: inviteeUid,
        rol: "ADMIN",
        estado: "activo",
      }),
      adminDb.collection("membresias").doc(`${invitedMemberBusinessRef.id}__${inviteeUid}`).set({
        negocioId: invitedMemberBusinessRef.id,
        uid: inviteeUid,
        rol: "MEMBER",
        estado: "activo",
      }),
    ]);
    const inviteeSession = await callable(invitee, "getBusinessSession");
    assert.equal(inviteeSession.data.plan.ownedBusinessCount, 0);
    assert.equal(inviteeSession.data.businesses.length, 2);
    const inviteeOwned = await callable(invitee, "createAdditionalBusiness", {
      ...baseBusiness,
      nombreComercial: "Primer negocio propio del invitado",
      requestId: "multi_invitee_owned_001",
    });
    assert.equal(inviteeOwned.data.plan.ownedBusinessCount, 1);

    const concurrentFirst = await callable(concurrent, "createFirstBusiness", {
      ...baseBusiness,
      nombreComercial: "Concurrente Principal",
      requestId: "multi_concurrent_first_001",
    });
    assert.ok(concurrentFirst.data.business.id);
    const simultaneous = await Promise.allSettled([
      callable(concurrent, "createAdditionalBusiness", {
        ...baseBusiness,
        nombreComercial: "Concurrente A",
        requestId: "multi_concurrent_add_001",
      }),
      callable(concurrent, "createAdditionalBusiness", {
        ...baseBusiness,
        nombreComercial: "Concurrente B",
        requestId: "multi_concurrent_add_002",
      }),
    ]);
    assert.equal(simultaneous.filter((result) => result.status === "fulfilled").length, 2);
    assert.equal(simultaneous.filter((result) => result.status === "rejected").length, 0);
    assert.equal(
      (
        await adminDb
          .collection("negocios")
          .where("creadoPorUid", "==", concurrentUid)
          .get()
      ).size,
      3
    );

    await adminDb
      .collection("membresias")
      .doc(`${firstBusinessId}__${inviteeUid}`)
      .set({
        negocioId: firstBusinessId,
        uid: inviteeUid,
        rol: "ADMIN",
        estado: "activo",
      });
    await expectCallableCode("permission-denied", () =>
      callable(invitee, "deleteBusiness", {
        businessId: firstBusinessId,
        requestId: "multi_admin_delete_001",
      })
    );
    await adminDb
      .collection("membresias")
      .doc(`${firstBusinessId}__${inviteeUid}`)
      .update({ rol: "MEMBER" });
    await expectCallableCode("permission-denied", () =>
      callable(invitee, "deleteBusiness", {
        businessId: firstBusinessId,
        requestId: "multi_member_delete_001",
      })
    );
    await expectDenied(() =>
      updateDoc(doc(owner.db, "negocios", firstBusinessId), {
        estado: "eliminada",
      })
    );
    await expectDenied(() =>
      deleteDoc(doc(owner.db, "negocios", firstBusinessId))
    );

    await callable(owner, "setActiveBusiness", { businessId: firstBusinessId });
    const deletionPayload = {
      businessId: firstBusinessId,
      requestId: "multi_owner_delete_001",
    };
    const deletion = await callable(owner, "deleteBusiness", deletionPayload);
    assert.equal(deletion.data.businessId, firstBusinessId);
    assert.equal(deletion.data.estado, "eliminada");
    assert.equal(deletion.data.nextBusinessId, secondBusinessId);
    assert.equal(deletion.data.needsOnboarding, false);
    assert.equal(deletion.data.idempotent, false);

    const deletionRetry = await callable(owner, "deleteBusiness", deletionPayload);
    assert.equal(deletionRetry.data.idempotent, true);
    assert.equal(deletionRetry.data.nextBusinessId, secondBusinessId);
    const [deletedBusiness, preservedMembership, preservedInventory, deleteRequests] =
      await Promise.all([
        adminDb.collection("negocios").doc(firstBusinessId).get(),
        adminDb.collection("membresias").doc(`${firstBusinessId}__${ownerUid}`).get(),
        adminDb.doc(`negocios/${firstBusinessId}/inventario/item-a`).get(),
        adminDb
          .collection("usuarios")
          .doc(ownerUid)
          .collection("businessDeleteRequests")
          .get(),
      ]);
    assert.equal(deletedBusiness.data()?.estado, "eliminada");
    assert.ok(deletedBusiness.data()?.eliminadoEn);
    assert.equal(deletedBusiness.data()?.eliminadoPorUid, ownerUid);
    assert.equal(preservedMembership.exists, true);
    assert.equal(preservedInventory.data()?.nombre, "Inventario A");
    assert.equal(deleteRequests.size, 1);
    await expectDenied(() =>
      getDoc(doc(owner.db, "negocios", firstBusinessId, "inventario", "item-a"))
    );
    await expectDenied(() =>
      getDoc(doc(invitee.db, "negocios", firstBusinessId, "inventario", "item-a"))
    );
    await expectCallableCode("failed-precondition", () =>
      callable(owner, "setActiveBusiness", { businessId: firstBusinessId })
    );
    await expectDenied(() =>
      getDoc(
        doc(
          owner.db,
          "usuarios",
          ownerUid,
          "businessDeleteRequests",
          deletionPayload.requestId
        )
      )
    );

    const fallbackSession = await callable(owner, "getBusinessSession");
    assert.equal(fallbackSession.data.activeBusiness.id, secondBusinessId);
    assert.equal(fallbackSession.data.businesses.length, 3);
    assert.equal(fallbackSession.data.plan.ownedBusinessCount, 3);
    assert.equal(fallbackSession.data.plan.canCreateBusiness, true);
    assert.equal(
      fallbackSession.data.businesses.some(
        (business) => business.id === firstBusinessId
      ),
      false
    );

    const replacement = await callable(owner, "createAdditionalBusiness", {
      ...baseBusiness,
      nombreComercial: "Negocio de reemplazo",
      requestId: "multi_owner_replacement_001",
    });
    assert.equal(replacement.data.plan.ownedBusinessCount, 4);
    await callable(owner, "setActiveBusiness", { businessId: secondBusinessId });
    assert.equal(
      (await callable(owner, "getBusinessSession")).data.activeBusiness.id,
      secondBusinessId
    );

    const outsiderDeletion = await callable(outsider, "deleteBusiness", {
      businessId: outsiderBusinessId,
      requestId: "multi_outsider_delete_001",
    });
    assert.equal(outsiderDeletion.data.needsOnboarding, true);
    assert.equal(outsiderDeletion.data.nextBusinessId, null);
    const outsiderAfterDeletion = await callable(outsider, "getBusinessSession");
    assert.equal(outsiderAfterDeletion.data.accessState, "onboarding");
    assert.equal(outsiderAfterDeletion.data.needsOnboarding, true);
    assert.equal(outsiderAfterDeletion.data.plan.ownedBusinessCount, 0);
    assert.equal(
      (await adminDb.collection("usuarios").doc(outsiderUid).get()).data()
        ?.negocioActivoId,
      undefined
    );

    console.log(
      "BUSINESS_MULTI_INTEGRATED_OK",
      JSON.stringify({
        firstBusinessId,
        secondBusinessId,
        unauthorizedSwitchBlocked: true,
        activeBusinessPersisted: true,
        idempotencyVerified: true,
        isolationVerified: true,
        concurrentUnlimitedCreationVerified: true,
        logicalDeletionVerified: true,
        deletionFallbackVerified: true,
        deletedBusinessLimitExcluded: true,
      })
    );
  } finally {
    await Promise.all(
      [owner, outsider, concurrent, invitee].map((client) =>
        client.auth.currentUser ? signOut(client.auth) : Promise.resolve()
      )
    );
    await Promise.all([
      deleteApp(owner.app),
      deleteApp(outsider.app),
      deleteApp(concurrent.app),
      deleteApp(invitee.app),
      deleteAdminApp(adminApp),
    ]);
  }
}

main().catch((error) => {
  console.error(
    "BUSINESS_MULTI_INTEGRATED_FAILED",
    error?.code || "",
    error?.message || error
  );
  process.exitCode = 1;
});
