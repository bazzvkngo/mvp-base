import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {deleteApp, initializeApp} from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDocs,
  getFirestore,
  query,
  terminate,
  updateDoc,
  where,
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
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    regionCodigo: "13",
    requestId: requestId("business-main"),
  });
  const otherBusiness = await call(outsider, "createFirstBusiness")({
    nombreComercial: "Negocio externo",
    rubroCodigo: "INGENIERIA_CONSULTORIA",
    regionCodigo: "13",
    requestId: requestId("business-other"),
  });
  const businessId = mainBusiness.data.business.id;
  const otherBusinessId = otherBusiness.data.business.id;
  const now = FieldValue.serverTimestamp();
  await Promise.all([
    adminDb.doc(`negocios/${businessId}`).update({
      verificacionEmpresa: {estado: "VERIFICADA"},
    }),
    adminDb.doc(`negocios/${otherBusinessId}`).update({
      verificacionEmpresa: {estado: "VERIFICADA"},
    }),
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
    ["correo", "estado", "fechaIncorporacion", "nombre", "perfilNombre", "profileId", "rol", "uid"]
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

  await call(owner, "actualizarMembresiaNegocio")({
    businessId,
    miembroUid: member.uid,
    rol: "MEMBER",
    estado: "inactivo",
  });
  await call(owner, "actualizarMembresiaNegocio")({
    businessId,
    miembroUid: member.uid,
    rol: "MEMBER",
    estado: "activo",
  });
  console.log("OK compatibilidad: Colaborador existente conserva gestión de estado");

  const added = await call(owner, "asociarUsuarioExistente")({
    businessId,
    correo: target.email,
    rol: "TECNICO",
  });
  assert.equal(added.data.miembro.uid, target.uid);
  assert.equal(added.data.miembro.rol, "TECNICO");
  assert.equal(added.data.miembro.estado, "activo");
  const targetMembershipRef = adminDb.doc(
    `membresias/${businessId}__${target.uid}`
  );
  const storedTarget = (await targetMembershipRef.get()).data();
  assert.equal(storedTarget.negocioId, businessId);
  assert.equal(storedTarget.rol, "TECNICO");
  assert.equal(storedTarget.estado, "activo");
  const targetDirectoryEntry = (
    await call(owner, "listarMiembrosNegocio")({businessId})
  ).data.miembros.find((item) => item.uid === target.uid);
  assert.equal(targetDirectoryEntry.nombre, "Teresa Target");
  assert.equal(targetDirectoryEntry.correo, target.email);
  assert.equal(targetDirectoryEntry.telefonoPersonal, undefined);
  assert.equal(targetDirectoryEntry.numeroDocumento, undefined);
  console.log("OK asociación: OWNER agrega cuenta existente como TECNICO activo");

  await expectCallableError(
    "MEMBER no asocia usuarios",
    () => call(member, "asociarUsuarioExistente")({businessId, correo: outsider.email}),
    ["permission-denied"]
  );
  await call(admin, "actualizarMembresiaNegocio")({
    businessId,
    miembroUid: target.uid,
    rol: "COMPRAS",
    estado: "activo",
  });
  assert.equal((await targetMembershipRef.get()).data().rol, "COMPRAS");
  await expectCallableError(
    "ADMIN no modifica su propio perfil",
    () => call(admin, "actualizarMembresiaNegocio")({
      businessId,
      miembroUid: admin.uid,
      rol: "VENTAS",
      estado: "activo",
    }),
    ["failed-precondition"]
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
    rol: "VENTAS",
    estado: "activo",
  });
  assert.equal((await targetMembershipRef.get()).data().rol, "VENTAS");
  console.log("OK roles: OWNER cambia TECNICO -> ADMIN -> VENTAS");

  await call(owner, "actualizarMembresiaNegocio")({
    businessId,
    miembroUid: target.uid,
    rol: "VENTAS",
    estado: "inactivo",
  });
  assert.equal((await targetMembershipRef.get()).data().estado, "inactivo");
  const [ownerWithInactive, adminWithInactive, memberWithoutInactive] =
    await Promise.all([
      call(owner, "listarMiembrosNegocio")({businessId}),
      call(admin, "listarMiembrosNegocio")({businessId}),
      call(member, "listarMiembrosNegocio")({businessId}),
    ]);
  assert.ok(ownerWithInactive.data.miembros.some((item) =>
    item.uid === target.uid && item.estado === "inactivo"
  ));
  assert.equal(adminWithInactive.data.miembros.some((item) => item.uid === target.uid), true);
  assert.equal(memberWithoutInactive.data.miembros.some((item) => item.uid === target.uid), false);
  await expectCallableError(
    "membresía inactiva no se duplica",
    () => call(owner, "asociarUsuarioExistente")({businessId, correo: target.email}),
    ["already-exists"]
  );
  await call(owner, "actualizarMembresiaNegocio")({
    businessId,
    miembroUid: target.uid,
    rol: "VENTAS",
    estado: "activo",
  });
  assert.equal((await targetMembershipRef.get()).data().estado, "activo");
  console.log("OK estados: OWNER desactiva y reactiva sin eliminar la membresía");

  await expectCallableError(
    "membresía OWNER inmutable",
    () => call(owner, "actualizarMembresiaNegocio")({
      businessId,
      miembroUid: owner.uid,
      rol: "TECNICO",
      estado: "inactivo",
    }),
    ["failed-precondition"]
  );

  const createdProfile = await call(owner, "crearPerfilEmpleado")({
    businessId,
    nombre: "Supervisor comercial",
    descripcion: "Consulta de clientes",
    modulos: ["clientes"],
  });
  const profileId = createdProfile.data.perfil.id;
  await call(owner, "actualizarPerfilEmpleado")({
    businessId,
    profileId,
    nombre: "Supervisor comercial",
    descripcion: "Clientes de la empresa",
    modulos: ["clientes"],
  });
  await call(owner, "actualizarMembresiaNegocio")({
    businessId,
    miembroUid: target.uid,
    rol: "MEMBER",
    profileId,
    estado: "activo",
  });
  const storedCustomMembership = (await targetMembershipRef.get()).data();
  assert.equal(storedCustomMembership.rol, "MEMBER");
  assert.equal(storedCustomMembership.profileId, profileId);
  const customDirectory = await call(owner, "listarMiembrosNegocio")({businessId});
  assert.equal(
    customDirectory.data.miembros.find((item) => item.uid === target.uid).perfilNombre,
    "Supervisor comercial"
  );
  const targetSession = await call(target, "getBusinessSession")({});
  const targetMainBusiness = targetSession.data.businesses.find((item) => item.id === businessId);
  assert.equal(targetMainBusiness.profileId, profileId);
  assert.deepEqual(targetMainBusiness.modules, ["clientes"]);
  console.log("OK perfil: asignación estable y sesión resuelven módulos por profileId");

  await Promise.all([
    adminDb.doc(`negocios/${businessId}/clientes/client-profile-test`).set({
      negocioId: businessId,
      nombre: "Cliente autorizado",
      estado: "activo",
    }),
    adminDb.doc(`negocios/${businessId}/ventas/sale-profile-test`).set({
      negocioId: businessId,
      numero: "VEN-PROFILE",
      estado: "CONFIRMADA",
    }),
  ]);
  assert.equal((await getDocs(query(
    collection(target.db, `negocios/${businessId}/clientes`),
    where("negocioId", "==", businessId)
  ))).size, 1);
  await expectDenied(
    "perfil Clientes no lee Ventas",
    () => getDocs(query(
      collection(target.db, `negocios/${businessId}/ventas`),
      where("negocioId", "==", businessId)
    ))
  );
  await expectCallableError(
    "perfil personalizado no administra perfiles",
    () => call(target, "crearPerfilEmpleado")({
      businessId,
      nombre: "Escalación",
      modulos: ["empresa", "empleados"],
    }),
    ["permission-denied"]
  );
  await expectCallableError(
    "perfil sin Empleados no consulta directorio",
    () => call(target, "listarMiembrosNegocio")({businessId}),
    ["permission-denied"]
  );
  await expectCallableError(
    "perfil en uso no se elimina",
    () => call(owner, "eliminarPerfilEmpleado")({businessId, profileId}),
    ["failed-precondition"]
  );
  const unusedProfile = await call(owner, "crearPerfilEmpleado")({
    businessId,
    nombre: "Perfil temporal",
    modulos: ["inventario"],
  });
  await call(owner, "eliminarPerfilEmpleado")({
    businessId,
    profileId: unusedProfile.data.perfil.id,
  });
  assert.equal(
    (await adminDb.doc(`negocios/${businessId}/perfilesEmpleados/${unusedProfile.data.perfil.id}`).get()).data().estado,
    "inactivo"
  );
  await expectDenied(
    "perfiles internos no se leen con SDK cliente",
    () => getDocs(collection(target.db, `negocios/${businessId}/perfilesEmpleados`))
  );
  console.log("OK seguridad: módulo denegado, autoescalación y eliminación en uso bloqueados");

  await expectCallableError(
    "profileId de otra empresa",
    () => call(outsider, "asociarUsuarioExistente")({
      businessId: otherBusinessId,
      correo: target.email,
      rol: "MEMBER",
      profileId,
    }),
    ["invalid-argument"]
  );
  const otherProfile = await call(outsider, "crearPerfilEmpleado")({
    businessId: otherBusinessId,
    nombre: "Consulta de ventas",
    modulos: ["ventas"],
  });
  await call(outsider, "asociarUsuarioExistente")({
    businessId: otherBusinessId,
    correo: target.email,
    rol: "MEMBER",
    profileId: otherProfile.data.perfil.id,
  });
  const multiBusinessSession = await call(target, "getBusinessSession")({});
  const mainAccess = multiBusinessSession.data.businesses.find((item) => item.id === businessId);
  const otherAccess = multiBusinessSession.data.businesses.find((item) => item.id === otherBusinessId);
  assert.deepEqual(mainAccess.modules, ["clientes"]);
  assert.deepEqual(otherAccess.modules, ["ventas"]);
  assert.notEqual(mainAccess.profileId, otherAccess.profileId);
  console.log("OK multiempresa: el mismo usuario conserva perfiles distintos por membresía");

  await expectCallableError(
    "businessId de otra empresa",
    () => call(owner, "actualizarMembresiaNegocio")({
      businessId: otherBusinessId,
      miembroUid: outsider.uid,
      rol: "TECNICO",
      estado: "inactivo",
    }),
    ["permission-denied"]
  );
  assert.equal(
    (await adminDb.doc(`membresias/${otherBusinessId}__${target.uid}`).get()).exists,
    true
  );
  const outsiderList = await call(outsider, "listarMiembrosNegocio")({
    businessId: otherBusinessId,
  });
  assert.deepEqual(
    outsiderList.data.miembros.map((item) => item.uid).sort(),
    [outsider.uid, target.uid].sort()
  );
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
