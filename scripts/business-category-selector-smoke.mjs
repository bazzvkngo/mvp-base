import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import catalog from "../functions/businessCatalog.json" with { type: "json" };
import {
  filterBusinessCategories,
  normalizeCategorySearch,
} from "../src/domain/businessCategorySearch.mjs";

const [picker, quickFields, company, dialog] = await Promise.all([
  readFile(
    new URL("../src/components/BusinessCategoryPicker.jsx", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL("../src/components/QuickBusinessFields.jsx", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL("../src/features/company/CompanyConfig.jsx", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL("../src/components/ui/ResponsiveDialog.jsx", import.meta.url),
    "utf8"
  ),
]);

assert.equal(normalizeCategorySearch("  TECNOLOGÍA  "), "tecnologia");
assert.equal(normalizeCategorySearch("Cafetería"), "cafeteria");

const technologyResults = filterBusinessCategories(
  catalog.businessCategories,
  "PROGRAMACIÓN"
);
assert.ok(technologyResults.some(({ code }) => code === "TECNOLOGIA_SOFTWARE"));
const computingResults = filterBusinessCategories(
  catalog.businessCategories,
  "computacion"
);
assert.ok(computingResults.some(({ code }) => code === "ELECTRONICA_INFORMATICA"));
assert.equal(
  filterBusinessCategories(catalog.businessCategories, "venta al detalle").some(
    ({ code }) => code === "COMERCIO_MINORISTA"
  ),
  false
);

assert.match(quickFields, /<BusinessCategoryPicker/);
assert.match(company, /<BusinessCategoryPicker/);
assert.doesNotMatch(quickFields, /BUSINESS_CATEGORIES\.filter/);
assert.doesNotMatch(company, /BUSINESS_CATEGORIES\.filter/);
assert.match(picker, /title="Selecciona una categoría"/);
assert.match(picker, /placeholder="Buscar categoría"/);
assert.match(picker, /role="radiogroup"/);
assert.match(picker, /role="radio"/);
assert.match(picker, /draftCode/);
assert.match(picker, /confirmSelection/);
assert.match(picker, /draftCode === "OTRO"/);
assert.match(picker, /Describe la categoría de tu negocio/);
assert.match(picker, /ArrowDown/);
assert.match(dialog, /event\.key === "Escape"/);
assert.match(dialog, /openDialogStack\.at\(-1\)/);

console.log(
  "BUSINESS_CATEGORY_SELECTOR_SMOKE_OK",
  JSON.stringify({
    categories: catalog.businessCategories.length,
    sectors: catalog.businessCategorySectors.length,
  })
);
