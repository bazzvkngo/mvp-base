import { httpsCallable } from "firebase/functions";
import { assertCloudFunctionAllowed } from "../config/firebaseEnvironment.mjs";
import { getFirebaseFunctions } from "../firebase/firebaseConfig";

const searchCallable = httpsCallable(
  getFirebaseFunctions("us-central1"),
  "searchInventoryMarketReferences"
);

function readableSearchError(error) {
  const message = String(error?.message || "").replace(/^Firebase:\s*/i, "").trim();
  if (message && !/internal|unknown/i.test(message)) return message;
  if (error?.code === "functions/resource-exhausted") {
    return "Se alcanzó el límite temporal de búsquedas. Intenta más tarde.";
  }
  if (error?.code === "functions/permission-denied") {
    return "Tu perfil no tiene acceso para buscar referencias de este negocio.";
  }
  return "No fue posible consultar el mercado en este momento.";
}

export async function searchInventoryMarketReferences(businessId, itemId, { forceRefresh = false } = {}) {
  assertCloudFunctionAllowed("buscar referencias de mercado");
  try {
    const response = await searchCallable({ businessId, itemId, forceRefresh });
    return response.data;
  } catch (error) {
    const wrapped = new Error(readableSearchError(error));
    wrapped.code = error?.code;
    throw wrapped;
  }
}
