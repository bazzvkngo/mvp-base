export const userDocPath = (userId) => ["usuarios", userId];
export const businessDocPath = (businessId) => ["negocios", businessId];
export const userConfigDocPath = (userId) => [
  "negocios",
  userId,
  "config",
  "negocio",
];
export const companyProfileDocPath = (userId) => [
  "negocios",
  userId,
  "empresa",
  "perfil",
];
export const businessSettingsDocPath = (businessId, section) => [
  "negocios",
  businessId,
  "configuracion",
  section,
];
export const personalProfileDocPath = (userId) => [
  "usuarios",
  userId,
  "cuenta",
  "perfil",
];
export const inventoryCollectionPath = (userId) => [
  "negocios",
  userId,
  "inventario",
];
export const inventoryDocPath = (userId, itemId) => [
  "negocios",
  userId,
  "inventario",
  itemId,
];
export const inventoryAreasCollectionPath = (userId) => [
  "negocios",
  userId,
  "areas",
];
export const inventoryCategoriesCollectionPath = (userId) => [
  "negocios",
  userId,
  "categoriasInventario",
];
export const referencesCollectionPath = (userId) => [
  "negocios",
  userId,
  "referencias",
];
export const referenceDocPath = (userId, referenceId) => [
  "negocios",
  userId,
  "referencias",
  referenceId,
];
export const quotesCollectionPath = (userId) => [
  "negocios",
  userId,
  "cotizaciones",
];
export const quoteDocPath = (userId, quoteId) => [
  "negocios",
  userId,
  "cotizaciones",
  quoteId,
];
export const quoteCounterDocPath = (userId, year) => [
  "negocios",
  userId,
  "contadores",
  `cotizaciones_${year}`,
];
export const clientsCollectionPath = (businessId) => [
  "negocios",
  businessId,
  "clientes",
];
export const clientDocPath = (businessId, clienteId) => [
  "negocios",
  businessId,
  "clientes",
  clienteId,
];
export const providersCollectionPath = (businessId) => [
  "negocios",
  businessId,
  "proveedores",
];
export const providerDocPath = (businessId, proveedorId) => [
  "negocios",
  businessId,
  "proveedores",
  proveedorId,
];
export const purchaseOrdersCollectionPath = (businessId) => [
  "negocios",
  businessId,
  "ordenesCompra",
];
export const purchaseOrderDocPath = (businessId, ordenCompraId) => [
  "negocios",
  businessId,
  "ordenesCompra",
  ordenCompraId,
];
export const financialMovementsCollectionPath = (businessId) => [
  "negocios",
  businessId,
  "financialMovements",
];
export const financialMovementDocPath = (businessId, movementId) => [
  "negocios",
  businessId,
  "financialMovements",
  movementId,
];
export const referenceTasksCollectionPath = (userId) => [
  "negocios",
  userId,
  "tareasReferencias",
];
export const referenceTaskDocPath = (userId, taskId) => [
  "negocios",
  userId,
  "tareasReferencias",
  taskId,
];
