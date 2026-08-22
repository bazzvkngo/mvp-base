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
]);

export const BUSINESS_ROLE_LABELS = Object.freeze({
  OWNER: "Propietario",
  ADMIN: "Administrador",
  VENTAS: "Ventas",
  COMPRAS: "Compras",
  TECNICO: "Técnico",
  FINANZAS: "Finanzas",
  MEMBER: "Miembro (legacy)",
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

export function normalizeBusinessRole(role) {
  return String(role || "").trim().toUpperCase();
}

export function isBusinessRole(role) {
  return BUSINESS_ROLES.includes(normalizeBusinessRole(role));
}

export function hasBusinessPermission(role, permission) {
  return (permissionsByRole[normalizeBusinessRole(role)] || []).includes(permission);
}

export function canAccessBusinessPath(role, pathname) {
  const match = routePermissions.find(([pattern]) => pattern.test(pathname));
  return Boolean(match && hasBusinessPermission(role, match[1]));
}

export function getDefaultBusinessPath(role) {
  const normalizedRole = normalizeBusinessRole(role);
  if (normalizedRole === "VENTAS") return "/cotizaciones";
  if (normalizedRole === "COMPRAS") return "/compras";
  if (normalizedRole === "TECNICO") return "/trabajos";
  if (normalizedRole === "FINANZAS") return "/reportes";
  return "/cotizaciones";
}

export function filterNavigationSections(sections, role) {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canAccessBusinessPath(role, item.to)),
    }))
    .filter((section) => section.items.length > 0);
}
