import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import {normalizeVeterinaryMicrochip} from "../src/features/veterinary/domain/patientModel.mjs";

// Run with veterinary writes paused: the collection scan is a migration, not a lock.
export async function migrateVeterinaryMicrochips(db, businessId, {apply = false} = {}) {
  const business = db.collection("negocios").doc(businessId);
  const patients = await business.collection("pacientesVeterinarios").get();
  const groups = new Map();
  const report = [];
  for (const patient of patients.docs) {
    const chip = normalizeVeterinaryMicrochip(patient.get("microchip"));
    if (!chip) continue;
    if (!/^[A-Z0-9]+$/.test(chip) || patient.get("negocioId") !== businessId) {
      report.push({patientId: patient.id, status: "invalid"});
      continue;
    }
    groups.set(chip, [...(groups.get(chip) ?? []), patient]);
  }
  for (const [chip, entries] of groups) {
    if (entries.length > 1) {
      report.push({chip, patientIds: entries.map((entry) => entry.id), status: "duplicate"});
      continue;
    }
    const patient = entries[0];
    const reservationRef = business.collection("microchipsVeterinarios").doc(chip);
    const status = await db.runTransaction(async (tx) => {
      const current = await tx.get(patient.ref);
      const reservation = await tx.get(reservationRef);
      if (!current.exists || current.get("microchip") !== patient.get("microchip")) return "changed-retry";
      if (reservation.exists && reservation.get("pacienteId") !== patient.id) return "reservation-conflict";
      if (reservation.exists && current.get("microchip") === chip) return "unchanged";
      if (!apply) return "would-normalize-and-reserve";
      if (!reservation.exists) tx.create(reservationRef, {pacienteId: patient.id});
      if (current.get("microchip") !== chip) tx.update(patient.ref, {microchip: chip});
      return "applied";
    });
    report.push({chip, patientId: patient.id, status});
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const businessId = args.find((arg) => arg.startsWith("--business="))?.slice(11);
  if (!businessId || !/^[A-Za-z0-9_-]+$/.test(businessId) || args.some((arg) => arg !== "--apply" && !arg.startsWith("--business="))) {
    throw new Error("Uso: node scripts/migrate-veterinary-microchips.mjs --business=ID [--apply]");
  }
  if (!process.env.GCLOUD_PROJECT?.startsWith("demo-") || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "")) {
    throw new Error("Solo emulador local con GCLOUD_PROJECT demo-; no autorizado para producción.");
  }
  const require = createRequire(new URL("../functions/package.json", import.meta.url));
  const admin = require("firebase-admin");
  const app = admin.initializeApp({projectId: process.env.GCLOUD_PROJECT});
  try {
    console.log(JSON.stringify(await migrateVeterinaryMicrochips(admin.firestore(), businessId, {apply: args.includes("--apply")}), null, 2));
  } finally {
    await app.delete();
  }
}
