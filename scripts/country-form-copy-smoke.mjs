import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { getClientFieldErrors } from "../src/domain/clientModel.mjs";
import { buildPurchaseOrderPdfDocument } from "../src/domain/purchaseOrderDocument.mjs";
import { buildQuotePdfDocument } from "../src/domain/quoteDocument.mjs";
import { getCompanyDocumentSuggestions } from "../src/domain/companyDocumentSuggestions.mjs";
import { FORM_HINT_KEYS, GENERIC_FIELD_HINTS, getClientFiscalCopy, getClientFiscalListLabel, getCountryFormCopy, getFiscalIdentifierHint } from "../src/domain/countryFormCopy.mjs";
import { resolveDocumentTaxRate } from "../src/domain/localization.mjs";
import { normalizeQuickBusinessPayload } from "../src/domain/businessQuickPayload.mjs";
import { getFiscalIdentifierLabel, isValidFiscalIdentifier } from "../src/domain/fiscalIdentifier.mjs";

// Textos y ejemplos por país (Bolivia piloto): perfil de empresa, verificación y clientes. Salen de
// countryFormCopy.mjs, sin "si es Bolivia" en los componentes. Chile y el resto de los países no cambian.
const require = createRequire(import.meta.url);

// --- Chile: exactamente lo que se mostraba antes ---
const cl = getCountryFormCopy("CL");
assert.equal(cl.businessActivityLabel, "Giro");
assert.equal(cl.companyPhoneExample, "+56 9 1234 5678");
assert.equal(cl.companyEmailExample, "contacto@empresa.cl");
assert.equal(cl.companyWebsiteExample, "https://www.empresa.cl");
assert.equal(cl.companyPostalCodeExample, "Ej.: 1100000");
// El texto guía de cliente y proveedor es genérico en todos los países (se fija campo por campo al final).
assert.equal(cl.clientPhoneExample, GENERIC_FIELD_HINTS.phone);
assert.equal(cl.clientCompanyEmailExample, GENERIC_FIELD_HINTS.email);
assert.equal(cl.clientPersonEmailExample, GENERIC_FIELD_HINTS.email);
assert.equal(cl.vehiclePlateExample, "Ej.: ABCD12");
assert.equal(cl.workOrderSearchExample, "Ej.: OT-000001 o ABCD12");
for (const key of ["declaredFiscalIdExample", "requesterEmailExample", "requesterPhoneExample", "personFiscalLabel", "personFiscalExample"]) {
  assert.equal(cl[key], null, `Chile sin ${key}`);
}
assert.deepEqual(getClientFiscalCopy("CL", "persona"), { label: "RUT", placeholder: "Ej.: 12.345.678-5" });
assert.deepEqual(getClientFiscalCopy("CL", "empresa"), { label: "RUT", placeholder: "Ej.: 12.345.678-5" });

// --- Otros países: lo de siempre en el perfil de empresa; el texto guía de cliente y proveedor es el genérico ---
for (const code of ["MX", "PE", "PY", "OTHER", "ZZ"]) {
  const copy = getCountryFormCopy(code);
  assert.equal(copy.businessActivityLabel, "Giro", code);
  assert.equal(copy.clientPhoneExample, GENERIC_FIELD_HINTS.phone, code);
  assert.equal(copy.companyEmailExample, "contacto@empresa.cl", code);
  assert.equal(copy.companyPostalCodeExample, "Ej.: 1100000", code);
  assert.equal(copy.personFiscalLabel, null, code);
}

// --- Bolivia ---
const bo = getCountryFormCopy("BO");
assert.equal(bo.businessActivityLabel, "Actividad económica");
assert.equal(bo.companyPhoneExample, "+591 7xxxxxxx");
assert.equal(bo.companyEmailExample, "contacto@empresa.com.bo");
assert.equal(bo.companyWebsiteExample, "https://www.empresa.com.bo");
assert.equal(bo.companyPostalCodeExample, null, "sin ejemplo de código postal chileno");
assert.equal(bo.clientPhoneExample, GENERIC_FIELD_HINTS.phone);
assert.equal(bo.clientCompanyEmailExample, GENERIC_FIELD_HINTS.email);
assert.equal(bo.clientPersonEmailExample, GENERIC_FIELD_HINTS.email);
assert.equal(bo.requesterPhoneExample, "+591 7xxxxxxx");
assert.equal(bo.requesterEmailExample, "nombre@empresa.com.bo");
assert.equal(bo.vehiclePlateExample, "Ej.: 1234ABC");
assert.equal(bo.workOrderSearchExample, "Ej.: OT-000001 o 1234ABC");
assert.ok(bo.declaredFiscalIdExample);
for (const [key, value] of Object.entries(bo)) {
  if (typeof value === "string") assert.doesNotMatch(value, /\.cl\b|\+56|1100000/, `Bolivia sin ejemplos chilenos: ${key}`);
}
assert.ok(Object.isFrozen(bo));
const py = getCountryFormCopy("PY");
assert.equal(py.vehiclePlateExample, "Ej.: ABC123 o ABCD123");
assert.equal(py.workOrderSearchExample, "Ej.: OT-000001 o ABC123");
for (const copy of [cl, bo, py]) {
  assert.equal(copy.vehicleBrandExample, "Ej.: Toyota");
  assert.equal(copy.vehicleModelExample, "Ej.: Hilux");
  assert.equal(copy.vehicleColorExample, "Ej.: Blanco");
  assert.equal(copy.vehicleVinExample, "Ej.: 1HGCM82633A004352");
}
// Cliente: Persona = "CI o NIT"; Empresa = NIT.
assert.deepEqual(getClientFiscalCopy("BO", "persona"), { label: "CI o NIT", placeholder: "Ej.: 1234567" });
assert.deepEqual(getClientFiscalCopy("BO", "empresa"), { label: "NIT", placeholder: "Ej.: 1234567" });
assert.equal(getClientFiscalCopy("BO", "PERSONA").label, "CI o NIT");

