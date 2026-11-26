import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildVehicleMutationPayload,
  getVehicleFieldErrors,
  getVehicleTypeLabel,
  isTextOnly,
  isValidVehiclePlate,
  keepTextOnlyInput,
  keepVehicleYearInput,
  MAX_VEHICLE_YEAR,
  MIN_VEHICLE_YEAR,
  matchesVehicleSearch,
  normalizeVehiclePlate,
} from "../src/domain/vehicleModel.mjs";

assert.equal(getVehicleTypeLabel("sedan"), "Sedán");
assert.equal(getVehicleTypeLabel("station_wagon"), "Station Wagon");
assert.deepEqual(
  Object.keys(getVehicleFieldErrors({patente: "", marca: "", modelo: "", anio: "", color: "", tipo: ""}, {requiresOwner: true})).sort(),
  ["anio", "clienteId", "color", "marca", "modelo", "patente", "tipo"],
);
assert.equal(getVehicleFieldErrors({patente: "ABCD12", marca: "Marca", modelo: "Modelo", anio: "2024", color: "Rojo", tipo: "suv"}).anio, undefined);
assert.equal(MIN_VEHICLE_YEAR, 1900);
assert.equal(MAX_VEHICLE_YEAR, new Date().getFullYear() + 1);
assert.equal(getVehicleFieldErrors({patente: "ABCD12", marca: "Marca", modelo: "Modelo", anio: "999", color: "Rojo", tipo: "suv"}).anio.includes("4 dígitos"), true);
assert.equal(getVehicleFieldErrors({patente: "ABCD12", marca: "Marca", modelo: "Modelo", anio: "1899", color: "Rojo", tipo: "suv"}).anio.includes("1900"), true);
assert.equal(getVehicleFieldErrors({patente: "ABCD12", marca: "Marca", modelo: "Modelo", anio: String(MAX_VEHICLE_YEAR + 1), color: "Rojo", tipo: "suv"}).anio.includes(String(MAX_VEHICLE_YEAR)), true);
assert.equal(getVehicleFieldErrors({patente: "ABCD12", marca: "Marca", modelo: "Modelo", anio: String(MAX_VEHICLE_YEAR), color: "Rojo", tipo: "suv"}).anio, undefined);
assert.equal(keepVehicleYearInput("20a267"), "2026");
assert.equal(keepVehicleYearInput("12345"), "1234");
for (const [field, value, expectedLength] of [
  ["vin", "V".repeat(81), 80],
  ["marca", "M".repeat(121), 120],
  ["modelo", "X".repeat(121), 120],
  ["color", "C".repeat(81), 80],
]) {
  assert.equal(
    getVehicleFieldErrors({patente: "ABCD12", marca: "Marca", modelo: "Modelo", anio: "2024", color: "Rojo", tipo: "suv", [field]: value})[field].includes(String(expectedLength)),
    true
  );
}
assert.equal(buildVehicleMutationPayload({anio: "2008"}).anio, 2008);
assert.equal(typeof buildVehicleMutationPayload({anio: "2008"}).anio, "number");
assert.equal(isValidVehiclePlate("ABCD12"), true);
assert.equal(isValidVehiclePlate("ABC12"), true);
assert.equal(isValidVehiclePlate("ABCDE1"), true);
assert.equal(isValidVehiclePlate("ABCD1"), true);
assert.equal(isValidVehiclePlate("AB1234"), true);
assert.equal(isValidVehiclePlate("AB123"), true);
assert.equal(isValidVehiclePlate("ABC123", "PY"), true);
assert.equal(isValidVehiclePlate("ABCD123", "PY"), true);
assert.equal(isValidVehiclePlate("ABC123", "CL"), false);
assert.equal(isValidVehiclePlate("ABCD12", "PY"), false);
assert.equal(isValidVehiclePlate("1234ABC", "BO"), true);
assert.equal(isValidVehiclePlate("AB12C", "BO"), false);
for (const plate of ["ABCD", "12345", "ABCDEFGHI", "123456789", "ABCD12"]) {
  assert.equal(isValidVehiclePlate(plate, "BO"), false);
}
assert.match(getVehicleFieldErrors({patente: "ABCD"}, {countryCode: "BO"}).patente, /patente válida para BO/);
assert.equal(normalizeVehiclePlate("abc-123"), "ABC123");
for (const plate of ["12ABC", "12345ABC", "1234AB", "ABC1234", "1234AB1"]) {
  assert.equal(isValidVehiclePlate(plate), false);
}
assert.equal(isValidVehiclePlate("ASDDD"), false);
assert.equal(isTextOnly("Hyundai"), true);
assert.equal(isTextOnly("Mercedes-Benz"), true);
assert.equal(isTextOnly("Hyundai 2"), false);
assert.equal(keepTextOnlyInput("Hyundai 2"), "Hyundai ");
assert.equal(keepTextOnlyInput("Azul 123"), "Azul ");
assert.match(getVehicleFieldErrors({patente: "ASDDD", marca: "Hyundai 2", modelo: "i30", anio: "2008", color: "Azul 2", tipo: "hatchback"}).patente, /patente válida/i);
assert.equal(matchesVehicleSearch({patente: "ABCD12", vin: "1HGCM826", marca: "Honda", modelo: "Civic"}, "civic"), true);
assert.equal(matchesVehicleSearch({patente: "ABCD12", vin: "1HGCM826", marca: "Honda", modelo: "Civic"}, "inexistente"), false);
console.log("OK dominio UI: tipos controlados, campos obligatorios y búsqueda local");

