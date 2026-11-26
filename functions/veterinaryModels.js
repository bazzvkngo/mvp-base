"use strict";

const {existsSync} = require("node:fs");
const {join} = require("node:path");
const {pathToFileURL} = require("node:url");

function importVeterinaryModel(name) {
  const source = join(__dirname, "../src/features/veterinary/domain", name + ".mjs");
  const file = existsSync(source) ? source : join(__dirname, "veterinary-models", name + ".mjs");
  return import(pathToFileURL(file).href);
}

module.exports = {importVeterinaryModel};
