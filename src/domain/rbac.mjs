export const BUSINESS_ROLES = Object.freeze([
  "OWNER",
  "ADMIN",
  "VENTAS",
  "COMPRAS",
  "TECNICO",
  "FINANZAS",
  "MEMBER",
]);

export const ASSIGNABLE_BUSINESS_ROLES = Object.freeze([
  "ADMIN",
  "VENTAS",
  "COMPRAS",
  "TECNICO",
  "FINANZAS",
  "MEMBER",
]);

export const BUSINESS_ROLE_LABELS = Object.freeze({
  OWNER: "Propietario",
  ADMIN: "Administrador",
  VENTAS: "Ventas",
  COMPRAS: "Compras",
  TECNICO: "Técnico",
  FINANZAS: "Finanzas",
  MEMBER: "Colaborador",
});

export const BUSINESS_MODULES = Object.freeze([
  "reportes",
  "trabajos",
  "inventario",
  "clientes",
  "cotizaciones",
  "ventas",
  "proveedores",
  "ordenes_compra",
  "recepciones",
  "compras",
  "empresa",
  "empleados",
]);

export const BUSINESS_MODULE_LABELS = Object.freeze({
  reportes: "Inicio / Reportes",
  trabajos: "Proyectos y trabajos",
  inventario: "Inventario",
  clientes: "Clientes",
  cotizaciones: "Cotizaciones",
  ventas: "Ventas",
  proveedores: "Proveedores",
  ordenes_compra: "Órdenes de compra",
  recepciones: "Recepciones",
  compras: "Compras",
  empresa: "Empresa",
  empleados: "Empleados",
});

export const BUSINESS_PERMISSIONS = Object.freeze({
  DASHBOARD_READ: "dashboard.read",
  CLIENTS_READ: "clients.read",
  CLIENTS_WRITE: "clients.write",
  QUOTES_READ: "quotes.read",
  QUOTES_WRITE: "quotes.write",
  SALES_READ: "sales.read",
  SALES_WRITE: "sales.write",
  PROVIDERS_READ: "providers.read",
  PROVIDERS_WRITE: "providers.write",
  PURCHASES_READ: "purchases.read",
  PURCHASES_WRITE: "purchases.write",
  INVENTORY_READ: "inventory.read",
  INVENTORY_WRITE: "inventory.write",
  INVENTORY_COSTS_READ: "inventory.costs.read",
  WORKS_READ: "works.read",
  WORKS_MANAGE: "works.manage",
  WORKS_OPERATE: "works.operate",
  REPORTS_READ: "reports.read",
  PROFITABILITY_READ: "profitability.read",
  FINANCE_READ: "finance.read",
  FINANCE_WRITE: "finance.write",
  REFERENCES_READ: "references.read",
  REFERENCES_WRITE: "references.write",
  PRICING_READ: "pricing.read",
  COMPANY_READ: "company.read",
  COMPANY_WRITE: "company.write",
  MEMBERS_READ: "members.read",
  MEMBERS_MANAGE: "members.manage",
  ACCOUNT_READ: "account.read",
});

