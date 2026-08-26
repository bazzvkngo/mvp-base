const {createHash, randomUUID} = require("node:crypto");

const PLATFORM_SUPERADMIN = "PLATFORM_SUPERADMIN";
const ACTIVE_STATUS = "activo";
const SUSPENDED_STATUS = "suspendido";
const BUSINESS_SUSPENDED_STATUS = "suspendida";
const MAX_PAGE_SIZE = 30;
const BUSINESS_SCAN_SIZE = 60;
const AUTH_SCAN_SIZE = 100;

function fail(HttpsError, code, message) {
  throw new HttpsError(code, message);
}

function text(value, max = 180) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function id(value, label, HttpsError) {
  const normalized = text(value, 160);
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(normalized)) {
    fail(HttpsError, "invalid-argument", `${label} no es valido.`);
  }
  return normalized;
}

function operationId(value, HttpsError) {
  const normalized = text(value, 120);
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(normalized)) {
    fail(HttpsError, "invalid-argument", "No se pudo validar la operacion.");
  }
  return normalized;
}

function pageSize(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, MAX_PAGE_SIZE)
    : 20;
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function searchable(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function includesSearch(haystack, search) {
  if (!search) return true;
  if (haystack.includes(search)) return true;
  const compactHaystack = haystack.replace(/[^a-z0-9]/g, "");
  const compactSearch = search.replace(/[^a-z0-9]/g, "");
  return Boolean(compactSearch) && compactHaystack.includes(compactSearch);
}

function filterValue(value, allowed, fallback, HttpsError) {
  const normalized = text(value, 40).toUpperCase() || fallback;
  if (!allowed.includes(normalized)) {
    fail(HttpsError, "invalid-argument", "Selecciona un filtro valido.");
  }
  return normalized;
}

function timestampToIso(value) {
  if (!value) return null;
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function verificationState(business = {}) {
  return text(business.verificacionEmpresa?.estado, 30) || "NO_VERIFICADA";
}

function platformUserStatus(user = {}, authUser = null) {
  return user.estadoPlataforma === SUSPENDED_STATUS || authUser?.disabled
    ? SUSPENDED_STATUS
    : ACTIVE_STATUS;
}

async function requirePlatformSuperadmin(request, {auth, db, HttpsError}) {
  const uid = request?.auth?.uid;
  if (!uid) fail(HttpsError, "unauthenticated", "Debes iniciar sesion.");
  if (request?.auth?.token?.platformRole !== PLATFORM_SUPERADMIN) {
    fail(HttpsError, "permission-denied", "Se requiere autoridad de plataforma.");
  }
  const [userSnapshot, authUser] = await Promise.all([
    db.collection("usuarios").doc(uid).get(),
    auth.getUser(uid),
  ]);
  if (platformUserStatus(userSnapshot.data() || {}, authUser) !== ACTIVE_STATUS) {
    fail(HttpsError, "permission-denied", "La cuenta de plataforma esta suspendida.");
  }
  return {uid, authUser};
}

function chunks(values, size = 30) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function authUsersByUid(auth, uids) {
  const result = new Map();
  for (const batch of chunks([...new Set(uids)].filter(Boolean), 100)) {
    if (!batch.length) continue;
    const response = await auth.getUsers(batch.map((uid) => ({uid})));
    response.users.forEach((user) => result.set(user.uid, user));
  }
  return result;
}

async function profilesByUid(db, uids) {
  const unique = [...new Set(uids)].filter(Boolean);
  if (!unique.length) return new Map();
  const refs = unique.map((uid) =>
    db.collection("usuarios").doc(uid).collection("cuenta").doc("perfil")
  );
  const snapshots = await db.getAll(...refs);
  return new Map(snapshots.map((snapshot, index) => [unique[index], snapshot.data() || {}]));
}

function personName(profile = {}, authUser = null) {
  return [profile.nombres, profile.apellidos]
    .map((part) => text(part, 120))
    .filter(Boolean)
    .join(" ") || text(authUser?.displayName, 240) || "Sin nombre registrado";
}

async function membershipsForBusinesses(db, businessIds) {
  const result = [];
  for (const batch of chunks(businessIds, 30)) {
    if (!batch.length) continue;
    const snapshot = await db.collection("membresias")
      .where("negocioId", "in", batch).get();
    result.push(...snapshot.docs);
  }
  return result;
}

async function buildBusinessDtos(db, auth, businessSnapshots) {
  const businessIds = businessSnapshots.map((snapshot) => snapshot.id);
  const memberships = await membershipsForBusinesses(db, businessIds);
  const ownerMemberships = memberships.filter((snapshot) =>
    snapshot.data()?.rol === "OWNER"
  );
  const ownerUids = ownerMemberships.map((snapshot) => snapshot.data()?.uid);
  const [authUsers, profiles] = await Promise.all([
    authUsersByUid(auth, ownerUids),
    profilesByUid(db, ownerUids),
  ]);
  const membershipsByBusiness = new Map();
  memberships.forEach((snapshot) => {
    const membership = snapshot.data() || {};
    const list = membershipsByBusiness.get(membership.negocioId) || [];
    list.push(membership);
    membershipsByBusiness.set(membership.negocioId, list);
  });
  return businessSnapshots.map((snapshot) => {
    const business = snapshot.data() || {};
    const businessMemberships = membershipsByBusiness.get(snapshot.id) || [];
    const owner = businessMemberships.find((membership) => membership.rol === "OWNER");
    const authUser = owner ? authUsers.get(owner.uid) : null;
    const profile = owner ? profiles.get(owner.uid) : null;
    return {
      id: snapshot.id,
      nombreComercial: text(business.nombreComercial, 180) || "Empresa sin nombre",
      razonSocial: text(business.razonSocial, 180),
      paisCodigo: text(business.paisCodigo, 10) || "CL",
      identificadorFiscalTipo: text(
        business.verificacionEmpresa?.identificadorFiscalTipo ||
        business.identificadorFiscalTipo,
        40
      ),
      identificadorFiscalValor: text(
        business.verificacionEmpresa?.identificadorFiscalDeclaradoValor ||
        business.identificadorFiscalValor || business.rut,
        100
      ),
      propietario: owner ? {
        uid: owner.uid,
        nombre: personName(profile, authUser),
        correo: text(authUser?.email, 320),
      } : null,
      usuarios: businessMemberships.filter((membership) =>
        membership.estado === ACTIVE_STATUS
      ).length,
      estado: business.eliminadoEn ? "eliminada" : text(business.estado, 30) || ACTIVE_STATUS,
      verificacion: verificationState(business),
      fechaRegistro: timestampToIso(business.creadoEn),
      fechaSolicitud: timestampToIso(business.verificacionEmpresa?.solicitadoEn),
    };
  });
}

async function obtenerResumenPlataformaHandler(request, dependencies) {
  const {auth, db} = dependencies;
  await requirePlatformSuperadmin(request, dependencies);
  const [businessesSnapshot, membershipsSnapshot] = await Promise.all([
    db.collection("negocios").get(),
    db.collection("membresias").get(),
  ]);
  let totalUsers = 0;
  let suspendedUsers = 0;
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    totalUsers += page.users.length;
    suspendedUsers += page.users.filter((user) => user.disabled).length;
    pageToken = page.pageToken;
  } while (pageToken);
  const businesses = businessesSnapshot.docs.map((snapshot) => snapshot.data() || {});
  return {
    empresas: {
      total: businesses.length,
      activas: businesses.filter((business) => business.estado === ACTIVE_STATUS && !business.eliminadoEn).length,
      suspendidas: businesses.filter((business) => business.estado === BUSINESS_SUSPENDED_STATUS).length,
      verificacionesPendientes: businesses.filter((business) => verificationState(business) === "PENDIENTE").length,
      verificadas: businesses.filter((business) => verificationState(business) === "VERIFICADA").length,
    },
    usuarios: {
      total: totalUsers,
      suspendidos: suspendedUsers,
      conMembresiaActiva: new Set(membershipsSnapshot.docs
        .filter((snapshot) => snapshot.data()?.estado === ACTIVE_STATUS)
        .map((snapshot) => snapshot.data()?.uid)).size,
    },
  };
}

async function listarEmpresasPlataformaHandler(request, dependencies) {
  const {auth, db, FieldPath, HttpsError} = dependencies;
  await requirePlatformSuperadmin(request, dependencies);
  const limit = pageSize(request?.data?.limite);
  const cursor = text(request?.data?.cursor, 160);
  const search = searchable(text(request?.data?.busqueda, 180));
  const country = filterValue(
    request?.data?.pais,
    ["TODOS", "CL", "BO", "BR", "PE", "AR", "CO", "EC", "PY", "UY", "MX", "OTHER"],
    "TODOS",
    HttpsError
  );
  const state = filterValue(
    request?.data?.estado,
    ["TODOS", "ACTIVO", "ACTIVA", "SUSPENDIDA", "ELIMINADA"],
    "TODOS",
    HttpsError
  ).toLowerCase();
  const verification = filterValue(
    request?.data?.verificacion,
    ["TODAS", "NO_VERIFICADA", "PENDIENTE", "VERIFICADA", "RECHAZADA"],
    "TODAS",
    HttpsError
  );
  const verificationMode = text(request?.data?.modo, 30).toUpperCase() ===
    "VERIFICACIONES";
  const collection = db.collection("negocios");
  let query = verificationMode && verification === "PENDIENTE"
    ? collection.orderBy("verificacionEmpresa.solicitadoEn", "desc")
      .orderBy(FieldPath.documentId())
    : collection.orderBy("creadoEn", "desc").orderBy(FieldPath.documentId());
  if (cursor) {
    id(cursor, "El cursor", HttpsError);
    const cursorSnapshot = await collection.doc(cursor).get();
    if (!cursorSnapshot.exists) {
      fail(HttpsError, "invalid-argument", "El cursor ya no esta disponible.");
    }
    query = query.startAfter(cursorSnapshot);
  }

  const matches = [];
  let exhausted = false;
  let scanQuery = query;
  while (matches.length <= limit && !exhausted) {
    const snapshot = await scanQuery.limit(BUSINESS_SCAN_SIZE).get();
    exhausted = snapshot.size < BUSINESS_SCAN_SIZE;
    if (!snapshot.empty) {
      const dtos = await buildBusinessDtos(db, auth, snapshot.docs);
      dtos.forEach((business, index) => {
        const haystack = searchable([
          business.nombreComercial,
          business.razonSocial,
          business.propietario?.correo,
          business.id,
          business.identificadorFiscalValor,
        ].filter(Boolean).join(" "));
        const normalizedState = business.estado === "activo" ? "activa" : business.estado;
        if (
          includesSearch(haystack, search) &&
          (country === "TODOS" || business.paisCodigo === country) &&
          (state === "todos" || normalizedState === state) &&
          (verification === "TODAS" || business.verificacion === verification)
        ) {
          matches.push({dto: business, snapshot: snapshot.docs[index]});
        }
      });
      scanQuery = query.startAfter(snapshot.docs.at(-1));
    }
  }
  const page = matches.slice(0, limit);
  return {
    empresas: page.map((match) => match.dto),
    cursor: matches.length > limit ? page.at(-1)?.snapshot.id || null : null,
  };
}

async function obtenerEmpresaPlataformaHandler(request, dependencies) {
  const {auth, db, HttpsError} = dependencies;
  await requirePlatformSuperadmin(request, dependencies);
  const businessId = id(request?.data?.businessId, "La empresa", HttpsError);
  const businessRef = db.collection("negocios").doc(businessId);
  const [businessSnapshot, profileSnapshot, membershipsSnapshot,
    verificationEvents, platformEvents] = await Promise.all([
    businessRef.get(),
    businessRef.collection("empresa").doc("perfil").get(),
    db.collection("membresias").where("negocioId", "==", businessId).get(),
    businessRef.collection("eventosVerificacionEmpresa").orderBy("creadoEn", "desc").limit(30).get(),
    businessRef.collection("eventosPlataforma").orderBy("creadoEn", "desc").limit(30).get(),
  ]);
  if (!businessSnapshot.exists) fail(HttpsError, "not-found", "No se encontro la empresa.");
  const memberships = membershipsSnapshot.docs.map((snapshot) => ({
    id: snapshot.id,
    ...snapshot.data(),
  }));
  const uids = memberships.map((membership) => membership.uid);
  const [authUsers, profiles] = await Promise.all([
    authUsersByUid(auth, uids),
    profilesByUid(db, uids),
  ]);
  const members = memberships.map((membership) => {
    const authUser = authUsers.get(membership.uid);
    return {
      uid: membership.uid,
      nombre: personName(profiles.get(membership.uid), authUser),
      correo: text(authUser?.email, 320),
      rol: membership.rol,
      estado: membership.estado,
      fechaIncorporacion: timestampToIso(membership.creadoEn),
    };
  }).sort((left, right) => left.rol.localeCompare(right.rol) || left.nombre.localeCompare(right.nombre, "es"));
  const business = businessSnapshot.data() || {};
  const profile = profileSnapshot.data() || {};
  const currentRequestId = business.verificacionEmpresa?.solicitudIdActual;
  const currentRequest = currentRequestId
    ? await businessRef.collection("solicitudesVerificacionEmpresa").doc(currentRequestId).get()
    : null;
  const eventDto = (snapshot, origin) => ({
    id: snapshot.id,
    origen: origin,
    tipo: text(snapshot.data()?.tipo, 80),
    estadoAnterior: text(snapshot.data()?.estadoAnterior, 40),
    estadoResultante: text(snapshot.data()?.estadoResultante, 40),
    motivo: text(snapshot.data()?.motivo, 1000),
    creadoPorUid: text(snapshot.data()?.creadoPorUid, 160),
    creadoEn: timestampToIso(snapshot.data()?.creadoEn),
  });
  return {
    empresa: {
      id: businessId,
      nombreComercial: text(profile.nombreComercial || business.nombreComercial, 180),
      razonSocial: text(profile.razonSocial || business.razonSocial, 180),
      paisCodigo: text(profile.paisCodigo || business.paisCodigo, 10),
      identificadorFiscalTipo: text(profile.identificadorFiscalTipo || business.identificadorFiscalTipo, 40),
      identificadorFiscalValor: text(profile.identificadorFiscalValor || profile.rut || business.identificadorFiscalValor || business.rut, 100),
      email: text(profile.email || business.email, 320),
      telefono: text(profile.telefono || business.telefono, 80),
      direccion: text(profile.direccion || business.direccion, 300),
      estado: business.eliminadoEn ? "eliminada" : text(business.estado, 30) || ACTIVE_STATUS,
      fechaRegistro: timestampToIso(business.creadoEn),
      verificacion: business.verificacionEmpresa || {estado: "NO_VERIFICADA"},
    },
    propietario: members.find((member) => member.rol === "OWNER") || null,
    miembros: members,
    solicitudActual: currentRequest?.exists ? {
      id: currentRequest.id,
      ...currentRequest.data(),
      solicitadoEn: timestampToIso(currentRequest.data()?.solicitadoEn),
    } : null,
    eventos: [
      ...verificationEvents.docs.map((snapshot) => eventDto(snapshot, "VERIFICACION")),
      ...platformEvents.docs.map((snapshot) => eventDto(snapshot, "PLATAFORMA")),
    ].sort((left, right) => String(right.creadoEn || "").localeCompare(String(left.creadoEn || ""))),
  };
}

async function obtenerDocumentoVerificacionPlataformaHandler(
  request,
  dependencies
) {
  const {bucket, db, HttpsError} = dependencies;
  await requirePlatformSuperadmin(request, dependencies);
  const businessId = id(request?.data?.businessId, "La empresa", HttpsError);
  const verificationRequestId = id(
    request?.data?.solicitudId,
    "La solicitud",
    HttpsError
  );
  const snapshot = await db.collection("negocios").doc(businessId)
    .collection("solicitudesVerificacionEmpresa")
    .doc(verificationRequestId).get();
  if (!snapshot.exists || snapshot.data()?.negocioId !== businessId) {
    fail(HttpsError, "not-found", "No se encontro la solicitud.");
  }
  const evidence = snapshot.data()?.documentoAcreditativo;
  const path = text(evidence?.ruta, 500);
  if (!path.startsWith(`negocios/${businessId}/verificacion/`)) {
    fail(HttpsError, "not-found", "La solicitud no tiene un documento acreditativo.");
  }
  const file = bucket.file(path);
  const [metadata] = await file.getMetadata();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  let url;
  if (process.env.FUNCTIONS_EMULATOR === "true" &&
    process.env.STORAGE_EMULATOR_HOST) {
    const token = randomUUID();
    await file.setMetadata({
      metadata: {...metadata.metadata, firebaseStorageDownloadTokens: token},
    });
    const host = process.env.STORAGE_EMULATOR_HOST.replace(/^https?:\/\//, "");
    url = `http://${host}/v0/b/${encodeURIComponent(bucket.name)}/o/` +
      `${encodeURIComponent(path)}?alt=media&token=${token}`;
  } else {
    [url] = await file.getSignedUrl({action: "read", expires: expiresAt});
  }
  return {
    url,
    nombre: text(evidence.nombreOriginal, 240) || "documento-acreditativo",
    tipoContenido: text(metadata.contentType, 100),
    expiraEn: new Date(expiresAt).toISOString(),
  };
}

async function membershipsForUsers(db, uids) {
  const result = [];
  for (const batch of chunks(uids, 30)) {
    if (!batch.length) continue;
    const snapshot = await db.collection("membresias").where("uid", "in", batch).get();
    result.push(...snapshot.docs);
  }
  return result;
}

async function buildUserDtos(db, authUsers) {
  const uids = authUsers.map((user) => user.uid);
  const [userSnapshots, profiles, memberships] = await Promise.all([
    uids.length ? db.getAll(...uids.map((uid) => db.collection("usuarios").doc(uid))) : [],
    profilesByUid(db, uids),
    membershipsForUsers(db, uids),
  ]);
  const usersByUid = new Map(userSnapshots.map((snapshot) => [snapshot.id, snapshot.data() || {}]));
  const membershipsByUid = new Map();
  memberships.forEach((snapshot) => {
    const membership = snapshot.data() || {};
    const list = membershipsByUid.get(membership.uid) || [];
    list.push(membership);
    membershipsByUid.set(membership.uid, list);
  });
  return authUsers.map((authUser) => {
    const user = usersByUid.get(authUser.uid) || {};
    const userMemberships = membershipsByUid.get(authUser.uid) || [];
    return {
      uid: authUser.uid,
      nombre: personName(profiles.get(authUser.uid), authUser),
      correo: text(authUser.email, 320),
      empresas: userMemberships.filter((membership) => membership.estado === ACTIVE_STATUS).length,
      estado: platformUserStatus(user, authUser),
      fechaAlta: authUser.metadata?.creationTime || timestampToIso(user.creadoEn),
      ultimoAcceso: authUser.metadata?.lastSignInTime || null,
    };
  });
}

function decodeAuthCursor(value, HttpsError) {
  const encoded = String(value ?? "");
  if (!encoded) return {pageToken: undefined, offset: 0};
  if (encoded.length > 6000 || !/^[a-zA-Z0-9_-]+$/.test(encoded)) {
    fail(HttpsError, "invalid-argument", "El cursor no es valido.");
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (
      typeof parsed?.pageToken !== "string" ||
      !Number.isInteger(parsed?.offset) ||
      parsed.offset < 0 || parsed.offset > AUTH_SCAN_SIZE
    ) {
      throw new Error("invalid cursor");
    }
    return {pageToken: parsed.pageToken || undefined, offset: parsed.offset};
  } catch {
    fail(HttpsError, "invalid-argument", "El cursor no es valido.");
  }
}

function encodeAuthCursor(pageToken, offset) {
  return Buffer.from(JSON.stringify({pageToken: pageToken || "", offset}))
    .toString("base64url");
}

async function listarUsuariosPlataformaHandler(request, dependencies) {
  const {auth, HttpsError} = dependencies;
  await requirePlatformSuperadmin(request, dependencies);
  const limit = pageSize(request?.data?.limite);
  const search = searchable(text(request?.data?.busqueda, 180));
  const state = filterValue(
    request?.data?.estado,
    ["TODOS", "ACTIVO", "SUSPENDIDO"],
    "TODOS",
    HttpsError
  ).toLowerCase();
  const company = filterValue(
    request?.data?.empresa,
    ["TODAS", "CON_EMPRESA", "SIN_EMPRESA"],
    "TODAS",
    HttpsError
  );
  let {pageToken, offset} = decodeAuthCursor(request?.data?.cursor, HttpsError);
  const users = [];
  let continuation = null;
  let scanning = true;

  while (scanning) {
    const currentPageToken = pageToken;
    const page = await auth.listUsers(AUTH_SCAN_SIZE, currentPageToken);
    const dtos = await buildUserDtos(dependencies.db, page.users);
    for (let index = offset; index < dtos.length; index += 1) {
      const user = dtos[index];
      const haystack = searchable([user.nombre, user.correo, user.uid].join(" "));
      const hasCompany = user.empresas > 0;
      const matches =
        includesSearch(haystack, search) &&
        (state === "todos" || user.estado === state) &&
        (company === "TODAS" ||
          (company === "CON_EMPRESA" ? hasCompany : !hasCompany));
      if (!matches) continue;
      if (users.length === limit) {
        return {usuarios: users, cursor: continuation};
      }
      users.push(user);
      continuation = encodeAuthCursor(currentPageToken, index + 1);
    }
    if (!page.pageToken) return {usuarios: users, cursor: null};
    pageToken = page.pageToken;
    offset = 0;
  }
  return {usuarios: users, cursor: null};
}

async function obtenerUsuarioPlataformaHandler(request, dependencies) {
  const {auth, db, HttpsError} = dependencies;
  await requirePlatformSuperadmin(request, dependencies);
  const uid = id(request?.data?.uid, "El usuario", HttpsError);
  let authUser;
  try {
    authUser = await auth.getUser(uid);
  } catch (error) {
    if (String(error?.code || "").includes("user-not-found")) {
      fail(HttpsError, "not-found", "No se encontro el usuario.");
    }
    throw error;
  }
  const [userSnapshot, profileSnapshot, membershipsSnapshot, eventsSnapshot] = await Promise.all([
    db.collection("usuarios").doc(uid).get(),
    db.collection("usuarios").doc(uid).collection("cuenta").doc("perfil").get(),
    db.collection("membresias").where("uid", "==", uid).get(),
    db.collection("usuarios").doc(uid).collection("eventosPlataforma").orderBy("creadoEn", "desc").limit(30).get(),
  ]);
  const memberships = membershipsSnapshot.docs.map((snapshot) => snapshot.data() || {});
  const businessRefs = [...new Set(memberships.map((membership) => membership.negocioId).filter(Boolean))]
    .map((businessId) => db.collection("negocios").doc(businessId));
  const businessSnapshots = businessRefs.length ? await db.getAll(...businessRefs) : [];
  const businesses = new Map(businessSnapshots.map((snapshot) => [snapshot.id, snapshot.data() || {}]));
  const user = userSnapshot.data() || {};
  const profile = profileSnapshot.data() || {};
  return {
    usuario: {
      uid,
      nombre: personName(profile, authUser),
      correo: text(authUser.email, 320),
      estado: platformUserStatus(user, authUser),
      fechaAlta: authUser.metadata?.creationTime || timestampToIso(user.creadoEn),
      ultimoAcceso: authUser.metadata?.lastSignInTime || null,
    },
    membresias: memberships.map((membership) => ({
      negocioId: membership.negocioId,
      empresa: text(businesses.get(membership.negocioId)?.nombreComercial, 180) || "Empresa sin nombre",
      rol: membership.rol,
      estado: membership.estado,
      fechaIncorporacion: timestampToIso(membership.creadoEn),
    })),
    eventos: eventsSnapshot.docs.map((snapshot) => ({
      id: snapshot.id,
      tipo: text(snapshot.data()?.tipo, 80),
      estadoAnterior: text(snapshot.data()?.estadoAnterior, 40),
      estadoResultante: text(snapshot.data()?.estadoResultante, 40),
      creadoPorUid: text(snapshot.data()?.creadoPorUid, 160),
      creadoEn: timestampToIso(snapshot.data()?.creadoEn),
    })),
  };
}

async function cambiarEstadoEmpresaPlataformaHandler(request, dependencies) {
  const {db, FieldValue, HttpsError} = dependencies;
  const actor = await requirePlatformSuperadmin(request, dependencies);
  const businessId = id(request?.data?.businessId, "La empresa", HttpsError);
  const desired = text(request?.data?.estado, 30).toLowerCase();
  if (![ACTIVE_STATUS, BUSINESS_SUSPENDED_STATUS].includes(desired)) {
    fail(HttpsError, "invalid-argument", "Selecciona un estado valido.");
  }
  const requestId = operationId(request?.data?.requestId, HttpsError);
  const reason = text(request?.data?.motivo, 1000);
  if (desired === BUSINESS_SUSPENDED_STATUS && !reason) {
    fail(HttpsError, "invalid-argument", "Indica el motivo de la suspension.");
  }
  const requestFingerprint = fingerprint({businessId, desired, reason});
  const businessRef = db.collection("negocios").doc(businessId);
  const operationRef = businessRef.collection("platformBusinessStatusRequests").doc(requestId);
  const eventRef = businessRef.collection("eventosPlataforma").doc();
  return db.runTransaction(async (transaction) => {
    const [operation, businessSnapshot] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(businessRef),
    ]);
    if (operation.exists) {
      const stored = operation.data() || {};
      if (stored.creadoPorUid !== actor.uid || stored.fingerprint !== requestFingerprint) {
        fail(HttpsError, "already-exists", "La operacion ya fue utilizada con otros datos.");
      }
      return {businessId, estado: stored.estado, idempotent: true};
    }
    if (!businessSnapshot.exists) fail(HttpsError, "not-found", "No se encontro la empresa.");
    const business = businessSnapshot.data() || {};
    if (business.eliminadoEn || business.estado === "eliminada") {
      fail(HttpsError, "failed-precondition", "Una empresa eliminada no puede reactivarse.");
    }
    const previous = text(business.estado, 30) || ACTIVE_STATUS;
    const timestamp = FieldValue.serverTimestamp();
    if (previous !== desired) {
      transaction.update(businessRef, {
        estado: desired,
        actualizadoPorUid: actor.uid,
        actualizadoEn: timestamp,
        ...(desired === BUSINESS_SUSPENDED_STATUS ? {
          suspendidaPorUid: actor.uid,
          suspendidaEn: timestamp,
          motivoSuspension: reason,
        } : {
          suspendidaPorUid: FieldValue.delete(),
          suspendidaEn: FieldValue.delete(),
          motivoSuspension: FieldValue.delete(),
          reactivadaPorUid: actor.uid,
          reactivadaEn: timestamp,
        }),
      });
      transaction.create(eventRef, {
        negocioId: businessId,
        tipo: desired === BUSINESS_SUSPENDED_STATUS ? "EMPRESA_SUSPENDIDA" : "EMPRESA_REACTIVADA",
        estadoAnterior: previous,
        estadoResultante: desired,
        ...(reason ? {motivo: reason} : {}),
        creadoPorUid: actor.uid,
        creadoEn: timestamp,
      });
    }
    transaction.create(operationRef, {
      negocioId: businessId,
      estado: desired,
      creadoPorUid: actor.uid,
      fingerprint: requestFingerprint,
      creadoEn: timestamp,
    });
    return {businessId, estado: desired, idempotent: false};
  });
}

