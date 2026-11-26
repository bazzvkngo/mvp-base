import {
  BarChart3,
  Boxes,
  Building2,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  BriefcaseBusiness,
  Car,
  HeartPulse,
  LayoutDashboard,
  History,
  PawPrint,
  ReceiptText,
  PackageCheck,
  UserRound,
  UsersRound,
  Truck,
  ShoppingCart,
  Puzzle,
  Warehouse,
} from "lucide-react";
import { BUSINESS_PERMISSIONS } from "../domain/rbac.mjs";
import { VERTICAL_MODULES } from "../domain/verticalModules.mjs";

const verticalNavigationItems = Object.freeze({
  taller: Object.freeze([
    // path "" = la ruta base del módulo (panel del taller), con coincidencia exacta. `section` lo ubica al
    // comienzo de esa sección del Core (junto a Reportes) cuando Taller es el módulo del rubro.
    {path: "", label: "Panel del taller", title: "Panel del taller", icon: LayoutDashboard, section: "Inicio"},
    {path: "ordenes", label: "Órdenes de trabajo", title: "Órdenes de trabajo", icon: ClipboardList},
    {path: "vehiculos", label: "Vehículos", title: "Vehículos", icon: Car},
    {
      path: "plazas",
      label: "Plazas",
      title: "Plazas",
      icon: Warehouse,
      requiredPermission: BUSINESS_PERMISSIONS.TALLER_MANAGE,
    },
  ]),
  // path "" = la ruta base del módulo (Resumen clínico), con coincidencia exacta. Igual que el panel del taller,
  // `section` lo ubica al comienzo de «Inicio» cuando Veterinaria es el módulo del rubro.
  veterinaria: Object.freeze([
    {path: "", label: "Resumen clínico", title: "Resumen clínico", icon: HeartPulse, section: "Inicio"},
    {path: "pacientes", label: "Pacientes", title: "Pacientes", icon: PawPrint},
    {path: "ordenes", label: "Órdenes de atención", title: "Órdenes de atención", icon: ClipboardList},
    {path: "agenda", label: "Agenda", title: "Agenda", icon: CalendarDays},
  ]),
});

export const navigationSections = [
  {
    label: "Inicio",
    items: [
      {
        to: "/reportes",
        label: "Reportes",
        title: "Reportes",
        icon: BarChart3,
      },
    ],
  },
  {
    label: "Comercial",
    items: [
      {
        to: "/clientes",
        label: "Clientes",
        title: "Clientes",
        icon: UsersRound,
      },
      {
        to: "/cotizaciones",
        label: "Cotizaciones",
        title: "Cotizaciones",
        icon: History,
        activeWhen: (pathname) =>
          pathname === "/cotizaciones" || pathname.startsWith("/cotizaciones/"),
      },
      {
        to: "/ventas",
        label: "Ventas",
        title: "Ventas",
        icon: ReceiptText,
        activeWhen: (pathname) =>
          pathname === "/ventas" || pathname.startsWith("/ventas/"),
      },
    ],
  },
  {
    label: "Operación",
    items: [
      {
        to: "/trabajos",
        label: "Proyectos y trabajos",
        title: "Proyectos y trabajos",
        icon: BriefcaseBusiness,
      },
      {
        to: "/inventario",
        label: "Inventario",
        title: "Inventario",
        icon: Boxes,
      },
    ],
  },
  {
    label: "Abastecimiento",
    items: [
      {
        to: "/proveedores",
        label: "Proveedores",
        title: "Proveedores",
        icon: Truck,
      },
      {
        to: "/ordenes-compra",
        label: "Órdenes de compra",
        title: "Órdenes de compra",
        icon: ClipboardCheck,
        activeWhen: (pathname) =>
          pathname === "/ordenes-compra" ||
          pathname.startsWith("/ordenes-compra/"),
      },
      {
        to: "/recepciones",
        label: "Recepciones",
        title: "Recepciones",
        icon: PackageCheck,
        activeWhen: (pathname) =>
          pathname === "/recepciones" || pathname.startsWith("/recepciones/"),
      },
      {
        to: "/compras",
        label: "Compras",
        title: "Compras",
        icon: ShoppingCart,
        activeWhen: (pathname) =>
          pathname === "/compras" || pathname.startsWith("/compras/"),
      },
    ],
  },
  {
    label: "Gestión",
    items: [
      {
        to: "/empresa",
        label: "Empresa",
        title: "Empresa",
        icon: Building2,
      },
      {
        to: "/empleados",
        label: "Empleados",
        title: "Empleados",
        description: "Quiénes tienen acceso a tu negocio y con qué perfil.",
        icon: UsersRound,
      },
    ],
  },
  {
    label: "Cuenta",
    items: [
      {
        to: "/cuenta",
        label: "Mi cuenta",
        title: "Cuenta",
        icon: UserRound,
      },
    ],
  },
];

