import {normalizeVeterinaryMicrochip} from "../domain/patientModel.mjs";

export function parseVeterinaryMicrochipScan(reading) {
  const code = normalizeVeterinaryMicrochip(reading);
  return /^[0-9]{15}$/.test(code) ? code : "";
}
