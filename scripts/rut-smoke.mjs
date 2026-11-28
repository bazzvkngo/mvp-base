import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {filterSelectableClients, getClientFieldErrors, matchesClientSearch} from "../src/domain/clientModel.mjs";
import {getProviderFieldErrors, matchesProviderSearch} from "../src/domain/providerModel.mjs";
import {matchesSaleSearch} from "../src/domain/saleModel.mjs";
import {matchesPurchaseSearch} from "../src/domain/purchaseModel.mjs";
import {matchesPurchaseOrderSearch} from "../src/domain/purchaseOrderModel.mjs";
import {matchesWorkFilters} from "../src/domain/workModel.mjs";
import {
  RUT_CHECK_DIGIT_MESSAGE,
  formatFiscalIdInput,
  formatRutInput,
  getRutCheckDigitMessage,
  getRutStatus,
  isRutSearchQuery,
  isValidChileanRut,
  matchesRutSearch,
  matchesSearchOrRut,
  rutSearchKey,
} from "../src/domain/rut.mjs";

// RUT chileno en búsquedas y campos: coincidencia tolerante, formato en vivo y dígito verificador.
// Funciones puras de src/domain/rut.mjs; la pantalla de Nueva venta era la que no encontraba al cliente.

// Cliente guardado con cada formato posible (con puntos y guion, solo dígitos, con guion sin puntos).
const clients = [
  {clienteId: "a", negocioId: "n1", estado: "activo", nombreRazonSocial: "Comercial Andes", rut: "18.373.138-6", identificadorFiscalValor: "18.373.138-6", rutNormalizado: "18373138-6", email: "ventas@andes.cl", telefono: "+56 9 1111 2222"},
  {clienteId: "b", negocioId: "n1", estado: "activo", nombreRazonSocial: "Soluciones Beta", rut: "183731386", identificadorFiscalValor: "183731386"},
  {clienteId: "c", negocioId: "n1", estado: "activo", nombreRazonSocial: "Taller Gamma", rut: "18373138-6", identificadorFiscalValor: "18373138-6", identificadorFiscalNormalizado: "183731386"},
  {clienteId: "d", negocioId: "n1", estado: "activo", nombreRazonSocial: "Kiosco Delta", rut: "1.000.005-K", identificadorFiscalValor: "1.000.005-K", identificadorFiscalNormalizado: "1000005K"},
  {clienteId: "e", negocioId: "n1", estado: "activo", nombreRazonSocial: "Otro Cliente SpA", rut: "12.345.678-5", identificadorFiscalValor: "12.345.678-5"},
];
const ids = (list) => list.map((client) => client.clienteId).sort().join("");

// 1) El mismo RUT se encuentra con cada variante escrita, sin importar cómo esté guardado.
const sameRutVariants = ["183731386", "18.373.138-6", "18373138-6", "18373138", "18.373.138", "18 373 138-6", " 183731386 ", "3731386", "138-6"];
for (const query of sameRutVariants) {
  assert.equal(ids(clients.filter((client) => matchesClientSearch(client, query))), "abc", `RUT ${query}`);
  assert.equal(ids(filterSelectableClients(clients, "n1", query)), "abc", `selector ${query}`);
}
// La variante con K (mayúscula o minúscula, con o sin puntos) encuentra al cliente cuyo RUT termina en K.
for (const query of ["1000005K", "1000005k", "1.000.005-K", "1.000.005-k", "1000005-k", "10000"]) {
  assert.equal(ids(clients.filter((client) => matchesClientSearch(client, query))), "d", `RUT con K ${query}`);
}
// Un RUT distinto no se mezcla.
assert.equal(ids(clients.filter((client) => matchesClientSearch(client, "12345678-5"))), "e");
assert.equal(clients.filter((client) => matchesClientSearch(client, "99999999")).length, 0);

// 2) Texto que no es RUT: el nombre, el correo y el teléfono siguen funcionando y la K de un nombre no se confunde.
assert.equal(ids(clients.filter((client) => matchesClientSearch(client, "comercial"))), "a");
assert.equal(ids(clients.filter((client) => matchesClientSearch(client, "SOLUCIONES BETA"))), "b");
assert.equal(ids(clients.filter((client) => matchesClientSearch(client, "kiosco"))), "d");
assert.equal(ids(clients.filter((client) => matchesClientSearch(client, "ventas@andes"))), "a");
assert.equal(ids(clients.filter((client) => matchesClientSearch(client, "+56 9 1111"))), "a");
assert.equal(clients.filter((client) => matchesClientSearch(client, "karla")).length, 0, "Karla no es RUT ni coincide con ningún nombre");
assert.equal(clients.filter((client) => matchesClientSearch(client, "k")).length, 1, "una K sola solo coincide como texto (Kiosco), no como RUT");
assert.equal(clients.filter((client) => matchesClientSearch(client, "")).length, clients.length, "sin texto coincide todo");
assert.equal(clients.filter((client) => matchesClientSearch(client, "Andes 5")).length, 0, "texto mixto no se reduce a dígitos");
assert.equal(matchesClientSearch(null, "algo"), false);
assert.equal(matchesClientSearch({}, "18373138"), false);

