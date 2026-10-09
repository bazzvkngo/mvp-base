import assert from "node:assert/strict";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const {
  VEHICLE_TYPES,
  normalizeVehicleInput,
  normalizeVehicleKey,
  normalizeVehiclePlate,
} = require("../functions/vehiclePersistence.js");

class TestHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const vehicle = normalizeVehicleInput({
  clienteId: "cliente-1",
  patente: " ab-cd 12 ",
  vin: " 1hg-cm826 33a004352 ",
  marca: "  Toyota  ",
  modelo: " Corolla   Cross ",
  anio: 2026,
  color: " Azul ",
  tipo: " SUV ",
}, TestHttpsError);

assert.deepEqual(vehicle, {
  clienteId: "cliente-1",
  patente: "ABCD12",
  vin: "1HGCM82633A004352",
  marca: "Toyota",
  modelo: "Corolla Cross",
  anio: 2026,
  color: "Azul",
  tipo: "suv",
});
assert.equal(Object.hasOwn(vehicle, "patenteNormalizada"), false);
assert.equal(Object.hasOwn(vehicle, "vinNormalizado"), false);
console.log("OK vehículo: normaliza y conserva únicamente campos canónicos");

assert.equal(
  normalizeVehicleKey(" aa-bb 11 ", "La patente", 30, TestHttpsError, false),
  "AABB11"
);
for (const plate of ["ABCD12", "ABC12", "ABCDE1", "ABCD1"]) {
  assert.equal(normalizeVehiclePlate(plate, TestHttpsError), plate);
}
assert.equal(normalizeVehiclePlate(" ab-cd 12 ", TestHttpsError), "ABCD12");
assert.throws(
  () => normalizeVehiclePlate("ASDDD", TestHttpsError),
  (error) => error.code === "invalid-argument" && /patente/i.test(error.message)
);
assert.equal(
  normalizeVehicleKey("", "El VIN", 80, TestHttpsError, true),
  null
);
const withoutVin = normalizeVehicleInput({
  clienteId: "cliente-1",
  patente: "EFGH22",
  vin: "",
  marca: "Kia",
  modelo: "Rio",
  anio: 2022,
  color: "Rojo",
  tipo: "hatchback",
}, TestHttpsError);
assert.equal(withoutVin.vin, null);
console.log("OK identificadores: patente canónica y VIN opcional");

assert.deepEqual(VEHICLE_TYPES, [
  "sedan",
  "hatchback",
  "suv",
  "pickup",
  "station_wagon",
  "furgon",
  "van",
  "coupe",
  "convertible",
  "otro",
]);
for (const tipo of VEHICLE_TYPES) {
  assert.equal(normalizeVehicleInput({
    clienteId: "cliente-1",
    patente: `TIPO${VEHICLE_TYPES.indexOf(tipo)}`,
    marca: "Marca",
    modelo: "Modelo",
    anio: 2020,
    color: "Color",
    tipo,
  }, TestHttpsError).tipo, tipo);
}
assert.throws(
  () => normalizeVehicleInput({
    clienteId: "cliente-1",
    patente: "VALID1",
    marca: "Marca",
    modelo: "Modelo",
    anio: 2020,
    color: "Color",
    tipo: "motocicleta",
  }, TestHttpsError),
  (error) => error.code === "invalid-argument" && /tipo de vehículo/i.test(error.message)
);
console.log("OK tipo: acepta exclusivamente el catálogo definitivo");

const requiredBase = {
  clienteId: "cliente-1",
  patente: "VALID1",
  marca: "Marca",
  modelo: "Modelo",
  anio: 2020,
  color: "Color",
  tipo: "sedan",
};
for (const field of ["clienteId", "patente", "marca", "modelo", "color", "tipo"]) {
  assert.throws(
    () => normalizeVehicleInput({...requiredBase, [field]: ""}, TestHttpsError),
    (error) => error.code === "invalid-argument"
  );
}
for (const anio of [2020.5, "2020", 0, 10000]) {
  assert.throws(
    () => normalizeVehicleInput({...requiredBase, anio}, TestHttpsError),
    (error) => error.code === "invalid-argument" && /entero válido/i.test(error.message)
  );
}
for (const [field, value] of [["marca", "Toyota 2"], ["color", "Azul 2"]]) {
  assert.throws(
    () => normalizeVehicleInput({...requiredBase, [field]: value}, TestHttpsError),
    (error) => error.code === "invalid-argument" && /solo puede contener texto/i.test(error.message)
  );
}
assert.throws(
  () => normalizeVehicleInput({...requiredBase, negocioId: "otro"}, TestHttpsError),
  (error) => error.code === "invalid-argument" && /no está admitido/i.test(error.message)
);
assert.throws(
  () => normalizeVehicleInput(
    {...requiredBase, clienteId: undefined},
    TestHttpsError,
    {includeOwner: false}
  ),
  (error) => error.code === "invalid-argument" && /clienteId.*no está admitido/i.test(error.message)
);
console.log("OK validación: patente, texto, obligatorios, año y campos mutables están acotados");

console.log("VEHICLE_MODEL_SMOKE_OK");
