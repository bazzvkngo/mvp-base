import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createServer} from "vite";

// A1 (SPEC 014, activación reactiva sin F5): la comparación de AppLayout que antes fallaba.
// AppLayout solo revalida la sesión si el perfil observado en vivo es del negocio activo.
// Ese perfil sale de normalizeCompanyProfile, que NO devuelve negocioId ni id; el efecto
// comparaba "" contra businessId y retornaba siempre antes de mirar el estado de verificación.
// scripts/reactive-business-session-smoke.mjs no monta AppLayout y no lo detectaba. Aquí se
// usa la función REAL (companyService.js, cargada con Vite sin llamar a Firebase) y las
// funciones puras reales de domain/businessOperations.mjs.

const BUSINESS_ID = "negocio-a1";
const OTHER_BUSINESS_ID = "negocio-otro";

// Réplica literal de la comparación que había en AppLayout.jsx antes del arreglo.
const legacyObservedMatchesBusiness = (profile, businessId) => {
  const observedBusinessId = profile?.negocioId || profile?.id || "";
  return Boolean(businessId) && observedBusinessId === businessId;
};

// companyService importa firebaseConfig, que exige un modo explícito. Se fuerza el modo emulator
// (nunca producción): al cargar el módulo no se abre ninguna conexión, solo se evalúa
// normalizeCompanyProfile, que es una función pura.
Object.assign(process.env, {
  VITE_FIREBASE_MODE: "emulator",
  VITE_USE_FIREBASE_CORE_EMULATORS: "true",
  VITE_USE_FIREBASE_FUNCTIONS_EMULATOR: "true",
  VITE_USE_FIREBASE_STORAGE_EMULATOR: "true",
});

const vite = await createServer({appType: "custom", logLevel: "silent", server: {middlewareMode: true}});