// 3) isRutSearchQuery y rutSearchKey.
assert.equal(rutSearchKey("18.373.138-k"), "18373138K");
assert.equal(rutSearchKey(null), "");
for (const query of ["183731386", "18.373.138-6", "18373138k", "1"]) assert.equal(isRutSearchQuery(query), true, query);
for (const query of ["", "k", "Karla", "Juan 5", "18k3", "ab12", "-18"]) assert.equal(isRutSearchQuery(query), false, query);
assert.equal(matchesRutSearch("183731386", "18.373.138-6"), true);
assert.equal(matchesRutSearch("183731386"), false);
assert.equal(matchesSearchOrRut("183731386", ["otro texto"], ["18.373.138-6"]), true, "se suma al texto");
assert.equal(matchesSearchOrRut("otro", ["otro texto"], ["18.373.138-6"]), true);

// 4) Proveedores, ventas, compras, órdenes de compra y proyectos usan la misma coincidencia.
const provider = {razonSocial: "Distribuidora Norte", nombreFantasia: "Norte", rut: "76.123.456-0", identificadorFiscalValor: "76.123.456-0"};
for (const query of ["761234560", "76.123.456-0", "76123456-0", "distribuidora", "norte"]) assert.equal(matchesProviderSearch(provider, query), true, `proveedor ${query}`);
assert.equal(matchesProviderSearch(provider, "99999999"), false);
const sale = {numero: "V-1", clienteSnapshot: {nombreRazonSocial: "Comercial Andes", rut: "18.373.138-6"}};
assert.equal(matchesSaleSearch(sale, "183731386"), true);
assert.equal(matchesSaleSearch(sale, "comercial"), true);
assert.equal(matchesSaleSearch(sale, "V-1"), true);
assert.equal(matchesSaleSearch(sale, "55555555"), false);
const purchase = {numero: "C-1", proveedorSnapshot: {razonSocial: "Distribuidora Norte", rut: "76.123.456-0"}};
assert.equal(matchesPurchaseSearch(purchase, "761234560"), true);
assert.equal(matchesPurchaseSearch(purchase, "distribuidora"), true);
const purchaseOrder = {numero: "OC-1", proveedorSnapshot: {razonSocial: "Distribuidora Norte", rut: "76123456-0"}};
assert.equal(matchesPurchaseOrderSearch(purchaseOrder, "76.123.456-0"), true);
assert.equal(matchesPurchaseOrderSearch(purchaseOrder, "oc-1"), true);
const work = {numero: "P-1", titulo: "Instalación", clienteSnapshot: {nombreRazonSocial: "Comercial Andes", rut: "183731386"}};
assert.equal(matchesWorkFilters(work, {query: "18.373.138-6"}), true);
assert.equal(matchesWorkFilters(work, {query: "instalacion"}), true);
assert.equal(matchesWorkFilters(work, {query: "777"}), false);

// 5) Dígito verificador (módulo 11): válido, inválido, con K y estados del campo.
assert.equal(isValidChileanRut("18.373.138-6"), true);
assert.equal(isValidChileanRut("18.373.138-5"), false);
assert.equal(isValidChileanRut("1.000.005-K"), true);
assert.equal(isValidChileanRut("1.000.005-4"), false);
assert.equal(getRutStatus(""), "empty");
assert.equal(getRutStatus("18.373"), "incomplete");
assert.equal(getRutStatus("18.373.138-6"), "valid");
assert.equal(getRutStatus("18.373.138-5"), "invalid");
assert.equal(getRutCheckDigitMessage("18.373.138-5"), RUT_CHECK_DIGIT_MESSAGE);
assert.equal(getRutCheckDigitMessage("18.373.138-6"), "");
assert.equal(getRutCheckDigitMessage("18.373"), "", "incompleto: todavía se está escribiendo");
assert.match(RUT_CHECK_DIGIT_MESSAGE, /dígito verificador/);

// El formulario de cliente y de proveedor muestran el mensaje claro con RUT completo e inválido; el
// incompleto y los países sin RUT conservan el mensaje de siempre, y un RUT válido no da error.
const clientBase = {tipoCliente: "empresa", nombreRazonSocial: "Cliente de prueba"};
assert.equal(getClientFieldErrors({...clientBase, rut: "18.373.138-5"}, "CL").rut, RUT_CHECK_DIGIT_MESSAGE);
assert.equal(getClientFieldErrors({...clientBase, rut: "1-9"}, "CL").rut, "Ingresa un RUT válido.");
assert.equal(getClientFieldErrors({...clientBase, rut: "18.373.138-6"}, "CL").rut, undefined);
assert.equal(getClientFieldErrors({...clientBase, rut: "1234567"}, "BO").rut, undefined);
assert.equal(getClientFieldErrors({...clientBase, rut: "12"}, "BO").rut, "Ingresa un NIT válido.");
assert.equal(getProviderFieldErrors({rut: "76.123.456-1", razonSocial: "Proveedor"}, "CL").rut, RUT_CHECK_DIGIT_MESSAGE);
assert.equal(getProviderFieldErrors({rut: "76.123.456-0", razonSocial: "Proveedor"}, "CL").rut, undefined);

