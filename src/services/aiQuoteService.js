import { httpsCallable } from "firebase/functions";
import { assertCloudFunctionAllowed } from "../config/firebaseEnvironment.mjs";
import { getFirebaseFunctions } from "../firebase/firebaseConfig";
import { normalizeAiRateLimitStatus } from "./aiRateLimitService";

const MAX_DESCRIPTION_LENGTH = 1200;
const FUNCTIONS_REGION = "us-central1";

function summarizeInventoryItem(valuation) {
  return {
    id: valuation?.itemId || "",
    nombre: valuation?.nombre || "",
    tipoItem: valuation?.tipoItem || "",
    categoria: valuation?.categoria || "",
    unidad: valuation?.unidad || "",
  };
}

export async function suggestQuoteItems({ businessId, description, valuations, assistantMode }) {
  assertCloudFunctionAllowed("las sugerencias de cotización");
  const cleanDescription = String(description || "").trim();
  const requestedMode = ["local", "gemini"].includes(assistantMode)
    ? assistantMode
    : "auto";

  if (!cleanDescription) {
    throw new Error("Describe brevemente el trabajo que necesitas cotizar.");
  }

  if (cleanDescription.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error("La descripción debe tener 1200 caracteres o menos.");
  }

  const inventoryItems = Array.isArray(valuations)
    ? valuations.map(summarizeInventoryItem).filter((item) => item.id && item.nombre)
    : [];

  const functions = getFirebaseFunctions(FUNCTIONS_REGION);
  const callable = httpsCallable(functions, "suggestQuoteItems");
  const response = await callable({
    businessId,
    description: cleanDescription,
    inventoryItems,
    assistantMode: requestedMode,
  });

  return {
    suggestions: Array.isArray(response.data?.suggestions)
      ? response.data.suggestions
      : [],
    source: response.data?.source || "local",
    mode: response.data?.mode || requestedMode,
    model: response.data?.model || "",
    warning: response.data?.warning || "",
    aiRateLimit: response.data?.aiRateLimit
      ? normalizeAiRateLimitStatus(response.data.aiRateLimit)
      : null,
  };
}
