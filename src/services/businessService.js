import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "../firebase/firebaseConfig";

const functions = getFirebaseFunctions("us-central1");

export async function getBusinessSession() {
  const callable = httpsCallable(functions, "getBusinessSession");
  const response = await callable({});
  return response.data;
}

export async function createFirstBusiness(payload, requestId) {
  const callable = httpsCallable(functions, "createFirstBusiness");
  const response = await callable({ ...payload, requestId });
  return response.data;
}

export async function createAdditionalBusiness(payload, requestId) {
  const callable = httpsCallable(functions, "createAdditionalBusiness");
  const response = await callable({ ...payload, requestId });
  return response.data;
}

export async function setActiveBusiness(businessId) {
  const callable = httpsCallable(functions, "setActiveBusiness");
  const response = await callable({ businessId });
  return response.data;
}

export function getBusinessCreationRequestId(uid) {
  const storageKey = `valoracloud.firstBusinessRequest.${uid}`;
  const existing = window.sessionStorage.getItem(storageKey);
  if (existing) return existing;

  const generated = `business_${crypto.randomUUID().replaceAll("-", "")}`;
  window.sessionStorage.setItem(storageKey, generated);
  return generated;
}

export function clearBusinessCreationRequestId(uid) {
  window.sessionStorage.removeItem(`valoracloud.firstBusinessRequest.${uid}`);
}

export function getAdditionalBusinessCreationRequestId(uid) {
  const storageKey = `valoracloud.additionalBusinessRequest.${uid}`;
  const existing = window.sessionStorage.getItem(storageKey);
  if (existing) return existing;

  const generated = `additional_${crypto.randomUUID().replaceAll("-", "")}`;
  window.sessionStorage.setItem(storageKey, generated);
  return generated;
}

export function clearAdditionalBusinessCreationRequestId(uid) {
  window.sessionStorage.removeItem(
    `valoracloud.additionalBusinessRequest.${uid}`
  );
}