// --- Una CI numérica pasa la validación (cliente y servidor comparten la regla de Bolivia) ---
const serverFiscal = require("../functions/fiscalIdentifier.js");
for (const ci of ["1234567", "12345678", "1.234.567", "1 234 567", "9876543210"]) {
  assert.equal(isValidFiscalIdentifier("BO", ci), true, `CI ${ci} en el cliente`);
  assert.equal(serverFiscal.isValidFiscalIdentifier("BO", ci), true, `CI ${ci} en el servidor`);
}
assert.equal(isValidFiscalIdentifier("BO", "123"), false, "demasiado corta");
const clientBase = { nombreRazonSocial: "Ana Rojas", email: "", telefono: "", direccion: "", notas: "" };
assert.deepEqual(
  Object.keys(getClientFieldErrors({ ...clientBase, tipoCliente: "persona", rut: "1234567" }, "BO")),
  [],
  "una CI numérica no da error en un cliente Persona de Bolivia"
);
assert.equal(
  getClientFieldErrors({ ...clientBase, tipoCliente: "persona", rut: "" }, "BO").rut,
  "Ingresa el CI o NIT del cliente."
);
assert.equal(
  getClientFieldErrors({ ...clientBase, tipoCliente: "persona", rut: "12" }, "BO").rut,
  "Ingresa un CI o NIT válido."
);
assert.equal(
  getClientFieldErrors({ ...clientBase, tipoCliente: "empresa", rut: "12" }, "BO").rut,
  "Ingresa un NIT válido.",
  "Empresa se mantiene en NIT"
);
assert.equal(getClientFieldErrors({ ...clientBase, tipoCliente: "persona", rut: "1-9" }, "CL").rut, "Ingresa un RUT válido.", "Chile sigue con RUT");

// --- "Giro": solo cambia la etiqueta visible (la sugerencia de documentos usa la del país) ---
const suggestionLabel = (countryCode) =>
  getCompanyDocumentSuggestions({}, { canEdit: true, countryCode }).find((item) => item.id === "giro").label;
assert.equal(suggestionLabel("BO"), "Actividad económica");
assert.equal(suggestionLabel("CL"), "Giro");
assert.equal(getCompanyDocumentSuggestions({}, { canEdit: true }).find((item) => item.id === "giro").label, "Giro", "sin país: como antes");

