export const userDocPath = (userId) => ["usuarios", userId];
export const userConfigDocPath = (userId) => [
  "usuarios",
  userId,
  "config",
  "negocio",
];
export const companyProfileDocPath = (userId) => [
  "usuarios",
  userId,
  "empresa",
  "perfil",
];
export const inventoryCollectionPath = (userId) => [
  "usuarios",
  userId,
  "inventario",
];
export const inventoryDocPath = (userId, itemId) => [
  "usuarios",
  userId,
  "inventario",
  itemId,
];
export const referencesCollectionPath = (userId) => [
  "usuarios",
  userId,
  "referencias",
];
export const referenceDocPath = (userId, referenceId) => [
  "usuarios",
  userId,
  "referencias",
  referenceId,
];
export const quotesCollectionPath = (userId) => [
  "usuarios",
  userId,
  "cotizaciones",
];
export const quoteDocPath = (userId, quoteId) => [
  "usuarios",
  userId,
  "cotizaciones",
  quoteId,
];
export const referenceTasksCollectionPath = (userId) => [
  "usuarios",
  userId,
  "tareasReferencias",
];
export const referenceTaskDocPath = (userId, taskId) => [
  "usuarios",
  userId,
  "tareasReferencias",
  taskId,
];