const app = fs.readFileSync("src/app/App.jsx", "utf8");
assert.match(app, /path="\/taller\/vehiculos"/);
assert.match(app, /<VehiclesPage/);
assert.match(app, /<NewVehiclePage/);
assert.match(app, /<VehicleDetailPage/);
const list = fs.readFileSync("src/pages/VehiclesPage.jsx", "utf8");
assert.match(list, /Patente, VIN, marca o modelo/);
assert.match(list, /listarVehiculos/);
assert.match(list, /canReadClients \? listarClientes\(businessId\) : Promise\.resolve\(\[\]\)/);
assert.match(list, /Restringido por permisos/);
assert.match(list, /Propietario o Administrador pueden editar datos y cambiar propietarios/);
assert.doesNotMatch(list, /OWNER o ADMIN/);
const detail = fs.readFileSync("src/pages/VehicleDetailPage.jsx", "utf8");
assert.match(detail, /Historial de órdenes de trabajo/);
assert.match(detail, /listarOrdenesTrabajo/);
assert.match(detail, /order\.vehiculoId === vehicleItem\.vehiculoId/);
assert.match(detail, /Aún no hay órdenes de trabajo registradas para este vehículo/);
assert.doesNotMatch(detail, /Aún no hay una fuente de datos de órdenes de trabajo/);
assert.match(detail, /cambiarPropietarioVehiculo/);
assert.match(detail, /canReadClients \? listarClientes\(businessId\) : Promise\.resolve\(\[\]\)/);
assert.match(detail, /La información del propietario está restringida para tu perfil/);
assert.match(detail, /Propietario o Administrador pueden modificar esta ficha/);
assert.match(detail, /\{canReadClients && <p className="erp-secondary-text">El cambio de propietario/);
assert.doesNotMatch(detail, /OWNER o ADMIN/);
assert.doesNotMatch(detail, /Ver clientes/);
const form = fs.readFileSync("src/features/vehicles/VehicleFormFields.jsx", "utf8");
assert.match(form, /field\("vin", "VIN", \{optional: true/);
assert.match(form, /<select/);
assert.doesNotMatch(form, /<input[^>]+tipo/);
assert.match(form, /normalizeVehiclePlate/);
assert.match(form, /maxLength: 8/);
assert.match(form, /getCountryFormCopy/);
assert.match(form, /copy\.vehiclePlateExample/);
assert.match(form, /copy\.vehicleVinExample/);
assert.match(form, /copy\.vehicleBrandExample/);
assert.match(form, /copy\.vehicleModelExample/);
assert.match(form, /copy\.vehicleColorExample/);
assert.match(form, /keepTextOnlyInput/);
assert.match(form, /keepVehicleYearInput/);
assert.match(form, /inputMode="numeric"/);
assert.match(form, /pattern="\[0-9\]\{4\}"/);
assert.match(form, /maxLength=\{4\}/);
assert.match(form, /field\("color", "Color", \{required: true, maxLength: 80, placeholder: copy\.vehicleColorExample\}\)/);
const newVehiclePage = fs.readFileSync("src/pages/NewVehiclePage.jsx", "utf8");
assert.match(newVehiclePage, /useCallback/);
assert.match(newVehiclePage, /onChange=\{handleOwnerChange\}/);
assert.match(newVehiclePage, /hasBusinessPermission\(role, BUSINESS_PERMISSIONS.TALLER_CREATE\)/);
assert.match(newVehiclePage, /loadClients=\{listarClientesSeleccionablesTaller\} nameOnly /);
const clientSelector = fs.readFileSync("src/features/clients/ClientSelector.jsx", "utf8");
assert.match(clientSelector, /nameOnly = false/);
assert.match(clientSelector, /\{!nameOnly && \(\s*<>[\s\S]*?Sin identificación fiscal[\s\S]*?Sin datos de contacto[\s\S]*?<\/>\s*\)\}/);
assert.match(clientSelector, /\{!nameOnly && <span>\{client\.identificadorFiscalValor \|\| client\.rut\}<\/span>\}/);
assert.match(clientSelector, /\{!nameOnly && <small>/);
assert.match(clientSelector, /nameOnly\s*\? "Busca por nombre\./);
assert.match(clientSelector, /nameOnly \? "Nombre del cliente"/);
assert.match(clientSelector, /eyebrow=\{nameOnly \? "Taller" : "Cotización"\}/);
assert.match(clientSelector, /nameOnly\s*\? "El vehículo quedará asociado a este cliente\."/);
// Modo "inline" con nameOnly: el buscador, el contador y los resultados no muestran ni mencionan RUT ni contacto. Sin nameOnly
// (cotizaciones) el texto y los resultados son los de siempre.
{
  const inlinePicker = clientSelector.slice(clientSelector.indexOf('client-selector__inline-picker"'), clientSelector.indexOf('client-selector__summary"'));
  assert.ok(inlinePicker.length > 200, "se aísla el selector en línea");
  assert.match(inlinePicker, /placeholder=\{nameOnly \? "Buscar cliente por nombre" : `Buscar cliente por nombre o \$\{fiscalLabel\}`\}/);
  assert.match(inlinePicker, /· escribe un nombre\{nameOnly \? "" : ` o \$\{fiscalLabel\}`\} para buscar/, "el contador solo menciona el RUT sin nameOnly");
  assert.equal((inlinePicker.match(/\{!nameOnly && <span>\{client\.identificadorFiscalValor \|\| client\.rut\}<\/span>\}/g) || []).length, 1, "en línea el RUT del resultado solo sin nameOnly");
  assert.equal((inlinePicker.match(/\{!nameOnly && <small>\{client\.email \|\| client\.telefono \|\| "Sin datos de contacto"\}<\/small>\}/g) || []).length, 1, "en línea el contacto del resultado solo sin nameOnly");
  const sinRamasSinNameOnly = inlinePicker
    .replace(/\{nameOnly \? "" : ` o \$\{fiscalLabel\}`\}/g, "")
    .replace(/\{!nameOnly && <(span|small)>[\s\S]*?<\/\1>\}/g, "")
    .replace(/nameOnly \? "[^"]*" : ("[^"]*"|`[^`]*`)/g, "");
  assert.doesNotMatch(sinRamasSinNameOnly, /RUT|\brut\b|fiscal|email|telefono|contacto/i, "con nameOnly el selector en línea no menciona RUT, identificación fiscal ni contacto");
}
assert.match(newVehiclePage, /requestIdRef = useRef\(""\)/);
assert.match(newVehiclePage, /requestIdRef\.current = createVehicleRequestId\(\)/);
assert.match(newVehiclePage, /crearVehiculo\(businessId, selectedOwnerId, buildVehicleMutationPayload\(values\), requestIdRef\.current\)/);
assert.match(newVehiclePage, /requestIdRef\.current = "";/);
const vehicleService = fs.readFileSync("src/services/vehicleService.js", "utf8");
assert.match(vehicleService, /requestId: requireIdentifier\(requestId,/);
assert.doesNotMatch(vehicleService, /requestId: createVehicleRequestId\(\)/);
const workOrdersPage = fs.readFileSync("src/pages/WorkOrdersPage.jsx", "utf8");
assert.match(workOrdersPage, /getCountryFormCopy/);
assert.match(workOrdersPage, /placeholder=\{countryCopy\.workOrderSearchExample\}/);
console.log("OK rutas UI: listado, alta, ficha, selector controlado e historial sin datos inventados");
console.log("VEHICLE_UI_SMOKE_OK");
