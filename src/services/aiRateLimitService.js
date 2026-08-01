import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "../firebase/firebaseConfig";

const FUNCTIONS_REGION = "us-central1";

export function normalizeAiRateLimitStatus(value, model = "") {
  const source = value && typeof value === "object" ? value : {};
  return {
    allowed: source.allowed !== false,
    reason: String(source.reason || "available"),
    model: String(source.model || model),
    retryAt: source.retryAt ? String(source.retryAt) : null,
    retryAfterSeconds: Math.max(Number(source.retryAfterSeconds || 0), 0),
    nextResetAt: source.nextResetAt ? String(source.nextResetAt) : null,
    message: String(source.message || ""),
  };
}

export function getAiRateLimitErrorDetails(error, model = "") {
  const details =
    error?.details && typeof error.details === "object"
      ? error.details
      : error?.customData?.details && typeof error.customData.details === "object"
        ? error.customData.details
        : null;
  if (!details?.reason) return null;
  return normalizeAiRateLimitStatus(
    {
      ...details,
      allowed: false,
      message: details.message || error?.message || "",
    },
    model
  );
}

export async function getAiRateLimitStatus(model) {
  const functions = getFunctions(app, FUNCTIONS_REGION);
  const callable = httpsCallable(functions, "getAiRateLimitStatus");
  const response = await callable({ model });
  return normalizeAiRateLimitStatus(response.data, model);
}
