// Hosts de los emuladores para los scripts integrados, SIN puertos por defecto (mismo arnés que
// work-task-document-annul-integrated-local.mjs). Existe para que una configuración incompleta nunca llegue a otro
// emulador abierto en los puertos de siempre (por ejemplo, el de QA en 8080/9099/5001/9199):
// - Firestore, Auth y Storage salen de las variables que fija `firebase emulators:exec`
//   (FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST y FIREBASE_STORAGE_EMULATOR_HOST).
// - `emulators:exec` no exporta la de Functions: su host y puerto se piden al hub de ese mismo emulador
//   (FIREBASE_EMULATOR_HUB).
// Si falta cualquiera de las que se piden, lanza un error antes de crear ningún cliente o hacer ninguna llamada.

const requiredEnv = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Falta ${name}: ejecuta este script con "firebase emulators:exec" (no usa puertos por defecto).`);
  return value;
};

const splitHost = (value, label) => {
  const [host, port] = String(value).replace(/^https?:\/\//, "").split(":");
  if (!host || !Number.isInteger(Number(port)) || Number(port) <= 0) throw new Error(`${label} inválido: «${value}».`);
  return {host, port: Number(port)};
};

export async function resolveEmulatorHosts({projectId, functions = false, storage = false} = {}) {
  if (projectId) process.env.GCLOUD_PROJECT ||= projectId;
  const hosts = {
    FIRESTORE: splitHost(requiredEnv("FIRESTORE_EMULATOR_HOST"), "FIRESTORE_EMULATOR_HOST"),
    AUTH: splitHost(requiredEnv("FIREBASE_AUTH_EMULATOR_HOST"), "FIREBASE_AUTH_EMULATOR_HOST"),
  };
  if (storage) hosts.STORAGE = splitHost(requiredEnv("FIREBASE_STORAGE_EMULATOR_HOST"), "FIREBASE_STORAGE_EMULATOR_HOST");
  if (functions) {
    const hubInfo = await (await fetch(`http://${requiredEnv("FIREBASE_EMULATOR_HUB")}/emulators`)).json();
    if (!hubInfo?.functions?.port) throw new Error("El hub del emulador no informa un emulador de Functions: usa --only auth,firestore,functions.");
    hosts.FUNCTIONS = splitHost(`${hubInfo.functions.host}:${hubInfo.functions.port}`, "Functions del hub");
  }
  const text = Object.entries(hosts).map(([name, {host, port}]) => `${name.toLowerCase()} ${host}:${port}`).join(", ");
  console.log(`Emuladores de esta corrida: ${text}`);
  return hosts;
}
