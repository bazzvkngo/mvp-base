import {spawnSync} from "node:child_process";
for (let run = 1; run <= 20; run++) {
  for (const smoke of ["patient", "appointment"]) {
    const result = spawnSync(process.execPath, [`scripts/veterinary-${smoke}-persistence-smoke.mjs`], {stdio: "inherit", env: process.env});
    console.log(`CONCURRENCY_RUN ${run}/20 ${smoke} exit=${result.status}`);
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
console.log("CONCURRENCY_20_OF_20_PATIENTS_AND_APPOINTMENTS_OK");
