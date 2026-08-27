"use strict";

const BUSINESS_ROLES = Object.freeze([
  "OWNER", "ADMIN", "VENTAS", "COMPRAS", "TECNICO", "FINANZAS", "MEMBER",
]);
const ASSIGNABLE_BUSINESS_ROLES = Object.freeze([
  "ADMIN", "VENTAS", "COMPRAS", "TECNICO", "FINANZAS", "MEMBER",
]);
const BUSINESS_MODULES = Object.freeze([
  "reportes", "trabajos", "inventario", "clientes", "cotizaciones", "ventas",
  "proveedores", "ordenes_compra", "recepciones", "compras", "empresa", "empleados",
]);
const OWNER_ROLES = Object.freeze(["OWNER"]);
const BUSINESS_MANAGEMENT_ROLES = Object.freeze(["OWNER", "ADMIN"]);
const SALES_WRITE_ROLES = Object.freeze(["OWNER", "ADMIN", "VENTAS"]);
const PURCHASE_WRITE_ROLES = Object.freeze(["OWNER", "ADMIN", "COMPRAS"]);
const INVENTORY_WRITE_ROLES = PURCHASE_WRITE_ROLES;
const WORK_MANAGEMENT_ROLES = BUSINESS_MANAGEMENT_ROLES;
const WORK_OPERATION_ROLES = Object.freeze(["OWNER", "ADMIN", "TECNICO", "MEMBER"]);
const FINANCE_WRITE_ROLES = Object.freeze(["OWNER", "ADMIN", "FINANZAS"]);
const BALANCE_READ_ROLES = FINANCE_WRITE_ROLES;

module.exports = {
  ASSIGNABLE_BUSINESS_ROLES,
  BALANCE_READ_ROLES,
  BUSINESS_MANAGEMENT_ROLES,
  BUSINESS_MODULES,
  BUSINESS_ROLES,
  FINANCE_WRITE_ROLES,
  INVENTORY_WRITE_ROLES,
  OWNER_ROLES,
  PURCHASE_WRITE_ROLES,
  SALES_WRITE_ROLES,
  WORK_MANAGEMENT_ROLES,
  WORK_OPERATION_ROLES,
};