async function cambiarEstadoUsuarioPlataformaHandler(request, dependencies) {
  const {auth, db, FieldValue, HttpsError} = dependencies;
  const actor = await requirePlatformSuperadmin(request, dependencies);
  const uid = id(request?.data?.uid, "El usuario", HttpsError);
  if (uid === actor.uid) fail(HttpsError, "failed-precondition", "No puedes suspender tu propia cuenta.");
  const desired = text(request?.data?.estado, 30).toLowerCase();
  if (![ACTIVE_STATUS, SUSPENDED_STATUS].includes(desired)) {
    fail(HttpsError, "invalid-argument", "Selecciona un estado valido.");
  }
  const requestId = operationId(request?.data?.requestId, HttpsError);
  const reason = text(request?.data?.motivo, 1000);
  if (desired === SUSPENDED_STATUS && !reason) {
    fail(HttpsError, "invalid-argument", "Indica el motivo de la suspension.");
  }
  const targetAuth = await auth.getUser(uid);
  if (targetAuth.customClaims?.platformRole === PLATFORM_SUPERADMIN) {
    fail(HttpsError, "failed-precondition", "Las cuentas PLATFORM_SUPERADMIN no se suspenden desde este panel.");
  }
  const requestFingerprint = fingerprint({uid, desired, reason});
  const userRef = db.collection("usuarios").doc(uid);
  const operationRef = db.collection("platformUserStatusRequests").doc(requestId);
  const eventRef = userRef.collection("eventosPlataforma").doc();
  const result = await db.runTransaction(async (transaction) => {
    const [operation, userSnapshot] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(userRef),
    ]);
    if (operation.exists) {
      const stored = operation.data() || {};
      if (stored.uidUsuario !== uid || stored.creadoPorUid !== actor.uid ||
        stored.fingerprint !== requestFingerprint) {
        fail(HttpsError, "already-exists", "La operacion ya fue utilizada con otros datos.");
      }
      return {uid, estado: stored.estado, idempotent: true};
    }
    const user = userSnapshot.data() || {};
    const previous = platformUserStatus(user, targetAuth);
    const timestamp = FieldValue.serverTimestamp();
    transaction.set(userRef, {
      estadoPlataforma: desired,
      actualizadoEn: timestamp,
      ...(userSnapshot.exists ? {} : {
        email: targetAuth.email || null,
        creadoEn: timestamp,
      }),
      ...(desired === SUSPENDED_STATUS ? {
        suspendidoPlataformaPorUid: actor.uid,
        suspendidoPlataformaEn: timestamp,
        motivoSuspensionPlataforma: reason,
      } : {
        suspendidoPlataformaPorUid: FieldValue.delete(),
        suspendidoPlataformaEn: FieldValue.delete(),
        motivoSuspensionPlataforma: FieldValue.delete(),
        reactivadoPlataformaPorUid: actor.uid,
        reactivadoPlataformaEn: timestamp,
      }),
    }, {merge: true});
    if (previous !== desired) {
      transaction.create(eventRef, {
        uidUsuario: uid,
        tipo: desired === SUSPENDED_STATUS ? "USUARIO_SUSPENDIDO" : "USUARIO_REACTIVADO",
        estadoAnterior: previous,
        estadoResultante: desired,
        ...(reason ? {motivo: reason} : {}),
        creadoPorUid: actor.uid,
        creadoEn: timestamp,
      });
    }
    transaction.create(operationRef, {
      uidUsuario: uid,
      estado: desired,
      creadoPorUid: actor.uid,
      fingerprint: requestFingerprint,
      creadoEn: timestamp,
    });
    return {uid, estado: desired, idempotent: false};
  });
  await auth.updateUser(uid, {disabled: desired === SUSPENDED_STATUS});
  if (desired === SUSPENDED_STATUS) await auth.revokeRefreshTokens(uid);
  return result;
}

