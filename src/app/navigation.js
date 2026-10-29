import {
  BarChart3,
  Boxes,
  Building2,
  ClipboardCheck,
  BriefcaseBusiness,
  History,
  ReceiptText,
  PackageCheck,
  UserRound,
  UsersRound,
  Truck,
  ShoppingCart,
  Puzzle,
} from "lucide-react";
import { VERTICAL_MODULES } from "../domain/verticalModules.mjs";

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
export function buildNavigationSections(registry = VERTICAL_MODULES) {
  if (!registry.length) return navigationSections;
  const modulesSection = {
    label: "Módulos",
    items: registry.map(({ label, basePath }) => ({
      to: basePath,
      label,
      title: label,
      icon: Puzzle,
      activeWhen: (pathname) =>
        pathname === basePath || pathname.startsWith(`${basePath}/`),
    })),
  };
  return navigationSections.flatMap((section) =>
    section.label === "Cuenta" ? [modulesSection, section] : [section]
  );
}

const navigationItems = buildNavigationSections().flatMap((section) => section.items);
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
    return { title: "Editar recepcion" };
  }
  if (/^\/recepciones\/[^/]+$/.test(pathname)) {
    return { title: "Ver recepcion" };
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

  return (
    navigationItems.find((item) => item.to === pathname) ||
    hiddenRouteMeta[pathname] || {
      title: "ValoraCloud",
    }
  );
}
