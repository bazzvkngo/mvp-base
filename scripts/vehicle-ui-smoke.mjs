import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildVehicleMutationPayload,
  getVehicleFieldErrors,
  getVehicleTypeLabel,
  isTextOnly,
  isValidVehiclePlate,
  keepTextOnlyInput,
  matchesVehicleSearch,
} from "../src/domain/vehicleModel.mjs";

assert.equal(getVehicleTypeLabel("sedan"), "Sedán");
assert.equal(getVehicleTypeLabel("station_wagon"), "Station Wagon");
assert.deepEqual(
  Object.keys(getVehicleFieldErrors({patente: "", marca: "", modelo: "", anio: "", color: "", tipo: ""}, {requiresOwner: true})).sort(),
  ["anio", "clienteId", "color", "marca", "modelo", "patente", "tipo"],
);
assert.equal(getVehicleFieldErrors({patente: "ABCD12", marca: "Marca", modelo: "Modelo", anio: "2024", color: "Rojo", tipo: "suv"}).anio, undefined);
assert.equal(buildVehicleMutationPayload({anio: "2008"}).anio, 2008);
assert.equal(typeof buildVehicleMutationPayload({anio: "2008"}).anio, "number");
assert.equal(isValidVehiclePlate("ABCD12"), true);
assert.equal(isValidVehiclePlate("ABC12"), true);
assert.equal(isValidVehiclePlate("ABCDE1"), true);
assert.equal(isValidVehiclePlate("ABCD1"), true);
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
const detail = fs.readFileSync("src/pages/VehicleDetailPage.jsx", "utf8");
assert.match(detail, /Historial de órdenes de trabajo/);
assert.match(detail, /Aún no hay una fuente de datos de órdenes de trabajo/);
assert.match(detail, /cambiarPropietarioVehiculo/);
assert.doesNotMatch(detail, /Ver clientes/);
const form = fs.readFileSync("src/features/vehicles/VehicleFormFields.jsx", "utf8");
assert.match(form, /field\("vin", "VIN", \{optional: true/);
assert.match(form, /<select/);
assert.doesNotMatch(form, /<input[^>]+tipo/);
assert.match(form, /normalizeVehiclePlate/);
assert.match(form, /keepTextOnlyInput/);
const newVehiclePage = fs.readFileSync("src/pages/NewVehiclePage.jsx", "utf8");
assert.match(newVehiclePage, /useCallback/);
assert.match(newVehiclePage, /onChange=\{handleOwnerChange\}/);
console.log("OK rutas UI: listado, alta, ficha, selector controlado e historial sin datos inventados");
console.log("VEHICLE_UI_SMOKE_OK");
