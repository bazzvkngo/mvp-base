const {copyFileSync, mkdirSync, readdirSync, rmSync} = require("node:fs");
const {join, resolve} = require("node:path");
const root = resolve(__dirname, "..");
const source = join(root, "src/features/veterinary/domain");
const destination = join(root, "functions/veterinary-models");
rmSync(destination, {recursive: true, force: true});
mkdirSync(destination, {recursive: true});
for (const name of readdirSync(source).filter((file) => file.endsWith(".mjs"))) {
  copyFileSync(join(source, name), join(destination, name));
}