try {
  const operations = await vite.ssrLoadModule("/src/domain/businessOperations.mjs");
  const companyService = await vite.ssrLoadModule("/src/services/companyService.js");
  const {
    isObservedProfileOfBusiness,
    shouldRefreshBusinessSessionForVerification,
    normalizeBusinessVerificationState,
    withObservedBusinessId,
  } = operations;
  const {normalizeCompanyProfile} = companyService;

  // Lo que publica subscribeToCompanyProfile: mergeCompanyProfileSources le pasa negocioId a
  // normalizeCompanyProfile (companyService.js), que lo descarta.
  const observedFromListener = normalizeCompanyProfile({
    negocioId: BUSINESS_ID,
    nombreComercial: "Bagner",
    verificacionEmpresa: {estado: "VERIFICADA"},
  });
  assert.equal("negocioId" in observedFromListener, false, "normalizeCompanyProfile no devuelve negocioId");
  assert.equal("id" in observedFromListener, false, "normalizeCompanyProfile no devuelve id");
  assert.equal(observedFromListener.verificacionEmpresa.estado, "VERIFICADA");

  // --- Antes del arreglo: el perfil en vivo nunca coincide con el negocio activo ---
  assert.equal(
    legacyObservedMatchesBusiness(observedFromListener, BUSINESS_ID),
    false,
    "defecto reproducido: perfil en vivo sin id → '' !== businessId → el efecto retorna"
  );
  assert.equal(
    isObservedProfileOfBusiness(observedFromListener, BUSINESS_ID),
    false,
    "sin rótulo, la comparación nueva tampoco acepta el perfil crudo (no hay atajo)"
  );
  console.log("OK: defecto reproducido — el perfil que entrega el listener no lleva negocioId");

  // --- Con el arreglo del hook: el perfil publicado lleva el negocio observado ---
  const published = withObservedBusinessId(observedFromListener, BUSINESS_ID);
  assert.equal(published.negocioId, BUSINESS_ID);
  assert.equal(published.verificacionEmpresa.estado, "VERIFICADA", "el resto del perfil queda intacto");
  assert.equal(observedFromListener.negocioId, undefined, "no muta el perfil original");
  assert.equal(isObservedProfileOfBusiness(published, BUSINESS_ID), true, "el perfil rotulado es del negocio activo");

  // La sesión cacheada decía PENDIENTE y el documento en vivo ya dice VERIFICADA → revalidar.
  const sessionState = normalizeBusinessVerificationState("PENDIENTE");
  const observedState = normalizeBusinessVerificationState(published.verificacionEmpresa.estado);
  assert.equal(
    isObservedProfileOfBusiness(published, BUSINESS_ID) &&
      shouldRefreshBusinessSessionForVerification(sessionState, observedState),
    true,
    "la decisión completa de AppLayout (mismo negocio + estado distinto) dispara el refresco"
  );
  for (const [from, to] of [["NO_VERIFICADA", "PENDIENTE"], ["PENDIENTE", "VERIFICADA"], ["PENDIENTE", "RECHAZADA"]]) {
    const next = withObservedBusinessId(normalizeCompanyProfile({verificacionEmpresa: {estado: to}}), BUSINESS_ID);
    assert.equal(
      isObservedProfileOfBusiness(next, BUSINESS_ID) &&
        shouldRefreshBusinessSessionForVerification(from, next.verificacionEmpresa.estado),
      true,
      `${from} → ${to} dispara el refresco`
    );
  }
  // Sin cambio de estado no hay refresco (no hay bucle).
  assert.equal(shouldRefreshBusinessSessionForVerification("VERIFICADA", published.verificacionEmpresa.estado), false);
  console.log("OK: arreglo — el perfil rotulado coincide con el negocio y las transiciones disparan el refresco");

  // --- Sin acceso cruzado entre empresas ni con negocio vacío ---
  assert.equal(isObservedProfileOfBusiness(published, OTHER_BUSINESS_ID), false, "un perfil de otro negocio no dispara el refresco");
  assert.equal(isObservedProfileOfBusiness(published, ""), false, "sin negocio activo no se compara");
  assert.equal(isObservedProfileOfBusiness(null, BUSINESS_ID), false);
  assert.equal(isObservedProfileOfBusiness(undefined, BUSINESS_ID), false);
  assert.equal(isObservedProfileOfBusiness({id: BUSINESS_ID}, BUSINESS_ID), true, "el perfil inicial (objeto de sesión) sigue coincidiendo por id");
  assert.equal(isObservedProfileOfBusiness({id: OTHER_BUSINESS_ID}, BUSINESS_ID), false);
  assert.deepEqual(withObservedBusinessId(null, BUSINESS_ID), {negocioId: BUSINESS_ID});
  console.log("OK: sin acceso cruzado — otro negocio, negocio vacío y perfiles nulos no coinciden");

  // --- Cableado en el código fuente ---
  const [hook, layout, companyConfig, companyServiceSource] = await Promise.all([
    readFile(new URL("../src/hooks/useBusinessCompletionStatus.js", import.meta.url), "utf8"),
    readFile(new URL("../src/layout/AppLayout.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/company/CompanyConfig.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/companyService.js", import.meta.url), "utf8"),
  ]);
  assert.match(hook, /setProfile\(withObservedBusinessId\(nextProfile, businessId\)\)/, "el hook publica el perfil con negocioId");
  assert.match(layout, /isObservedProfileOfBusiness\(observedBusinessProfile, businessId\)/, "AppLayout usa la comparación probada");
  assert.doesNotMatch(layout, /observedBusinessProfile\?\.negocioId \|\| observedBusinessProfile\?\.id/, "AppLayout ya no compara a mano");
  assert.match(layout, /shouldRefreshBusinessSessionForVerification\(sessionState, observedState\)/, "se conserva la decisión por estado");
  assert.match(layout, /Promise\.resolve\(onBusinessCreated\(\)\)/, "se conserva el refresco de la sesión");
  assert.match(layout, /verificationToastTitle: "Empresa verificada"/, "se conserva el aviso y la ruta por defecto (SPEC 014)");
  assert.match(companyServiceSource, /export function normalizeCompanyProfile/, "el normalizador sigue sin cambios de contrato");
  assert.doesNotMatch(
    companyServiceSource.slice(companyServiceSource.indexOf("export function normalizeCompanyProfile"), companyServiceSource.indexOf("export function normalizeTaxSettings")),
    /negocioId/,
    "el arreglo vive en el hook: normalizeCompanyProfile (y getCompanyProfile) no cambian"
  );
  // Las secciones de Empresa vuelven a leer el perfil cuando cambia la verificación, sin remontarse.
  assert.match(companyConfig, /const verificationKey = `\$\{activationStatus\}:/, "clave derivada del estado en vivo y de la sesión");
  assert.match(companyConfig, /verificationKey=\{verificationKey\}/, "se entrega a las secciones");
  assert.match(companyConfig, /VERIFICATION_DRIVEN_FIELDS/, "solo se refrescan los campos que decide la verificación");
  assert.equal((companyConfig.match(/verificationKeyRef\.current === verificationKey/g) || []).length, 2, "Información y Verificación se refrescan");
  assert.doesNotMatch(companyConfig, /key=\{verificationKey\}/, "no se remonta: se conservan ediciones y el mensaje de solicitud enviada");
  console.log("OK: cableado — hook, AppLayout y secciones de Empresa");
} finally {
  await vite.close();
}
// Firebase Auth deja un temporizador abierto al cargar companyService; la prueba ya terminó.
process.exit(0);