async function deleteDocuments(db, documents) {
  for (const group of chunks(documents, 400)) {
    if (!group.length) continue;
    const batch = db.batch();
    group.forEach((snapshot) => batch.delete(snapshot.ref));
    await batch.commit();
  }
}

async function repairUsersAfterBusinessDeletion(
  db,
  deletedBusinessId,
  deletedMemberships,
  FieldValue
) {
  const byUid = new Map();
  deletedMemberships.forEach((snapshot) => {
    const membership = snapshot.data() || {};
    if (membership.uid) byUid.set(membership.uid, membership);
  });

  for (const [uid, deletedMembership] of byUid) {
    const userRef = db.collection("usuarios").doc(uid);
    const [userSnapshot, membershipsSnapshot] = await Promise.all([
      userRef.get(),
      db.collection("membresias").where("uid", "==", uid).get(),
    ]);
    const remaining = membershipsSnapshot.docs
      .map((snapshot) => snapshot.data() || {})
      .filter((membership) =>
        membership.negocioId && membership.negocioId !== deletedBusinessId
      );
    const businessIds = [...new Set(remaining.map((item) => item.negocioId))];
    const businessSnapshots = businessIds.length
      ? await db.getAll(...businessIds.map((currentBusinessId) =>
        db.collection("negocios").doc(currentBusinessId)
      ))
      : [];
    const availableIds = businessSnapshots
      .filter((snapshot) => {
        const business = snapshot.data() || {};
        const membership = remaining.find((item) =>
          item.negocioId === snapshot.id
        );
        return snapshot.exists && membership?.estado === ACTIVE_STATUS &&
          !business.eliminadoEn && business.estado === ACTIVE_STATUS;
      })
      .map((snapshot) => snapshot.id);
    const user = userSnapshot.data() || {};
    const nextBusinessId = availableIds.includes(user.negocioActivoId)
      ? user.negocioActivoId
      : availableIds[0] || null;
    const patch = {actualizadoEn: FieldValue.serverTimestamp()};
    if (user.negocioActivoId === deletedBusinessId) {
      patch.negocioActivoId = nextBusinessId || FieldValue.delete();
    }
    if (user.primerNegocioId === deletedBusinessId) {
      patch.primerNegocioId = availableIds[0] || FieldValue.delete();
    }
    if (userSnapshot.exists && Object.keys(patch).length > 1) {
      await userRef.set(patch, {merge: true});
    }

    if (deletedMembership.rol === "OWNER") {
      const activeOwnedCount = remaining.filter((membership) =>
        membership.rol === "OWNER" &&
        membership.estado === ACTIVE_STATUS &&
        availableIds.includes(membership.negocioId)
      ).length;
      await userRef.collection("sistema").doc("negociosPropios").set({
        cantidad: activeOwnedCount,
        actualizadoEn: FieldValue.serverTimestamp(),
      }, {merge: true});
    }
  }
}