// Los módulos verticales se declaran desde el registro y se agrupan bajo
// "Módulos", antes de "Cuenta". Solo se muestran los habilitados (el filtro lo
// aplica filterNavigationSections con enabledModules). Con el registro vacío
// devuelve las secciones del Core sin cambios.
//
// Opt-in (SPEC 041, que sustituye el diseño de la SPEC 037): con `primaryModules` (ids de
// getPrimaryVerticalModules) el módulo del rubro del negocio sale de "Módulos" y sus ítems
// (planos, sin el nivel anidado) se insertan en "Operación", antes de Inventario. No hay sección
// propia del rubro. Si "Módulos" queda vacío se omite. Sin la opción (o con lista vacía) la salida
// es la de siempre.
function buildModuleChildren({id, basePath}) {
  return (verticalNavigationItems[id] || []).map(({path, ...item}) => {
    const to = path ? `${basePath}/${path}` : basePath;
    return {
      ...item,
      to,
      // Sin path es la ruta base: coincide solo con ella para no quedar activa en las hijas.
      activeWhen: path
        ? (pathname) => pathname === to || pathname.startsWith(`${to}/`)
        : (pathname) => pathname === to || pathname === `${to}/`,
    };
  });
}

function buildModuleEntry(module) {
  const {label, basePath} = module;
  return {
    to: basePath,
    label,
    title: label,
    icon: Puzzle,
    children: buildModuleChildren(module),
    activeWhen: (pathname) =>
      pathname === basePath || pathname.startsWith(`${basePath}/`),
  };
}

// Ítems del módulo del rubro para "Operación": sus hijos planos. Un módulo sin ítems declarados
// aporta un solo enlace a su ruta base.
function buildPrimaryModuleItems(module) {
  const children = buildModuleChildren(module);
  return children.length ? children : [{
    to: module.basePath,
    label: module.label,
    title: module.label,
    icon: Puzzle,
    activeWhen: (pathname) =>
      pathname === module.basePath || pathname.startsWith(`${module.basePath}/`),
  }];
}

const OPERATION_SECTION_LABEL = "Operación";
const INVENTORY_PATH = "/inventario";

// SPEC 041: inserta los ítems del módulo del rubro en "Operación", antes de Inventario (al final
// si Inventario no está). El Core declara "Operación" siempre; no se crea otra sección ni se duplica.
// Un ítem con `section` va al comienzo de esa sección del Core (p. ej. el panel del taller en «Inicio»).
function withPrimaryModuleItems(sections, primaryItems) {
  if (!primaryItems.length) return sections;
  const sectionLabels = new Set(sections.map((section) => section.label));
  const placed = primaryItems.filter((item) => item.section && sectionLabels.has(item.section));
  const operation = primaryItems.filter((item) => !placed.includes(item));
  return sections.map((section) => {
    const leading = placed.filter((item) => item.section === section.label);
    if (section.label !== OPERATION_SECTION_LABEL) {
      return leading.length ? {...section, items: [...leading, ...section.items]} : section;
    }
    const inventoryIndex = section.items.findIndex((item) => item.to === INVENTORY_PATH);
    const at = inventoryIndex === -1 ? section.items.length : inventoryIndex;
    return {...section, items: [...leading, ...section.items.slice(0, at), ...operation, ...section.items.slice(at)]};
  });
}

// Opt-in (SPEC 038): con `hiddenCorePaths` (rutas de getHiddenCorePaths) se quitan del Core los
// ítems cuyo `to` esté en la lista, y se omite la sección que quede vacía. Solo cambia el menú:
// la ruta sigue existiendo. Sin la opción (o con lista vacía) la salida es la de siempre.
function withoutHiddenCoreItems(sections, hiddenCorePaths) {
  const hidden = new Set(Array.isArray(hiddenCorePaths) ? hiddenCorePaths : []);
  if (!hidden.size) return sections;
  return sections
    .map((section) => ({...section, items: section.items.filter((item) => !hidden.has(item.to))}))
    .filter((section) => section.items.length > 0);
}