// --- Render real de la región del cliente/proveedor (Bolivia: lista; Chile y otros: sin cambios) ---
const vite = await createServer({ appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
let ContactTerritoryFields, QuotePrintView, PurchaseOrderPrintView, PurchasePrintView;
try {
  ContactTerritoryFields = (await vite.ssrLoadModule("/src/components/contacts/ContactTerritoryFields.jsx")).default;
  QuotePrintView = (await vite.ssrLoadModule("/src/features/quotes/QuotePrintView.jsx")).default;
  PurchaseOrderPrintView = (await vite.ssrLoadModule("/src/features/purchaseOrders/PurchaseOrderPrintView.jsx")).default;
  PurchasePrintView = (await vite.ssrLoadModule("/src/features/purchases/PurchasePrintView.jsx")).default;
} finally {
  await vite.close();
}
const Field = ({ children, label }) => React.createElement("div", { "data-field": label }, children);
const render = (countryCode, values = {}) =>
  renderToStaticMarkup(
    React.createElement(ContactTerritoryFields, {
      Field,
      countryCode,
      errors: {},
      onChange() {},
      saving: false,
      setFieldRef() {},
      values: { regionCodigo: "", regionNombre: "", comunaCodigo: "", comunaNombre: "", ...values },
    })
  );
const bolivia = render("BO", { regionCodigo: "SC", regionNombre: "Santa Cruz" });
assert.match(bolivia, /data-field="Departamento"><select/);
for (const name of ["La Paz", "Cochabamba", "Santa Cruz", "Oruro", "Potosí", "Chuquisaca", "Tarija", "Beni", "Pando"]) {
  assert.ok(bolivia.includes(`>${name}</option>`), name);
}
assert.match(bolivia, /<option value="SC" selected="">Santa Cruz<\/option>/, "el departamento guardado queda elegido");
assert.match(bolivia, /data-field="Municipio"><input/, "el municipio sigue siendo texto libre");
assert.doesNotMatch(bolivia, /Metropolitana|texto anterior/);
// Texto libre anterior que no está en el catálogo: se conserva visible, sin perderlo.
const legacy = render("BO", { regionCodigo: "", regionNombre: "Santa Cruz de la Sierra" });
assert.match(legacy, /<option value="__texto_anterior__" selected="">Santa Cruz de la Sierra \(texto anterior\)<\/option>/);
// País con catálogo sin región elegida: "Sin especificar".
assert.match(render("BO"), /<option value="" selected="">Sin especificar<\/option>/);
// Chile: regiones y comunas como siempre. Otros países: texto libre como siempre.
const chile = render("CL", { regionCodigo: "13", regionNombre: "Metropolitana de Santiago" });
assert.match(chile, /data-field="Región"><select/);
assert.match(chile, /data-field="Comuna"><select/);
assert.ok(chile.includes(">Metropolitana de Santiago</option>"));
const mexico = render("MX");
assert.match(mexico, /data-field="Estado"><input/);
assert.match(mexico, /data-field="Municipio"><input/);
assert.doesNotMatch(mexico, /<select/);

// --- "Giro" en documentos: PDF y vistas de impresión de cotización, orden de compra y compra ---
// Solo cambia la etiqueta visible según el país del documento; el dato (`giro`) es el mismo.
const documentCompany = {
  nombreComercial: "Andes Servicios",
  razonSocial: "Andes Servicios SRL",
  identificadorFiscalTipo: "NIT",
  identificadorFiscalValor: "1023456789",
  giro: "Servicios técnicos",
};
// Las líneas de texto del PDF salen del flujo sin comprimir de jsPDF: cada texto va como `(texto) Tj`.
// Las tildes salen escapadas en octal, por eso se normalizan antes de comparar.
const pdfLines = (build) => {
  const content = build().doc.output();
  return [...content.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)]
    .map(([, text]) => text.replace(/\\(\d{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8))))
    .filter((line) => /Giro|Actividad econ/.test(line));
};
const quoteFor = (paisCodigo) => ({
  paisCodigo,
  empresaSnapshot: documentCompany,
  cliente: { nombre: "Cliente Prueba" },
  items: [{ descripcion: "Servicio", cantidad: 1, precioUnitario: 1000, tipo: "servicio" }],
});
const orderFor = (paisCodigo) => ({
  paisCodigo,
  empresaSnapshot: documentCompany,
  items: [{ descripcion: "Insumo", cantidad: 1, costoUnitario: 1000 }],
});
assert.deepEqual(pdfLines(() => buildQuotePdfDocument({ quote: quoteFor("BO") })), ["Actividad económica: Servicios técnicos"], "PDF de cotización, Bolivia");
assert.deepEqual(pdfLines(() => buildQuotePdfDocument({ quote: quoteFor("CL") })), ["Giro: Servicios técnicos"], "PDF de cotización, Chile");
assert.deepEqual(pdfLines(() => buildQuotePdfDocument({ quote: quoteFor("PY") })), ["Giro: Servicios técnicos"], "PDF de cotización, otro país");
assert.deepEqual(pdfLines(() => buildQuotePdfDocument({ quote: quoteFor(undefined) })), ["Giro: Servicios técnicos"], "PDF de cotización antigua sin país");
assert.deepEqual(pdfLines(() => buildPurchaseOrderPdfDocument({ order: orderFor("BO") })), ["NIT 1023456789 · Actividad económica: Servicios técnicos"], "PDF de orden de compra, Bolivia");
assert.deepEqual(pdfLines(() => buildPurchaseOrderPdfDocument({ order: orderFor("CL") })), ["NIT 1023456789 · Giro: Servicios técnicos"], "PDF de orden de compra, Chile");
assert.deepEqual(pdfLines(() => buildPurchaseOrderPdfDocument({ order: orderFor(undefined) })), ["NIT 1023456789 · Giro: Servicios técnicos"], "PDF de orden antigua sin país");
const html = (element) => renderToStaticMarkup(element);
const quoteBo = html(React.createElement(QuotePrintView, { quote: quoteFor("BO") }));
const quoteCl = html(React.createElement(QuotePrintView, { quote: quoteFor("CL") }));
assert.match(quoteBo, /<strong>Actividad económica: <\/strong>Servicios técnicos/);
assert.doesNotMatch(quoteBo, /Giro/);
assert.match(quoteCl, /<strong>Giro: <\/strong>Servicios técnicos/);
const orderBo = html(React.createElement(PurchaseOrderPrintView, { order: orderFor("BO") }));
const orderCl = html(React.createElement(PurchaseOrderPrintView, { order: orderFor("CL") }));
assert.match(orderBo, /<strong>Actividad económica: <\/strong>Servicios técnicos/);
assert.doesNotMatch(orderBo, /Giro/);
assert.match(orderCl, /<strong>Giro: <\/strong>Servicios técnicos/);
// Sin país en el documento (histórico) se usa el de la empresa actual.
assert.match(html(React.createElement(PurchaseOrderPrintView, { company: { paisCodigo: "BO" }, order: orderFor(undefined) })), /Actividad económica: /);
const purchaseFor = (paisCodigo) => ({ paisCodigo, empresaSnapshot: documentCompany, items: [], proveedorSnapshot: {} });
const purchaseBo = html(React.createElement(PurchasePrintView, { purchase: purchaseFor("BO") }));
const purchaseCl = html(React.createElement(PurchasePrintView, { purchase: purchaseFor("CL") }));
assert.match(purchaseBo, /<strong>Actividad económica: <\/strong>Servicios técnicos/);
assert.doesNotMatch(purchaseBo, /Giro/);
assert.match(purchaseCl, /<strong>Giro: <\/strong>Servicios técnicos/);

// --- Los componentes toman los textos del helper (sin literales de país) ---
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [clientForm, company, territoryFields] = await Promise.all([
  read("src/features/clients/ClientFormDialog.jsx"),
  read("src/features/company/CompanyConfig.jsx"),
  read("src/components/contacts/ContactTerritoryFields.jsx"),
]);
for (const [name, source] of [["ClientFormDialog", clientForm], ["CompanyConfig", company], ["ContactTerritoryFields", territoryFields]]) {
  assert.doesNotMatch(source.replace(/\/\/.*$/gm, ""), /Bolivia|===?\s*["']BO["']/, `${name}: sin "si es Bolivia" suelto`);
}
assert.ok(clientForm.includes("getClientFiscalCopy(country, values.tipoCliente)"));
assert.ok(clientForm.includes("label={countryCopy.businessActivityLabel}"));
assert.doesNotMatch(clientForm, /contacto@empresa\.cl|nombre@correo\.cl|\+56 9 6123 4587|\+1 202 555 0100/, "ejemplos del cliente salen del helper");
assert.doesNotMatch(company, /placeholder="\+56 9 1234 5678"|placeholder="contacto@empresa\.cl"|placeholder="https:\/\/www\.empresa\.cl"|placeholder="Ej\.: 1100000"/, "ejemplos del perfil salen del helper");
assert.doesNotMatch(company, /label="Giro"/);
assert.ok(company.includes("label={countryCopy.businessActivityLabel}"));
for (const expression of ["countryCopy.declaredFiscalIdExample", "countryCopy.requesterEmailExample", "countryCopy.requesterPhoneExample"]) {
  assert.ok(company.includes(expression), `verificación: ${expression}`);
}
assert.ok(territoryFields.includes("getContactRegionOptions(countryCode)"));

// "Giro": ningún documento, detalle ni formulario de proveedor lo escribe fijo; todos piden la etiqueta al helper.
const giroFiles = [
  "src/domain/quoteDocument.mjs",
  "src/domain/purchaseOrderDocument.mjs",
  "src/features/quotes/QuotePrintView.jsx",
  "src/features/purchaseOrders/PurchaseOrderPrintView.jsx",
  "src/features/purchases/PurchasePrintView.jsx",
  "src/features/purchases/PurchaseDetailView.jsx",
  "src/pages/NewPurchasePage.jsx",
  "src/features/providers/ProviderFormDialog.jsx",
];
for (const path of giroFiles) {
  const source = (await read(path)).replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /label="Giro"|["'`]Giro[:"'`]|\bGiro:/, `${path}: sin "Giro" fijo`);
  assert.doesNotMatch(source, /Bolivia|===?\s*["']BO["']/, `${path}: sin "si es Bolivia" suelto`);
  assert.ok(source.includes("getCountryFormCopy(") && source.includes("businessActivityLabel"), `${path}: usa el helper`);
}
// El campo interno no cambia: se sigue leyendo `giro` en documentos, detalles y proveedor.
for (const [path, needle] of [
  ["src/features/purchases/PurchaseDetailView.jsx", "provider.giro"],
  ["src/pages/NewPurchasePage.jsx", "provider.giro"],
  ["src/features/providers/ProviderFormDialog.jsx", 'field="giro"'],
  ["src/domain/quoteDocument.mjs", "company.giro"],
  ["src/domain/purchaseOrderDocument.mjs", "company.giro"],
]) {
  assert.ok((await read(path)).includes(needle), `${path}: conserva ${needle}`);
}


// =====================================================================================================
// Entrega E: pulido final de Bolivia. Chile exactamente como hoy; solo cambian los países con texto propio.
// =====================================================================================================

// --- 1 y 2. Identificador fiscal en listas, buscadores y avisos de clientes ---
assert.equal(getClientFiscalListLabel("CL"), "RUT", "Chile: RUT");
assert.equal(getClientFiscalListLabel("BO"), "CI o NIT", "Bolivia: Persona con CI o NIT");
assert.equal(getClientFiscalListLabel("MX"), "RFC", "otros países: la etiqueta de siempre");
assert.equal(getClientFiscalListLabel("CL"), getClientFiscalCopy("CL", "empresa").label);
assert.equal(getFiscalIdentifierLabel("CL"), "RUT");
assert.equal(getFiscalIdentifierLabel("BO"), "NIT");

// El país del negocio activo llega a los componentes por el contexto de formato (sin provider: Chile).
const vite2 = await createServer({ appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
try {
  const formatHook = await vite2.ssrLoadModule("/src/hooks/useBusinessFormat.js");
  assert.equal(formatHook.resolveBusinessFormat(undefined).countryCode, "CL", "sin negocio: Chile");
  assert.equal(formatHook.resolveBusinessFormat({}).countryCode, "CL", "negocio sin país: Chile");
  assert.equal(formatHook.resolveBusinessFormat({ paisCodigo: "CL" }).countryCode, "CL");
  assert.equal(formatHook.resolveBusinessFormat({ paisCodigo: "bo" }).countryCode, "BO");
  // La moneda y el locale no cambian con el país nuevo del contexto.
  const { countryCode: chileCountry, ...chileFormat } = formatHook.resolveBusinessFormat({ paisCodigo: "CL", monedaCodigo: "CLP", locale: "es-CL" });
  assert.equal(chileCountry, "CL");
  assert.deepEqual(chileFormat, { currency: "CLP", locale: "es-CL", amountDecimals: 0 });

  const { MemoryRouter } = await import("react-router-dom");
  const SaleClientSelector = (await vite2.ssrLoadModule("/src/features/sales/SaleClientSelector.jsx")).default;
  const clients = [{ clienteId: "c1", estado: "activo", nombreRazonSocial: "Ana Rojas", rut: "1234567" }];
  const renderSelector = (business) => {
    const selector = React.createElement(
      MemoryRouter,
      null,
      React.createElement(SaleClientSelector, { clients, inline: true, onChange() {}, value: "" })
    );
    return renderToStaticMarkup(
      business === undefined ? selector : React.createElement(formatHook.BusinessFormatProvider, { business }, selector)
    );
  };
  const hint = (markup) => markup.replace(/<!-- -->/g, "").match(/escribe un nombre o ([^<]*) para buscar/)?.[1];
  assert.equal(hint(renderSelector(undefined)), "RUT", "venta, sin provider: como hoy");
  assert.equal(hint(renderSelector({ paisCodigo: "CL", monedaCodigo: "CLP" })), "RUT", "venta, Chile: como hoy");
  assert.equal(hint(renderSelector({ paisCodigo: "BO", monedaCodigo: "BOB" })), "CI o NIT", "venta, Bolivia");
} finally {
  await vite2.close();
}

// Ninguna pantalla de la lista conserva "RUT" escrito fijo (ni en etiquetas, ni en buscadores, ni en "Sin RUT").
const rutFreeFiles = [
  "src/features/clients/ClientsManager.jsx",
  "src/features/clients/ClientSelector.jsx",
  "src/features/sales/SaleClientSelector.jsx",
  "src/pages/SalesPage.jsx",
  "src/pages/PurchasesPage.jsx",
  "src/pages/PurchaseOrdersPage.jsx",
  "src/features/inventory/InventoryManager.jsx",
  "src/features/purchaseOrders/PurchaseOrderDetailView.jsx",
  "src/features/purchases/PurchaseDetailView.jsx",
  "src/pages/NewPurchasePage.jsx",
];
for (const path of rutFreeFiles) {
  const source = (await read(path)).replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /\bRUT\b/, `${path}: sin "RUT" fijo`);
}
// Las pantallas que no reciben el país por props lo toman del contexto del negocio activo.
for (const path of [
  "src/features/clients/ClientSelector.jsx",
  "src/features/sales/SaleClientSelector.jsx",
  "src/pages/SalesPage.jsx",
  "src/pages/PurchasesPage.jsx",
  "src/pages/PurchaseOrdersPage.jsx",
  "src/features/inventory/InventoryManager.jsx",
]) {
  assert.ok((await read(path)).includes("useBusinessFormat().countryCode"), `${path}: país del negocio activo`);
}
// Clientes: "CI o NIT"; proveedores: la etiqueta del país (NIT).
for (const path of ["src/features/clients/ClientsManager.jsx", "src/features/clients/ClientSelector.jsx", "src/features/sales/SaleClientSelector.jsx", "src/pages/SalesPage.jsx"]) {
  assert.ok((await read(path)).includes("getClientFiscalListLabel("), `${path}: etiqueta de clientes`);
}
for (const path of ["src/pages/PurchasesPage.jsx", "src/pages/PurchaseOrdersPage.jsx", "src/features/inventory/InventoryManager.jsx"]) {
  assert.ok((await read(path)).includes("getFiscalIdentifierLabel("), `${path}: etiqueta de proveedores`);
}
// El respaldo de un proveedor sin tipo guardado (documentos antiguos) es la etiqueta del país; sin país, la de Chile.
for (const path of ["src/features/purchaseOrders/PurchaseOrderDetailView.jsx", "src/features/purchases/PurchaseDetailView.jsx", "src/pages/NewPurchasePage.jsx"]) {
  assert.match(await read(path), /identificadorFiscalTipo \|\| getFiscalIdentifierLabel\([^)]*\|\| "CL"\)/, `${path}: respaldo por país`);
}

// --- 3. Fecha del correo de cotización: locale del documento o de la empresa; Chile idéntico ---
const { formatDateText } = require("../functions/localization.js");
const sampleDate = new Date(2026, 10, 21);
const oldQuoteDate = (date) => date.toLocaleDateString("es-CL", { year: "numeric", month: "2-digit", day: "2-digit" });
for (const date of [sampleDate, new Date(2026, 0, 5), new Date(2025, 11, 31), new Date(2024, 1, 29)]) {
  for (const locale of ["es-CL", undefined, "", null, "no es un locale"]) {
    assert.equal(formatDateText(date, locale), oldQuoteDate(date), `Chile / sin locale: igual que antes (${date.toISOString()} ${locale})`);
  }
}
assert.equal(formatDateText(sampleDate, "es-CL"), "21-11-2026");
assert.equal(formatDateText(sampleDate, "es-BO"), "21/11/2026", "Bolivia: formato de es-BO");
const indexSource = await readFile(new URL("../functions/index.js", import.meta.url), "utf8");
const dateFn = indexSource.slice(indexSource.indexOf("function formatQuoteDate("), indexSource.indexOf("function joinNonEmpty("));
assert.doesNotMatch(dateFn, /toLocaleDateString\("es-CL"/, "la fecha del correo no fija es-CL");
assert.ok(dateFn.includes("formatDateText(date, locale)"));
assert.ok(dateFn.includes("quote?.locale || quote?.empresa?.locale"), "locale del documento o, si no, el de la empresa");
assert.equal((indexSource.match(/formatQuoteDate\(quote\.fecha, formatQuoteLocale\(quote\)\)/g) || []).length, 2, "correo en texto y en HTML");

// --- 5. Tasa de IVA del borrador: la del documento, la del negocio o la base del país; Chile idéntico ---
const oldRate = (document, company) => document?.tasaIva ?? Number(company?.impuestoPredeterminadoTasa ?? 19) / 100;
const documents = [undefined, null, {}, { tasaIva: 0.19 }, { tasaIva: 0.13 }, { tasaIva: 0 }, { tasaIva: 0.16 }];
const chileCompanies = [undefined, null, {}, { paisCodigo: "CL" }, { paisCodigo: "CL", impuestoPredeterminadoTasa: 19 }, { paisCodigo: "CL", impuestoPredeterminadoTasa: 0 }, { impuestoPredeterminadoTasa: 19 }, { paisCodigo: "CL", impuestoPredeterminadoTasa: "19" }];
for (const document of documents) {
  for (const company of chileCompanies) {
    assert.equal(resolveDocumentTaxRate(document, company), oldRate(document, company), `Chile igual que antes: ${JSON.stringify([document, company])}`);
  }
}
assert.equal(resolveDocumentTaxRate({ tasaIva: 0.13 }, { paisCodigo: "CL", impuestoPredeterminadoTasa: 19 }), 0.13, "manda el documento");
assert.equal(resolveDocumentTaxRate(undefined, { paisCodigo: "BO", impuestoPredeterminadoTasa: 13 }), 0.13, "Bolivia con perfil cargado");
assert.equal(resolveDocumentTaxRate(undefined, { paisCodigo: "BO" }), 0.13, "Bolivia con perfil sin tasa: 13 %, no 19 %");
assert.equal(resolveDocumentTaxRate({}, { paisCodigo: "BO" }), 0.13);
assert.equal(resolveDocumentTaxRate(undefined, { paisCodigo: "bo" }), 0.13);
assert.equal(resolveDocumentTaxRate({ tasaIva: 0.19 }, { paisCodigo: "BO" }), 0.19, "un documento antiguo conserva su tasa");
assert.equal(resolveDocumentTaxRate(undefined, { paisCodigo: "ZZ" }), 0.19, "país desconocido: la de Chile");
for (const path of ["src/pages/NewPurchasePage.jsx", "src/pages/NewPurchaseOrderPage.jsx", "src/pages/NewSalePage.jsx", "src/pages/NewQuotePage.jsx"]) {
  const source = await read(path);
  assert.doesNotMatch(source, /\?\? 19\b/, `${path}: sin fallback de 19 %`);
  assert.ok(source.includes("resolveDocumentTaxRate("), `${path}: usa el helper`);
  assert.ok(source.includes("company?.paisCodigo") || source.includes("companyProfile?.paisCodigo"), `${path}: el cálculo depende del país`);
}

// --- 6. Negocio adicional: país y departamento (Chile por defecto, sin cambios en Functions) ---
const drawer = await read("src/components/AdditionalBusinessDrawer.jsx");
assert.match(drawer, /<QuickBusinessFields[\s\S]*showCountry[\s\S]*showRegion/);
assert.ok(drawer.includes("INITIAL_ONBOARDING_BUSINESS_VALUES"), "parte de Chile, como el alta del primer negocio");
assert.ok(drawer.includes("requireCountry: true"));
assert.doesNotMatch(drawer, /Chile y CLP/, "el aviso fijo de Chile ya no está");
assert.deepEqual(
  normalizeQuickBusinessPayload({ nombreComercial: "Andes", rubroCodigo: "TALLER_AUTOMOTRIZ", paisCodigo: "BO", regionCodigo: "SC" }),
  { nombreComercial: "Andes", rubroCodigo: "TALLER_AUTOMOTRIZ", regionCodigo: "SC", paisCodigo: "BO" }
);
// Chile: la callable valida y guarda lo mismo con o sin paisCodigo (CL es el valor por defecto del servidor).
const { validateBusinessCreationInput } = require("../functions/businessOnboarding.js");
class TestHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const quick = { nombreComercial: "Taller Norte", rubroCodigo: "TALLER_AUTOMOTRIZ", regionCodigo: "13" };
assert.deepEqual(
  validateBusinessCreationInput({ ...quick, paisCodigo: "CL" }, TestHttpsError),
  validateBusinessCreationInput(quick, TestHttpsError),
  "negocio adicional de Chile: igual con país explícito"
);
assert.equal(validateBusinessCreationInput({ ...quick, paisCodigo: "BO", regionCodigo: "SC" }, TestHttpsError).paisCodigo, "BO");

// =====================================================================================================
// Pulido Core (SPEC 040): placeholders del formulario de cliente. Solo ejemplos: etiquetas, validaciones
// y datos no cambian. Todos los textos salen de countryFormCopy y son genéricos para cualquier país.
// =====================================================================================================
for (const code of ["CL", "BO", "MX", "PE", "PY", "OTHER", "ZZ"]) {
  const copy = getCountryFormCopy(code);
  assert.equal(copy.clientAddressExample, GENERIC_FIELD_HINTS.address, `${code}: dirección`);
  assert.equal(copy.clientBusinessActivityExample, GENERIC_FIELD_HINTS.businessActivity, `${code}: giro`);
  assert.equal(copy.clientContactPersonExample, GENERIC_FIELD_HINTS.contactPerson, `${code}: contacto`);
  assert.equal(copy.clientNotesExample, GENERIC_FIELD_HINTS.notes, `${code}: notas`);
}

// Cableado del formulario: cada campo de texto sin ejemplo previo lo toma del helper; los que ya tenían no cambian.
const clientFormSource = await read("src/features/clients/ClientFormDialog.jsx");
for (const [field, expression] of [
  ["giro", "countryCopy.clientBusinessActivityExample"],
  ["personaContacto", "countryCopy.clientContactPersonExample"],
  ["direccion", "countryCopy.clientAddressExample"],
  ["notas", "countryCopy.clientNotesExample"],
]) {
  const block = clientFormSource.slice(clientFormSource.indexOf(`field="${field}"`)).split("</ClientField>")[0];
  assert.ok(block.includes(`placeholder={${expression}}`), `${field}: placeholder desde el helper`);
}
assert.doesNotMatch(
  clientFormSource.replace(/\/\/.*$/gm, ""),
  /placeholder="Ej\. (Av\.|Venta|Transporte|Prefiere)|placeholder="Ej\. Nombre Apellido"[\s\S]{0,40}personaContacto/,
  "los ejemplos de país no están escritos en el componente"
);
// Los que ya tenían ejemplo siguen igual.
assert.ok(clientFormSource.includes("placeholder={fiscalPlaceholder}"));
assert.ok(clientFormSource.includes("placeholder={isCompany ? countryCopy.clientCompanyNameExample : countryCopy.clientPersonNameExample}"));
assert.ok(clientFormSource.includes("placeholder={isCompany ? countryCopy.clientCompanyEmailExample : countryCopy.clientPersonEmailExample}"));
assert.ok(clientFormSource.includes("placeholder={countryCopy.clientPhoneExample}"));
// Etiquetas intactas.
for (const label of ['label="Persona de contacto"', 'label="Correo"', 'label="Teléfono"', 'label="Dirección"', 'label="Notas internas"', "label={countryCopy.businessActivityLabel}"]) {
  assert.ok(clientFormSource.includes(label), `etiqueta intacta: ${label}`);
}

// Render real del formulario (Nuevo cliente): Chile, Bolivia y otro país.
// El formulario importa clientService (Firebase); se sustituye por un módulo mínimo: aquí solo se prueba el render.
const stubClientService = {
  name: "stub-client-service",
  enforce: "pre",
  resolveId(id) { return id.endsWith("services/clientService") ? "virtual:stub-client-service" : null; },
  load(id) { return id === "virtual:stub-client-service" ? "export const getClientErrorMessage = (error) => String(error?.message || error);" : null; },
};
const vite3 = await createServer({ appType: "custom", logLevel: "silent", plugins: [stubClientService], server: { middlewareMode: true } });
try {
  const ClientFormDialog = (await vite3.ssrLoadModule("/src/features/clients/ClientFormDialog.jsx")).default;
  const renderForm = (countryCode, client) => renderToStaticMarkup(
    React.createElement(ClientFormDialog, { countryCode, client, onClose() {}, onSubmit() {}, open: true })
  );
  const textHints = (html) => [...html.matchAll(/<(input|textarea)\b([^>]*)>/g)]
    .filter((m) => !/type="(checkbox|radio|hidden|submit|button)"/.test(m[2]))
    .map((m) => (m[2].match(/placeholder="([^"]*)"/) || [])[1]);
  const clMarkup = renderForm("CL");
  const boMarkup = renderForm("BO");
  const mxMarkup = renderForm("MX");
  const G = GENERIC_FIELD_HINTS;
  // Todos los países muestran el mismo texto genérico en cada campo de texto; solo el identificador fiscal cambia.
  // Empresa, en orden de aparición: identificador, razón social, giro, contacto, correo, teléfono, dirección, territorio
  // de texto (Chile: listas; Bolivia: municipio; otros: región y municipio) y notas.
  for (const [name, markup, fiscal, territory] of [
    ["Chile", clMarkup, "Ej.: 12.345.678-5", []],
    ["Bolivia", boMarkup, "Ej.: 1234567", [G.municipality]],
    ["otro país (México)", mxMarkup, G.fiscalId, [G.region, G.municipality]],
  ]) {
    assert.deepEqual(textHints(markup), [fiscal, G.legalName, G.businessActivity, G.contactPerson, G.email, G.phone, G.address, ...territory, G.notes], `${name}: texto guía del cliente (empresa)`);
    assert.ok(!/placeholder="Ej\.(?!:)/.test(markup), `${name}: ningún texto guía con ejemplo local "Ej. ..."`);
    assert.ok(!markup.includes("Servicios técnicos") && !markup.includes("Escribe municipio") && !markup.includes("Escribe departamento"), `${name}: sin los textos anteriores`);
  }
  // Etiquetas por país como antes.
  assert.ok(clMarkup.includes(">Giro<") || clMarkup.includes("Giro"), "Chile: etiqueta Giro");
  assert.ok(boMarkup.includes("Actividad económica") && !boMarkup.includes(">Giro<"), "Bolivia: etiqueta Actividad económica");
  // Persona: nombre completo y el identificador de persona de Bolivia.
  const personMarkup = renderForm("BO", { clienteId: "c1", tipoCliente: "persona", rut: "1234567", nombreRazonSocial: "Ana Gómez", paisCodigo: "BO" });
  assert.deepEqual(textHints(personMarkup), ["Ej.: 1234567", G.personName, G.email, G.phone, G.address, G.municipality, G.notes], "Bolivia · persona");
} finally {
  await vite3.close();
}
console.log("OK formulario de cliente: texto guía genérico (SPEC 040)");

// =====================================================================================================
// Texto guía de cliente y proveedor (SPEC 040): genérico y el mismo para todos los países; solo el identificador
// fiscal conserva su ejemplo de formato por país. Se fija campo por campo.
// =====================================================================================================
assert.deepEqual(GENERIC_FIELD_HINTS, {
  fiscalId: "Escribe el identificador fiscal",
  personName: "Escribe el nombre completo",
  legalName: "Escribe el nombre o razón social",
  tradeName: "Escribe el nombre de fantasía",
  businessActivity: "Escribe la actividad económica",
  email: "Escribe el correo electrónico",
  phone: "Escribe el teléfono de contacto",
  contactPerson: "Escribe el nombre de la persona de contacto",
  address: "Escribe la dirección",
  region: "Escribe el departamento o región",
  municipality: "Escribe el municipio o comuna",
  notes: "Escribe una nota interna",
  creditDays: "Escribe los días de crédito",
});
const expectedGeneric = {
  clientCompanyNameExample: "Escribe el nombre o razón social",
  clientPersonNameExample: "Escribe el nombre completo",
  clientBusinessActivityExample: "Escribe la actividad económica",
  clientContactPersonExample: "Escribe el nombre de la persona de contacto",
  clientCompanyEmailExample: "Escribe el correo electrónico",
  clientPersonEmailExample: "Escribe el correo electrónico",
  clientPhoneExample: "Escribe el teléfono de contacto",
  clientAddressExample: "Escribe la dirección",
  clientNotesExample: "Escribe una nota interna",
  providerLegalNameExample: "Escribe el nombre o razón social",
  providerTradeNameExample: "Escribe el nombre de fantasía",
  providerBusinessActivityExample: "Escribe la actividad económica",
  providerEmailExample: "Escribe el correo electrónico",
  providerPhoneExample: "Escribe el teléfono de contacto",
  providerContactPersonExample: "Escribe el nombre de la persona de contacto",
  providerAddressExample: "Escribe la dirección",
  providerCreditDaysExample: "Escribe los días de crédito",
  providerNotesExample: "Escribe una nota interna",
  territoryRegionExample: "Escribe el departamento o región",
  territoryMunicipalityExample: "Escribe el municipio o comuna",
};
assert.deepEqual([...FORM_HINT_KEYS].sort(), Object.keys(expectedGeneric).sort(), "el smoke cubre todas las claves de texto guía");
const hintsOf = (code) => Object.fromEntries(FORM_HINT_KEYS.map((key) => [key, getCountryFormCopy(code)[key]]));
// Chile, Bolivia y un país sin entrada propia: exactamente lo mismo; también uno desconocido y sin país.
for (const code of ["CL", "BO", "PE", "MX", "BR", "OTHER", "ZZ", undefined, ""]) {
  assert.deepEqual(hintsOf(code), expectedGeneric, `${code}: texto guía genérico por campo`);
  for (const key of FORM_HINT_KEYS) {
    const value = getCountryFormCopy(code)[key];
    assert.ok(typeof value === "string" && value.trim().length > 0, `${code}.${key}: nunca null ni vacío`);
    assert.match(value, /^Escribe /, `${code}.${key}: texto de instrucción`);
    assert.doesNotMatch(value, /^Ej\./, `${code}.${key}: sin "Ej."`);
    assert.doesNotMatch(value, /@|\+\d|\.cl\b|\.bo\b|Chile|Bolivia|Per[uú]|Brasil|M[eé]xico|repuesto|automotri|transporte|carga|servicios t[eé]cnicos|inform[aá]tic|electric|ferreter|taller|veterinari|cl[ií]nica|restaurant|construcci/i, `${code}.${key}: sin país ni rubro`);
    assert.ok(!value.includes("¿"), `${code}.${key}: sin signo de apertura`);
  }
}
// Las etiquetas por país se mantienen (Giro / Actividad económica) y el resto del copy no cambia.
assert.equal(getCountryFormCopy("CL").businessActivityLabel, "Giro");
assert.equal(getCountryFormCopy("BO").businessActivityLabel, "Actividad económica");
// Excepción: el identificador fiscal conserva su ejemplo de formato donde existe y es genérico en los demás.
assert.equal(getFiscalIdentifierHint("CL"), "Ej.: 12.345.678-5");
assert.equal(getFiscalIdentifierHint("BO"), "Ej.: 1234567");
assert.equal(getFiscalIdentifierHint("BR"), "Ej.: 529.982.247-25");
assert.equal(getFiscalIdentifierHint("PE"), "Ej.: 20100070970");
for (const code of ["MX", "AR", "CO", "OTHER", "ZZ", undefined]) assert.equal(getFiscalIdentifierHint(code), GENERIC_FIELD_HINTS.fiscalId, `${code}: identificador fiscal genérico`);
assert.deepEqual(getClientFiscalCopy("MX", "empresa"), { label: "RFC", placeholder: "Escribe el identificador fiscal" });
assert.equal(getClientFiscalCopy("BO", "persona").placeholder, "Ej.: 1234567");
// Fuente: sin ejemplos locales de texto en countryFormCopy, con el punto de extensión en pie y vacío; y los
// componentes no escriben texto guía propio (lo piden al copy).
const copySource = await read("src/domain/countryFormCopy.mjs");
assert.doesNotMatch(copySource, /(?:client|provider|territory)\w*Example: "Ej\./, "ningún ejemplo local de cliente, proveedor o territorio");
assert.match(copySource, /const LOCAL_FORM_EXAMPLES = Object\.freeze\(\{\}\);/, "el punto de extensión de ejemplos locales sigue, vacío");
assert.ok(copySource.includes("...(LOCAL_FORM_EXAMPLES[code] || {}),"), "y se aplica al resolver el copy");
for (const path of ["src/features/clients/ClientFormDialog.jsx", "src/features/providers/ProviderFormDialog.jsx", "src/components/contacts/ContactTerritoryFields.jsx"]) {
  const source = (await read(path)).replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(source, /placeholder="(Ej\.|Escribe)|placeholder=\{`Escribe/, `${path}: sin texto guía escrito en el componente`);
}

console.log("OK texto guía de cliente y proveedor: genérico para todos los países (solo el identificador fiscal conserva ejemplo)");

console.log("COUNTRY_FORM_COPY_SMOKE_OK");
