import {existsSync, readFileSync} from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";
import {getCACertificates, setDefaultCACertificates} from "node:tls";

if (process.platform === "win32") {
  setDefaultCACertificates([
    ...getCACertificates("default"),
    ...getCACertificates("system"),
  ]);
}

const PROJECT_ID = "tesis-inventario-ia";
const STORAGE_BUCKET = `${PROJECT_ID}.firebasestorage.app`;
const PRESERVED_ADMIN_EMAIL = "software.bagner@gmail.com";
const PLATFORM_SUPERADMIN = "PLATFORM_SUPERADMIN";

const RESET_ROOT_COLLECTIONS = new Set([
  "aiRateLimits",
  "auditoriaPlataforma",
  "identidadesFiscalesVerificadas",
  "membresias",
  "negocios",
  "platformBusinessPermanentDeleteRequests",
  "platformUserStatusRequests",
  "quotePublicTokens",
  "usuarios",
]);

const PRESERVED_ROOT_COLLECTIONS = new Set([
  "comunas",
  "configuracionGlobal",
  "metadatos",
  "monedas",
  "paises",
  "regiones",
  "rubros",
]);
const RESET_STORAGE_PREFIXES = ["negocios/", "usuarios/"];

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const confirm = argv.includes("--confirm");
  const unknown = argv.filter((argument) => argument !== "--confirm");
  if (unknown.length) fail(`Argumentos no reconocidos: ${unknown.join(", ")}`);
  return {confirm, mode: confirm ? "confirm" : "dry-run"};
}

function readConfiguredProject() {
  const configPath = path.resolve(".firebaserc");
  if (!existsSync(configPath)) fail("No se encontró .firebaserc en el directorio actual.");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  return String(config?.projects?.default || "").trim();
}

function firebaseToolsRootCandidates() {
  return [
    process.env.FIREBASE_TOOLS_ROOT,
    process.env.APPDATA && path.join(process.env.APPDATA, "npm", "node_modules", "firebase-tools"),
    path.join(path.dirname(process.execPath), "node_modules", "firebase-tools"),
  ].filter(Boolean);
}

function loadFirebaseCliAuth() {
  const cliRoot = firebaseToolsRootCandidates().find((candidate) =>
    existsSync(path.join(candidate, "lib", "apiv2.js"))
  );
  if (!cliRoot) {
    fail("Firebase CLI no está instalado. Instálalo e inicia sesión con firebase login.");
  }
  const require = createRequire(import.meta.url);
  const api = require(path.join(cliRoot, "lib", "apiv2.js"));
  const auth = require(path.join(cliRoot, "lib", "auth.js"));
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) {
    fail("Firebase CLI no tiene una sesión administrativa activa. Ejecuta firebase login.");
  }
  api.setRefreshToken(account.tokens.refresh_token);
  return {api, cliAccountEmail: account.user?.email || "desconocida"};
}

function parseClaims(rawClaims) {
  if (!rawClaims) return {};
  try {
    return JSON.parse(rawClaims);
  } catch {
    fail("La cuenta Administrador tiene custom claims ilegibles.");
  }
}

function documentRelativePath(name) {
  const marker = "/documents/";
  const index = String(name || "").indexOf(marker);
  if (index < 0) fail(`Ruta Firestore inesperada: ${name}`);
  return name.slice(index + marker.length);
}

function encodedFirestorePath(relativePath) {
  return relativePath.split("/").map(encodeURIComponent).join("/");
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function collectionIdForDocument(relativePath) {
  const segments = relativePath.split("/");
  return segments.at(-2) || "desconocida";
}

async function createApiClient(firebaseCliApi) {
  let accessToken = await firebaseCliApi.getAccessToken();
  async function request(url, options = {}, allowRetry = true) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    if (response.status === 401 && allowRetry) {
      accessToken = await firebaseCliApi.getAccessToken();
      return request(url, options, false);
    }
    const bodyText = await response.text();
    const body = bodyText ? JSON.parse(bodyText) : {};
    if (!response.ok) {
      fail(`${response.status} ${body?.error?.message || response.statusText}`);
    }
    return body;
  }
  return {request};
}