// 6) Formato mientras se escribe (solo Chile) y cursor.
const typed = (text) => formatRutInput(text).value;
assert.equal(typed("183731386"), "18.373.138-6");
assert.equal(typed("18373138-6"), "18.373.138-6");
assert.equal(typed("18.373.138-6"), "18.373.138-6");
assert.equal(typed("1"), "1");
assert.equal(typed("18"), "1-8");
assert.equal(typed("123456785"), "12.345.678-5");
assert.equal(typed("1000005k"), "1.000.005-K", "la K minúscula pasa a mayúscula");
assert.equal(typed("12345678k"), "12.345.678-K");
assert.equal(typed("1K23"), "12-3", "una K que no es la última se descarta");
assert.equal(typed("1234567890123"), "12.345.678-9", "no pasa de 9 caracteres");
assert.equal(typed("RUT: 18.373.138-6 "), "18.373.138-6", "pegar texto con basura");
assert.equal(typed(""), "");
assert.equal(typed(null), "");
// Cursor: escribir un dígito al final deja el cursor al final; en medio no salta al final.
assert.deepEqual(formatRutInput("183731386", 9, "18.373.138-"), {value: "18.373.138-6", caret: 12});
assert.deepEqual(formatRutInput("18.9373.138-6", 4, "18.373.138-6"), {value: "18.937.313-8", caret: 4}, "un dígito escrito en medio deja el cursor tras ese dígito");
// Borrar solo un punto o el guion borra el dígito anterior y no se queda atascado.
assert.deepEqual(formatRutInput("18373.138-6", 2, "18.373.138-6"), {value: "1.373.138-6", caret: 1});
assert.deepEqual(formatRutInput("18.373.1386", 10, "18.373.138-6"), {value: "1.837.313-6", caret: 9});
// Borrar un dígito normal.
assert.equal(formatRutInput("18.373.13-6", 9, "18.373.138-6").value, "1.837.313-6");
// Pegar un RUT completo en un campo vacío.
assert.deepEqual(formatRutInput("183731386", 9, ""), {value: "18.373.138-6", caret: 12});

// Otros países: sin formato chileno (NIT, CI...).
assert.deepEqual(formatFiscalIdInput("BO", "1234567-1A", 10, ""), {value: "1234567-1A", caret: 10});
assert.deepEqual(formatFiscalIdInput("PE", "20100070970", 11, ""), {value: "20100070970", caret: 11});
assert.deepEqual(formatFiscalIdInput("OTHER", "tax-123", 7, ""), {value: "tax-123", caret: 7});
assert.equal(formatFiscalIdInput("CL", "183731386", 9, "").value, "18.373.138-6");
assert.equal(formatFiscalIdInput(undefined, "183731386", 9, "").value, "183731386", "sin país conocido no se aplica el formato chileno");

// 7) Cableado: las pantallas usan la coincidencia compartida y los campos usan FiscalIdInput.
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const saleSelector = await read("src/features/sales/SaleClientSelector.jsx");
assert.ok(saleSelector.includes("matchesClientSearch(client, search)"), "Nueva venta usa la coincidencia compartida");
assert.ok(!/searchable\(/.test(saleSelector), "Nueva venta ya no filtra con texto crudo");
for (const path of ["src/features/clients/ClientFormDialog.jsx", "src/features/providers/ProviderFormDialog.jsx", "src/features/company/CompanyConfig.jsx", "src/features/inventory/InventoryManager.jsx", "src/pages/AccountPage.jsx"]) {
  assert.ok((await read(path)).includes("<FiscalIdInput"), `${path}: campo con formato en vivo`);
}
assert.ok(!(await read("src/features/clients/ClientSelector.jsx")).includes("FiscalIdInput"), "el buscador de clientes no fuerza el formato");
assert.ok(!(await read("src/features/sales/SaleClientSelector.jsx")).includes("FiscalIdInput"), "el buscador de Nueva venta no fuerza el formato");
for (const path of ["src/features/quotes/QuoteClientSelector.jsx", "src/features/clients/ClientsManager.jsx", "src/features/clients/ClientSelector.jsx"]) {
  assert.ok((await read(path)).includes("matchesClientSearch") || (await read(path)).includes("filterSelectableClients"), `${path}: coincidencia compartida`);
}
for (const path of ["src/pages/VehiclesPage.jsx", "src/features/veterinary/patients/VeterinaryPatients.jsx", "src/pages/QuoteHistoryPage.jsx", "src/features/works/WorkQuoteSelector.jsx"]) {
  assert.ok((await read(path)).includes("matchesRutSearch"), `${path}: busca también por RUT`);
}

console.log("rut-smoke OK");