const P = BUSINESS_PERMISSIONS;
const ALL_PERMISSIONS = Object.freeze(Object.values(P));
const permissionsByRole = Object.freeze({
  OWNER: ALL_PERMISSIONS,
  ADMIN: ALL_PERMISSIONS.filter((permission) => permission !== P.MEMBERS_MANAGE),
  VENTAS: [P.DASHBOARD_READ, P.CLIENTS_READ, P.CLIENTS_WRITE, P.QUOTES_READ,
    P.QUOTES_WRITE, P.SALES_READ, P.SALES_WRITE, P.INVENTORY_READ,
    P.REFERENCES_READ, P.PRICING_READ, P.ACCOUNT_READ],
  COMPRAS: [P.DASHBOARD_READ, P.PROVIDERS_READ, P.PROVIDERS_WRITE,
    P.PURCHASES_READ, P.PURCHASES_WRITE, P.INVENTORY_READ, P.INVENTORY_WRITE,
    P.INVENTORY_COSTS_READ, P.REFERENCES_READ, P.ACCOUNT_READ],
  TECNICO: [P.DASHBOARD_READ, P.INVENTORY_READ, P.WORKS_READ, P.WORKS_OPERATE,
    P.ACCOUNT_READ],
  FINANZAS: [P.DASHBOARD_READ, P.SALES_READ, P.PURCHASES_READ, P.INVENTORY_READ,
    P.INVENTORY_COSTS_READ, P.REPORTS_READ, P.PROFITABILITY_READ,
    P.FINANCE_READ, P.FINANCE_WRITE, P.ACCOUNT_READ],
  // MEMBER conserva lectura histórica y operación técnica propia, sin permisos nuevos.
  MEMBER: [P.DASHBOARD_READ, P.CLIENTS_READ, P.QUOTES_READ, P.SALES_READ,
    P.PROVIDERS_READ, P.PURCHASES_READ, P.INVENTORY_READ, P.INVENTORY_COSTS_READ,
    P.WORKS_READ, P.WORKS_OPERATE, P.REPORTS_READ, P.FINANCE_READ,
    P.REFERENCES_READ, P.PRICING_READ, P.COMPANY_READ, P.MEMBERS_READ,
    P.ACCOUNT_READ],
});

const permissionsByModule = Object.freeze({
  reportes: [P.DASHBOARD_READ, P.REPORTS_READ, P.CLIENTS_READ, P.QUOTES_READ,
    P.SALES_READ, P.PROVIDERS_READ, P.PURCHASES_READ, P.INVENTORY_READ,
    P.WORKS_READ, P.FINANCE_READ],
  trabajos: [P.DASHBOARD_READ, P.WORKS_READ, P.WORKS_OPERATE],
  inventario: [P.DASHBOARD_READ, P.INVENTORY_READ],
  clientes: [P.DASHBOARD_READ, P.CLIENTS_READ],
  cotizaciones: [P.DASHBOARD_READ, P.QUOTES_READ, P.INVENTORY_READ,
    P.CLIENTS_READ, P.REFERENCES_READ, P.PRICING_READ],
  ventas: [P.DASHBOARD_READ, P.SALES_READ],
  proveedores: [P.DASHBOARD_READ, P.PROVIDERS_READ],
  ordenes_compra: [P.DASHBOARD_READ, P.PURCHASES_READ, P.PROVIDERS_READ,
    P.INVENTORY_READ],
  recepciones: [P.DASHBOARD_READ, P.PURCHASES_READ, P.INVENTORY_READ],
  compras: [P.DASHBOARD_READ, P.PURCHASES_READ, P.INVENTORY_READ],
  empresa: [P.DASHBOARD_READ, P.COMPANY_READ],
  empleados: [P.DASHBOARD_READ, P.MEMBERS_READ],
});

const modulePaths = Object.freeze({
  reportes: "/reportes",
  trabajos: "/trabajos",
  inventario: "/inventario",
  clientes: "/clientes",
  cotizaciones: "/cotizaciones",
  ventas: "/ventas",
  proveedores: "/proveedores",
  ordenes_compra: "/ordenes-compra",
  recepciones: "/recepciones",
  compras: "/compras",
  empresa: "/empresa",
  empleados: "/empleados",
});

const routePermissions = Object.freeze([
  [/^\/(dashboard|resumen)\/?$/, P.DASHBOARD_READ],
  [/^\/clientes(?:\/|$)/, P.CLIENTS_READ],
  [/^\/cotizaciones(?:\/|$)/, P.QUOTES_READ],
  [/^\/ventas(?:\/|$)/, P.SALES_READ],
  [/^\/proveedores(?:\/|$)/, P.PROVIDERS_READ],
  [/^\/(ordenes-compra|recepciones|compras)(?:\/|$)/, P.PURCHASES_READ],
  [/^\/inventario(?:\/|$)/, P.INVENTORY_READ],
  [/^\/trabajos(?:\/|$)/, P.WORKS_READ],
  [/^\/(reportes|estadisticas)(?:\/|$)/, P.REPORTS_READ],
  [/^\/finanzas(?:\/|$)/, P.FINANCE_READ],
  [/^\/valorizacion(?:\/|$)/, P.PRICING_READ],
  [/^\/(referencias|tareas-referencias)(?:\/|$)/, P.REFERENCES_READ],
  [/^\/empresa(?:\/|$)/, P.COMPANY_READ],
  [/^\/empleados(?:\/|$)/, P.MEMBERS_READ],
  [/^\/cuenta(?:\/|$)/, P.ACCOUNT_READ],
]);

