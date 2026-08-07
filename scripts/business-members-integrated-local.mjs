import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getFirestore,
  terminate,
  updateDoc,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const PROJECT_ID = "tesis-inventario-ia";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
process.env.GCLOUD_PROJECT ||= PROJECT_ID;
const requireFromFunctions = createRequire(
  new URL("../functions/package.json", import.meta.url)
);
const {
  deleteApp: deleteAdminApp,
  initializeApp: initializeAdminApp,
} = requireFromFunctions("firebase-admin/app");
const {getAuth: getAdminAuth} = requireFromFunctions("firebase-admin/auth");
const {
  FieldValue,
  getFirestore: getAdminFirestore,
} = requireFromFunctions("firebase-admin/firestore");

function createClient(name) {
  const app = initializeApp(
    {
      apiKey: "demo-key",
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
      appId: `members-${name}-${RUN_ID}`,
    },
    `members-${name}-${RUN_ID}`
  );
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, "us-central1");
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return {app, auth, db, functions};
}

async function authenticate(client, label) {
  const email = `members-${label}-${RUN_ID}@example.test`;
  const credential = await createUserWithEmailAndPassword(
    client.auth,
    email,
    `Members-${RUN_ID}-Pass!`
  );
  client.uid = credential.user.uid;
  client.email = email;
  return client;
}

const call = (client, name) => httpsCallable(client.functions, name);

async function expectCallableError(label, operation, expectedCodes) {
  try {
    await operation();
  } catch (error) {
    assert.ok(
      expectedCodes.some((code) => String(error?.code || "").includes(code)),
      `${label}: código inesperado ${error?.code} ${error?.message}`
    );
    console.log(`OK rechazo: ${label}`);
    return;
  }
  throw new Error(`Se esperaba rechazo: ${label}`);
}

async function expectDenied(label, operation) {
  try {
    await operation();
  } catch (error) {
    assert.match(String(error?.code || ""), /permission-denied/);
    console.log(`OK reglas: ${label}`);
    return;
  }
  throw new Error(`Se esperaba denegación: ${label}`);
}

const requestId = (prefix) =>
  `${prefix}-${RUN_ID}-${Math.random().toString(36).slice(2, 10)}`;

const owner = await authenticate(createClient("owner"), "owner");
const admin = await authenticate(createClient("admin"), "admin");
const member = await authenticate(createClient("member"), "member");
const target = await authenticate(createClient("target"), "target");
const outsider = await authenticate(createClient("outsider"), "outsider");
const clients = [owner, admin, member, target, outsider];
const adminApp = initializeAdminApp(
  {projectId: PROJECT_ID},
  `members-admin-${RUN_ID}`
);
const adminDb = getAdminFirestore(adminApp);
const adminAuth = getAdminAuth(adminApp);