export function buildNavigationSections(registry = VERTICAL_MODULES, {primaryModules = [], hiddenCorePaths = []} = {}) {
  if (!registry.length) return withoutHiddenCoreItems(navigationSections, hiddenCorePaths);
  const primaryIds = new Set(Array.isArray(primaryModules) ? primaryModules : []);
  const primary = registry.filter((module) => primaryIds.has(module.id));
  const rest = registry.filter((module) => !primaryIds.has(module.id));
  const modulesSections = rest.length ?
    [{label: "Módulos", items: rest.map(buildModuleEntry)}] :
    [];
  const primaryItems = primary.flatMap(buildPrimaryModuleItems);
  const coreSections = withoutHiddenCoreItems(withPrimaryModuleItems(navigationSections, primaryItems), hiddenCorePaths).flatMap((section) =>
    section.label === "Cuenta" ? [...modulesSections, section] : [section]
  );
  return coreSections;
}

const navigationItems = buildNavigationSections().flatMap((section) =>
  section.items.flatMap((item) => [item, ...(item.children || [])])
);
const hiddenRouteMeta = Object.freeze({
  "/finanzas": { title: "Finanzas" },
  "/valorizacion": { title: "Valorización" },
});

// Rutas cuya página dibuja su propio h1 (ModuleHeader o cabecera propia). En ellas la barra
// superior muestra solo el negocio activo; en las demás, eyebrow + título (ui/PageHeader).
// Coincidencia exacta: las rutas hijas (/nueva, /:id/editar...) conservan el título de la barra.
export const PAGE_HEADING_ROUTES = Object.freeze([
  "/reportes",
  "/clientes",
  "/ventas",
  "/proveedores",
  "/ordenes-compra",
  "/recepciones",
  "/compras",
  "/empresa",
  "/empleados",
]);

export function routeProvidesPageHeading(pathname) {
  return PAGE_HEADING_ROUTES.includes(pathname);
}

export function getRouteMeta(pathname) {
  if (pathname === "/resumen") {
    return { title: "Resumen" };
  }
  if (pathname === "/cotizaciones/nueva") {
    return { title: "Nueva cotización" };
  }
  if (pathname === "/ventas/nueva") {
    return { title: "Nueva venta" };
  }
  if (pathname === "/compras/nueva") {
    return { title: "Nueva compra" };
  }
  if (/^\/recepciones\/[^/]+\/editar$/.test(pathname)) {
    return { title: "Editar recepción" };
  }
  if (/^\/recepciones\/[^/]+$/.test(pathname)) {
    return { title: "Ver recepción" };
  }
  if (pathname === "/ordenes-compra/nueva") {
    return { title: "Nueva orden de compra" };
  }
  if (/^\/cotizaciones\/[^/]+\/editar$/.test(pathname)) {
    return { title: "Editar cotización" };
  }
  if (/^\/ordenes-compra\/[^/]+\/editar$/.test(pathname)) {
    return { title: "Editar orden de compra" };
  }
  if (/^\/ordenes-compra\/[^/]+$/.test(pathname)) {
    return { title: "Ver orden de compra" };
  }
  if (/^\/compras\/[^/]+\/editar$/.test(pathname)) {
    return { title: "Editar compra" };
  }
  if (/^\/compras\/[^/]+$/.test(pathname)) {
    return { title: "Ver compra" };
  }
  if (/^\/ventas\/[^/]+\/editar$/.test(pathname)) {
    return { title: "Editar venta" };
  }
  if (/^\/ventas\/[^/]+$/.test(pathname)) {
    return { title: "Ver venta" };
  }

  const exactMeta = navigationItems.find((item) => item.to === pathname) || hiddenRouteMeta[pathname];
  if (exactMeta) return exactMeta;

  // Subpantallas de Veterinaria (paciente nuevo/ficha/edición, cita, atención): sin título propio,
  // la barra muestra el nombre del módulo en vez de la marca.
  const veterinary = VERTICAL_MODULES.find((module) => module.id === "veterinaria");
  if (veterinary && pathname.startsWith(`${veterinary.basePath}/`)) {
    return { title: veterinary.label };
  }

  return { title: "ValoraCloud" };
}