const routeModules = Object.freeze([
  [/^\/(dashboard|resumen)\/?$/, "reportes"],
  [/^\/clientes(?:\/|$)/, "clientes"],
  [/^\/cotizaciones(?:\/|$)/, "cotizaciones"],
  [/^\/ventas(?:\/|$)/, "ventas"],
  [/^\/proveedores(?:\/|$)/, "proveedores"],
  [/^\/ordenes-compra(?:\/|$)/, "ordenes_compra"],
  [/^\/recepciones(?:\/|$)/, "recepciones"],
  [/^\/compras(?:\/|$)/, "compras"],
  [/^\/inventario(?:\/|$)/, "inventario"],
  [/^\/trabajos(?:\/|$)/, "trabajos"],
  [/^\/(reportes|estadisticas)(?:\/|$)/, "reportes"],
  [/^\/empresa(?:\/|$)/, "empresa"],
  [/^\/empleados(?:\/|$)/, "empleados"],
]);

export function normalizeBusinessRole(role) {
  return String(role || "").trim().toUpperCase();
}

export function isBusinessRole(role) {
  return BUSINESS_ROLES.includes(normalizeBusinessRole(role));
}

function normalizeBusinessAccess(access) {
  if (typeof access === "string") return {role: normalizeBusinessRole(access), modules: null};
  const profileId = String(access?.profileId || access?.perfilId || "").trim();
  const modules = profileId
    ? [...new Set((access?.modules || access?.modulos || [])
      .map((moduleId) => String(moduleId || "").trim())
      .filter((moduleId) => BUSINESS_MODULES.includes(moduleId)))]
    : null;
  return {role: normalizeBusinessRole(access?.role || access?.rol), modules};
}

export function hasBusinessPermission(access, permission) {
  const normalized = normalizeBusinessAccess(access);
  if (!normalized.modules) {
    return (permissionsByRole[normalized.role] || []).includes(permission);
  }
  if (permission === P.ACCOUNT_READ) return true;
  return normalized.modules.some((moduleId) =>
    (permissionsByModule[moduleId] || []).includes(permission)
  );
}

export function canAccessBusinessPath(access, pathname) {
  const normalized = normalizeBusinessAccess(access);
  if (normalized.modules) {
    if (/^\/cuenta(?:\/|$)/.test(pathname)) return true;
    const moduleMatch = routeModules.find(([pattern]) => pattern.test(pathname));
    return Boolean(moduleMatch && normalized.modules.includes(moduleMatch[1]));
  }
  const match = routePermissions.find(([pattern]) => pattern.test(pathname));
  return Boolean(match && hasBusinessPermission(normalized.role, match[1]));
}

export function getDefaultBusinessPath(access) {
  const normalized = normalizeBusinessAccess(access);
  if (normalized.modules) {
    const firstModule = BUSINESS_MODULES.find((moduleId) => normalized.modules.includes(moduleId));
    return modulePaths[firstModule] || "/cuenta";
  }
  const normalizedRole = normalized.role;
  if (["OWNER", "ADMIN", "FINANZAS"].includes(normalizedRole)) return "/reportes";
  if (normalizedRole === "VENTAS") return "/cotizaciones";
  if (normalizedRole === "COMPRAS") return "/ordenes-compra";
  if (normalizedRole === "TECNICO") return "/trabajos";
  return "/cotizaciones";
}

export function filterNavigationSections(sections, access) {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canAccessBusinessPath(access, item.to)),
    }))
    .filter((section) => section.items.length > 0);
}