async function verifyProject(api) {
  const project = await api.request(
    `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT_ID}`
  );
  if (project.projectId !== PROJECT_ID || project.lifecycleState !== "ACTIVE") {
    fail(`Proyecto remoto no autorizado: ${project.projectId || "desconocido"}.`);
  }
  const configuredProject = readConfiguredProject();
  if (configuredProject !== PROJECT_ID) {
    fail(`Proyecto local no autorizado: ${configuredProject || "desconocido"}.`);
  }
  return project;
}

async function lookupAdmin(api) {
  const result = await api.request(
    `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:lookup`,
    {method: "POST", body: JSON.stringify({email: [PRESERVED_ADMIN_EMAIL]})}
  );
  const user = result.users?.find((entry) =>
    String(entry.email || "").toLowerCase() === PRESERVED_ADMIN_EMAIL
  );
  if (!user) return null;
  return {...user, claims: parseClaims(user.customAttributes)};
}

async function listAuthUsers(api) {
  const users = [];
  let pageToken = "";
  do {
    const url = new URL(
      `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:batchGet`
    );
    url.searchParams.set("maxResults", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await api.request(url);
    users.push(...(page.users || []));
    pageToken = page.nextPageToken || "";
  } while (pageToken);
  return users;
}

async function listCollectionIds(api, parentPath = "") {
  const endpoint = parentPath
    ? `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${encodedFirestorePath(parentPath)}:listCollectionIds`
    : `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:listCollectionIds`;
  const collectionIds = [];
  let pageToken = "";
  do {
    const page = await api.request(endpoint, {
      method: "POST",
      body: JSON.stringify({pageSize: 1000, ...(pageToken ? {pageToken} : {})}),
    });
    collectionIds.push(...(page.collectionIds || []));
    pageToken = page.nextPageToken || "";
  } while (pageToken);
  return collectionIds.sort();
}

async function listDocuments(api, parentPath, collectionId) {
  const basePath = [parentPath, collectionId].filter(Boolean).join("/");
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${encodedFirestorePath(basePath)}`
  );
  url.searchParams.set("pageSize", "1000");
  url.searchParams.set("showMissing", "true");
  const documents = [];
  let pageToken = "";
  do {
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    else url.searchParams.delete("pageToken");
    const page = await api.request(url);
    documents.push(...(page.documents || []));
    pageToken = page.nextPageToken || "";
  } while (pageToken);
  return documents;
}

async function auditCollectionTree(api, rootCollectionId) {
  const documentsToDelete = [];
  const counts = new Map();
  let orphanParents = 0;

  async function walk(parentPath, collectionId) {
    const documents = await listDocuments(api, parentPath, collectionId);
    for (const document of documents) {
      const relativePath = documentRelativePath(document.name);
      const exists = Boolean(document.createTime || document.updateTime || document.fields);
      if (exists) {
        documentsToDelete.push({name: document.name, path: relativePath});
        increment(counts, collectionIdForDocument(relativePath));
      } else {
        orphanParents += 1;
      }
      const nestedCollectionIds = await listCollectionIds(api, relativePath);
      for (const nestedCollectionId of nestedCollectionIds) {
        await walk(relativePath, nestedCollectionId);
      }
    }
  }

  await walk("", rootCollectionId);
  return {
    counts: Object.fromEntries([...counts.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    )),
    documentsToDelete,
    orphanParents,
  };
}

async function auditFirestore(api) {
  const rootCollectionIds = await listCollectionIds(api);
  const collections = [];
  for (const id of rootCollectionIds) {
    const tree = await auditCollectionTree(api, id);
    const action = RESET_ROOT_COLLECTIONS.has(id)
      ? "eliminar"
      : PRESERVED_ROOT_COLLECTIONS.has(id)
        ? "preservar"
        : "revision_requerida";
    collections.push({action, id, ...tree});
  }
  return collections;
}

async function listStorageFiles(api) {
  const files = [];
  let pageToken = "";
  do {
    const url = new URL(`https://storage.googleapis.com/storage/v1/b/${STORAGE_BUCKET}/o`);
    url.searchParams.set("maxResults", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await api.request(url);
    files.push(...(page.items || []));
    pageToken = page.nextPageToken || "";
  } while (pageToken);
  return files;
}

function printablePlan({admin, authUsers, cliAccountEmail, firestore, files, mode}) {
  const firestoreDelete = firestore.filter(({action}) => action === "eliminar");
  const firestorePreserve = firestore.filter(({action}) => action === "preservar");
  const firestoreReview = firestore.filter(({action}) => action === "revision_requerida");
  const authUsersToDelete = authUsers.filter(({localId}) => localId !== admin?.localId);
  const storageFilesToDelete = files.filter(({name}) =>
    RESET_STORAGE_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
  const storageFilesToReview = files.filter(({name}) =>
    !RESET_STORAGE_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
  return {
    modo: mode,
    proyecto: PROJECT_ID,
    sesionFirebaseCli: cliAccountEmail,
    preservado: {
      cuentaAuth: admin ? {
        email: admin.email,
        uid: admin.localId,
        disabled: Boolean(admin.disabled),
        customClaims: admin.claims,
      } : null,
      infraestructura: [
        "Proyecto Firebase",
        "Cloud Functions",
        "Firestore Rules e índices",
        "Storage Rules",
        "secrets y variables de entorno",
        "configuración Firebase/Gemini/Resend",
      ],
      firestoreGlobal: firestorePreserve.map(({id, documentsToDelete}) => ({
        coleccion: id,
        documentos: documentsToDelete.length,
      })),
    },
    firestore: {
      eliminar: firestoreDelete.map(({counts, documentsToDelete, id, orphanParents}) => ({
        coleccionRaiz: id,
        documentos: documentsToDelete.length,
        cantidadesPorColeccion: counts,
        padresHuerfanosDetectados: orphanParents,
      })),
      totalDocumentos: firestoreDelete.reduce(
        (total, {documentsToDelete}) => total + documentsToDelete.length,
        0
      ),
      revisionRequerida: firestoreReview.map(({id, documentsToDelete}) => ({
        coleccionRaiz: id,
        documentos: documentsToDelete.length,
      })),
    },
    auth: {
      totalUsuarios: authUsers.length,
      eliminar: authUsersToDelete.map((user) => ({
        email: user.email || null,
        uid: user.localId,
        disabled: Boolean(user.disabled),
      })),
    },
    storage: {
      bucket: STORAGE_BUCKET,
      totalArchivos: files.length,
      eliminar: storageFilesToDelete.map(({name, size}) => ({
        name,
        bytes: Number(size || 0),
      })),
      revisionRequerida: storageFilesToReview.map(({name, size}) => ({
        name,
        bytes: Number(size || 0),
      })),
    },
  };
}

function validatePlan({admin, files, firestore}) {
  const blockers = [];
  if (!admin) blockers.push(`No existe ${PRESERVED_ADMIN_EMAIL} en Firebase Auth.`);
  if (admin && admin.claims?.platformRole !== PLATFORM_SUPERADMIN) {
    blockers.push(
      `${PRESERVED_ADMIN_EMAIL} no tiene platformRole = ${PLATFORM_SUPERADMIN}.`
    );
  }
  const unknownCollections = firestore
    .filter(({action}) => action === "revision_requerida")
    .map(({id}) => id);
  if (unknownCollections.length) {
    blockers.push(`Colecciones Firestore no clasificadas: ${unknownCollections.join(", ")}.`);
  }
  const unknownStorageFiles = files.filter(({name}) =>
    !RESET_STORAGE_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
  if (unknownStorageFiles.length) {
    blockers.push(`${unknownStorageFiles.length} archivos Storage no están clasificados.`);
  }
  if (blockers.length) fail(`Reset abortado: ${blockers.join(" ")}`);
}

async function deleteStorageFiles(api, files) {
  const filesToDelete = files.filter(({name}) =>
    RESET_STORAGE_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
  for (const file of filesToDelete) {
    await api.request(
      `https://storage.googleapis.com/storage/v1/b/${STORAGE_BUCKET}/o/${encodeURIComponent(file.name)}`,
      {method: "DELETE"}
    );
  }
}

async function deleteFirestoreDocuments(api, firestore) {
  const documents = firestore
    .filter(({action}) => action === "eliminar")
    .flatMap(({documentsToDelete}) => documentsToDelete)
    .sort((left, right) => right.path.split("/").length - left.path.split("/").length);
  for (const document of documents) {
    await api.request(`https://firestore.googleapis.com/v1/${document.name}`, {method: "DELETE"});
  }
}

async function deleteAuthUsers(api, users, preservedUid) {
  for (const user of users) {
    if (user.localId === preservedUid) continue;
    await api.request(
      `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:delete`,
      {method: "POST", body: JSON.stringify({localId: user.localId})}
    );
  }
}

async function verifyPostReset(api, preservedUid) {
  const [admin, authUsers, firestore, files] = await Promise.all([
    lookupAdmin(api),
    listAuthUsers(api),
    auditFirestore(api),
    listStorageFiles(api),
  ]);
  const remainingDocuments = firestore
    .filter(({action}) => action === "eliminar")
    .reduce((total, {documentsToDelete}) => total + documentsToDelete.length, 0);
  const remainingBusinessFiles = files.filter(({name}) =>
    RESET_STORAGE_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
  if (
    !admin ||
    admin.localId !== preservedUid ||
    admin.claims?.platformRole !== PLATFORM_SUPERADMIN ||
    authUsers.length !== 1 ||
    authUsers[0].localId !== preservedUid ||
    remainingDocuments ||
    remainingBusinessFiles.length
  ) {
    fail("El reset terminó con datos QA residuales; revisa el plan y vuelve a ejecutarlo.");
  }
}

async function main() {
  const {confirm, mode} = parseArguments(process.argv.slice(2));
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    fail("No se permite usar service-account JSON en este reset.");
  }
  const {api: firebaseCliApi, cliAccountEmail} = loadFirebaseCliAuth();
  const api = await createApiClient(firebaseCliApi);
  await verifyProject(api);

  const [admin, authUsers, firestore, files] = await Promise.all([
    lookupAdmin(api),
    listAuthUsers(api),
    auditFirestore(api),
    listStorageFiles(api),
  ]);
  const context = {admin, authUsers, cliAccountEmail, firestore, files, mode};
  console.log("RESET_PRODUCTION_V1_QA_PLAN");
  console.log(JSON.stringify(printablePlan(context), null, 2));
  validatePlan(context);

  if (!confirm) {
    console.log("RESET_PRODUCTION_V1_QA_DRY_RUN_OK: no se eliminó ningún dato.");
    return;
  }

  const confirmedAdmin = await lookupAdmin(api);
  if (
    !confirmedAdmin ||
    confirmedAdmin.localId !== admin.localId ||
    confirmedAdmin.claims?.platformRole !== PLATFORM_SUPERADMIN
  ) {
    fail("La cuenta Administrador cambió después de la auditoría. Reset abortado.");
  }
  await deleteStorageFiles(api, files);
  await deleteFirestoreDocuments(api, firestore);
  await deleteAuthUsers(api, authUsers, admin.localId);
  await verifyPostReset(api, admin.localId);
  console.log("RESET_PRODUCTION_V1_QA_CONFIRM_OK", JSON.stringify({
    preservedAuthEmail: admin.email,
    projectId: PROJECT_ID,
  }));
}

try {
  await main();
} catch (error) {
  console.error("RESET_PRODUCTION_V1_QA_ABORTED:", error?.message || error);
  process.exitCode = 1;
}