try {
  const mainBusiness = await call(owner, "createFirstBusiness")({
    nombreComercial: "Negocio miembros",
    rubroCodigo: "SERVICIOS_PROFESIONALES",
    regionCodigo: "13",
    requestId: requestId("business-main"),
  });
  const otherBusiness = await call(outsider, "createFirstBusiness")({
    nombreComercial: "Negocio externo",
    rubroCodigo: "SERVICIOS_PROFESIONALES",
    regionCodigo: "13",
    requestId: requestId("business-other"),
  });
  const businessId = mainBusiness.data.business.id;
  const otherBusinessId = otherBusiness.data.business.id;
  const now = FieldValue.serverTimestamp();
  await Promise.all([
    adminDb.doc(`membresias/${businessId}__${admin.uid}`).set({
      negocioId: businessId,
      uid: admin.uid,
      rol: "ADMIN",
      estado: "activo",
      creadoEn: now,
      actualizadoEn: now,
    }),
    adminDb.doc(`membresias/${businessId}__${member.uid}`).set({
      negocioId: businessId,
      uid: member.uid,
      rol: "MEMBER",
      estado: "activo",
      creadoEn: now,
      actualizadoEn: now,
    }),
    adminDb.doc(`usuarios/${owner.uid}/cuenta/perfil`).set({
      uid: owner.uid,
      nombres: "Olivia",
      apellidos: "Owner",
    }),
    adminDb.doc(`usuarios/${admin.uid}/cuenta/perfil`).set({
      uid: admin.uid,
      nombres: "Adriana",
      apellidos: "Admin",
    }),
    adminDb.doc(`usuarios/${member.uid}/cuenta/perfil`).set({
      uid: member.uid,
      nombres: "Mario",
      apellidos: "Member",
    }),
    adminDb.doc(`usuarios/${target.uid}/cuenta/perfil`).set({
      uid: target.uid,
      nombres: "Teresa",
      apellidos: "Target",
      telefonoPersonal: "+56 9 1111 2222",
      numeroDocumento: "11.111.111-1",
    }),
  ]);

  const ownerList = await call(owner, "listarMiembrosNegocio")({businessId});
  assert.equal(ownerList.data.miembros.length, 3);
  assert.deepEqual(
    Object.keys(ownerList.data.miembros[0]).sort(),
    ["correo", "estado", "fechaIncorporacion", "nombre", "rol", "uid"]
  );
  assert.ok(ownerList.data.miembros.some((item) => item.nombre === "Olivia Owner"));
  console.log("OK directorio: OWNER lista DTO mínimo de miembros activos");

  const [adminList, memberList] = await Promise.all([
    call(admin, "listarMiembrosNegocio")({businessId}),
    call(member, "listarMiembrosNegocio")({businessId}),
  ]);
  assert.equal(adminList.data.miembros.length, 3);
  assert.equal(memberList.data.miembros.length, 3);
  console.log("OK directorio: ADMIN y MEMBER consultan miembros activos");

  const added = await call(owner, "asociarUsuarioExistente")({
    businessId,
    correo: target.email,
  });
  assert.equal(added.data.miembro.uid, target.uid);
  assert.equal(added.data.miembro.rol, "MEMBER");
  assert.equal(added.data.miembro.estado, "activo");
  const targetMembershipRef = adminDb.doc(
    `membresias/${businessId}__${target.uid}`
  );
  const storedTarget = (await targetMembershipRef.get()).data();
  assert.equal(storedTarget.negocioId, businessId);
  assert.equal(storedTarget.rol, "MEMBER");
  assert.equal(storedTarget.estado, "activo");
  const targetDirectoryEntry = (
    await call(owner, "listarMiembrosNegocio")({businessId})
  ).data.miembros.find((item) => item.uid === target.uid);
  assert.equal(targetDirectoryEntry.nombre, "Teresa Target");
  assert.equal(targetDirectoryEntry.correo, target.email);
  assert.equal(targetDirectoryEntry.telefonoPersonal, undefined);
  assert.equal(targetDirectoryEntry.numeroDocumento, undefined);
  console.log("OK asociación: OWNER agrega cuenta existente como MEMBER activo");

  await expectCallableError(
    "ADMIN no asocia usuarios",
    () => call(admin, "asociarUsuarioExistente")({businessId, correo: outsider.email}),
    ["permission-denied"]
  );
  await expectCallableError(
    "MEMBER no asocia usuarios",
    () => call(member, "asociarUsuarioExistente")({businessId, correo: outsider.email}),
    ["permission-denied"]
  );
  await expectCallableError(
    "ADMIN no modifica membresías",
    () => call(admin, "actualizarMembresiaNegocio")({
      businessId,
      miembroUid: target.uid,
      rol: "ADMIN",
      estado: "activo",
    }),
    ["permission-denied"]
  );
  await expectCallableError(
    "MEMBER no modifica membresías",
    () => call(member, "actualizarMembresiaNegocio")({
      businessId,
      miembroUid: target.uid,
      rol: "ADMIN",
      estado: "activo",
    }),
    ["permission-denied"]
  );
  await expectCallableError(
    "cuenta inexistente",
    () => call(owner, "asociarUsuarioExistente")({
      businessId,
      correo: `missing-${RUN_ID}@example.test`,
    }),
    ["not-found"]
  );

  const disabledEmail = `disabled-${RUN_ID}@example.test`;
  const disabledUser = await adminAuth.createUser({
    email: disabledEmail,
    password: `Disabled-${RUN_ID}-Pass!`,
    disabled: true,
  });
  await expectCallableError(
    "cuenta Auth deshabilitada",
    () => call(owner, "asociarUsuarioExistente")({businessId, correo: disabledEmail}),
    ["failed-precondition"]
  );
  assert.equal(
    (await adminDb.doc(`membresias/${businessId}__${disabledUser.uid}`).get()).exists,
    false
  );
  await expectCallableError(
    "asociación activa duplicada",
    () => call(owner, "asociarUsuarioExistente")({businessId, correo: target.email}),
    ["already-exists"]
  );

  await call(owner, "actualizarMembresiaNegocio")({
    businessId,
    miembroUid: target.uid,
    rol: "ADMIN",
    estado: "activo",
  });
  assert.equal((await targetMembershipRef.get()).data().rol, "ADMIN");
  await call(owner, "actualizarMembresiaNegocio")({
    businessId,
    miembroUid: target.uid,
    rol: "MEMBER",
    estado: "activo",
  });
  assert.equal((await targetMembershipRef.get()).data().rol, "MEMBER");
  console.log("OK roles: OWNER cambia MEMBER -> ADMIN -> MEMBER");

  await call(owner, "actualizarMembresiaNegocio")({
    businessId,
    miembroUid: target.uid,
    rol: "MEMBER",
    estado: "inactivo",
  });
  assert.equal((await targetMembershipRef.get()).data().estado, "inactivo");
  const [ownerWithInactive, adminWithoutInactive, memberWithoutInactive] =
    await Promise.all([
      call(owner, "listarMiembrosNegocio")({businessId}),
      call(admin, "listarMiembrosNegocio")({businessId}),
      call(member, "listarMiembrosNegocio")({businessId}),
    ]);
  assert.ok(ownerWithInactive.data.miembros.some((item) =>
    item.uid === target.uid && item.estado === "inactivo"
  ));
  assert.equal(adminWithoutInactive.data.miembros.some((item) => item.uid === target.uid), false);
  assert.equal(memberWithoutInactive.data.miembros.some((item) => item.uid === target.uid), false);
  await expectCallableError(
    "membresía inactiva no se duplica",
    () => call(owner, "asociarUsuarioExistente")({businessId, correo: target.email}),
    ["already-exists"]
  );
  await call(owner, "actualizarMembresiaNegocio")({
    businessId,
    miembroUid: target.uid,
    rol: "MEMBER",
    estado: "activo",
  });
  assert.equal((await targetMembershipRef.get()).data().estado, "activo");
  console.log("OK estados: OWNER desactiva y reactiva sin eliminar la membresía");

  await expectCallableError(
    "membresía OWNER inmutable",
    () => call(owner, "actualizarMembresiaNegocio")({
      businessId,
      miembroUid: owner.uid,
      rol: "MEMBER",
      estado: "inactivo",
    }),
    ["failed-precondition"]
  );
  await expectCallableError(
    "businessId de otra empresa",
    () => call(owner, "actualizarMembresiaNegocio")({
      businessId: otherBusinessId,
      miembroUid: outsider.uid,
      rol: "MEMBER",
      estado: "inactivo",
    }),
    ["permission-denied"]
  );
  assert.equal(
    (await adminDb.doc(`membresias/${otherBusinessId}__${target.uid}`).get()).exists,
    false
  );
  const outsiderList = await call(outsider, "listarMiembrosNegocio")({
    businessId: otherBusinessId,
  });
  assert.deepEqual(outsiderList.data.miembros.map((item) => item.uid), [outsider.uid]);
  console.log("OK aislamiento: membresías y operaciones permanecen dentro del negocio");

  await expectDenied(
    "escritura directa cliente de membresías bloqueada",
    () => updateDoc(doc(owner.db, `membresias/${businessId}__${target.uid}`), {
      rol: "ADMIN",
    })
  );

  console.log("BUSINESS_MEMBERS_INTEGRATED_OK");
} finally {
  await Promise.all(clients.map(async (client) => {
    await terminate(client.db).catch(() => {});
    await deleteApp(client.app).catch(() => {});
  }));
  await deleteAdminApp(adminApp).catch(() => {});
}