async function eliminarEmpresaPermanentePlataformaHandler(
  request,
  dependencies
) {
  const {bucket, db, FieldValue, HttpsError} = dependencies;
  const actor = await requirePlatformSuperadmin(request, dependencies);
  const businessId = id(request?.data?.businessId, "La empresa", HttpsError);
  const requestId = operationId(request?.data?.requestId, HttpsError);
  const confirmation = String(request?.data?.confirmacionNombreComercial ?? "");
  if (!confirmation || confirmation.length > 180) {
    fail(
      HttpsError,
      "invalid-argument",
      "Escribe el nombre comercial exacto para confirmar la eliminacion."
    );
  }
  const requestFingerprint = fingerprint({businessId, confirmation});
  const businessRef = db.collection("negocios").doc(businessId);
  const operationRef = db.collection("platformBusinessPermanentDeleteRequests")
    .doc(requestId);
  const auditRef = db.collection("auditoriaPlataforma").doc(requestId);

  const reservation = await db.runTransaction(async (transaction) => {
    const [operationSnapshot, businessSnapshot, profileSnapshot] =
      await Promise.all([
        transaction.get(operationRef),
        transaction.get(businessRef),
        transaction.get(businessRef.collection("empresa").doc("perfil")),
      ]);
    if (operationSnapshot.exists) {
      const operation = operationSnapshot.data() || {};
      if (
        operation.negocioId !== businessId ||
        operation.creadoPorUid !== actor.uid ||
        operation.fingerprint !== requestFingerprint
      ) {
        fail(
          HttpsError,
          "already-exists",
          "La operacion ya fue utilizada con otros datos."
        );
      }
      return {
        completed: operation.estado === "COMPLETADA",
        nombreComercial: operation.nombreComercial,
      };
    }
    if (!businessSnapshot.exists) {
      fail(HttpsError, "not-found", "No se encontro la empresa.");
    }
    const business = businessSnapshot.data() || {};
    const profile = profileSnapshot.data() || {};
    const currentName = String(
      profile.nombreComercial || business.nombreComercial || ""
    );
    if (!currentName || confirmation !== currentName) {
      fail(
        HttpsError,
        "failed-precondition",
        "El nombre comercial ingresado no coincide con la empresa."
      );
    }
    const now = FieldValue.serverTimestamp();
    transaction.create(operationRef, {
      negocioId: businessId,
      nombreComercial: currentName,
      estado: "EN_PROCESO",
      creadoPorUid: actor.uid,
      fingerprint: requestFingerprint,
      creadoEn: now,
      actualizadoEn: now,
    });
    transaction.create(auditRef, {
      tipo: "EMPRESA_ELIMINACION_PERMANENTE_INICIADA",
      negocioId: businessId,
      nombreComercial: currentName,
      creadoPorUid: actor.uid,
      creadoEn: now,
    });
    return {completed: false, nombreComercial: currentName};
  });

  if (reservation.completed) {
    return {businessId, estado: "eliminada", idempotent: true};
  }

  try {
    const [memberships, publicTokens, fiscalReservations] = await Promise.all([
      db.collection("membresias").where("negocioId", "==", businessId).get(),
      db.collection("quotePublicTokens").where("negocioId", "==", businessId).get(),
      db.collection("identidadesFiscalesVerificadas")
        .where("negocioId", "==", businessId).get(),
    ]);
    await bucket.deleteFiles({prefix: `negocios/${businessId}/`});
    await repairUsersAfterBusinessDeletion(
      db,
      businessId,
      memberships.docs,
      FieldValue
    );
    await deleteDocuments(db, [
      ...memberships.docs,
      ...publicTokens.docs,
      ...fiscalReservations.docs,
    ]);
    if ((await businessRef.get()).exists) await db.recursiveDelete(businessRef);
    const now = FieldValue.serverTimestamp();
    await Promise.all([
      operationRef.set({
        estado: "COMPLETADA",
        actualizadoEn: now,
        completadaEn: now,
      }, {merge: true}),
      auditRef.set({
        tipo: "EMPRESA_ELIMINADA_PERMANENTEMENTE",
        estado: "COMPLETADA",
        membresiasEliminadas: memberships.size,
        tokensPublicosEliminados: publicTokens.size,
        reservasFiscalesEliminadas: fiscalReservations.size,
        actualizadoEn: now,
      }, {merge: true}),
    ]);
    return {businessId, estado: "eliminada", idempotent: false};
  } catch (error) {
    await operationRef.set({
      estado: "FALLIDA",
      ultimoError: text(error?.message, 500),
      actualizadoEn: FieldValue.serverTimestamp(),
    }, {merge: true});
    throw error;
  }
}

module.exports = {
  ACTIVE_STATUS,
  BUSINESS_SUSPENDED_STATUS,
  PLATFORM_SUPERADMIN,
  SUSPENDED_STATUS,
  cambiarEstadoEmpresaPlataformaHandler,
  cambiarEstadoUsuarioPlataformaHandler,
  eliminarEmpresaPermanentePlataformaHandler,
  listarEmpresasPlataformaHandler,
  listarUsuariosPlataformaHandler,
  obtenerEmpresaPlataformaHandler,
  obtenerDocumentoVerificacionPlataformaHandler,
  obtenerResumenPlataformaHandler,
  obtenerUsuarioPlataformaHandler,
  requirePlatformSuperadmin,
};
