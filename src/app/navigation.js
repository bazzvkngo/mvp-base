import {
  BadgeDollarSign,
  BarChart3,
  BookOpenCheck,
  Boxes,
  Building2,
  ClipboardCheck,
  History,
  LayoutDashboard,
  UserRound,
  UsersRound,
  WalletCards,
  Truck,
  ShoppingCart,
} from "lucide-react";

export const navigationSections = [
  {
    label: "Inicio",
    items: [
      {
        to: "/dashboard",
        label: "Resumen",
        title: "Resumen",
        icon: LayoutDashboard,
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
        icon: ShoppingCart,
        activeWhen: (pathname) =>
          pathname === "/ventas" || pathname.startsWith("/ventas/"),
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
        icon: ShoppingCart,
        activeWhen: (pathname) =>
          pathname === "/ordenes-compra" ||
          pathname.startsWith("/ordenes-compra/"),
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
    label: "Inventario",
    items: [
      {
        to: "/inventario",
        label: "Inventario",
        title: "Inventario",
        icon: Boxes,
      },
    ],
  },
  {
    label: "Análisis",
    items: [
      {
        to: "/valorizacion",
        label: "Valorización",
        title: "Valorización",
        icon: BadgeDollarSign,
      },
      {
        to: "/referencias",
        label: "Referencias",
        title: "Referencias de mercado",
        icon: BookOpenCheck,
      },
      {
        to: "/tareas-referencias",
        label: "Tareas de referencias",
        title: "Tareas de referencias",
        icon: ClipboardCheck,
      },
      {
        to: "/reportes",
        label: "Reportes",
        title: "Reportes",
        icon: BarChart3,
      },
      {
        to: "/finanzas",
        label: "Finanzas",
        title: "Finanzas",
        icon: WalletCards,
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

const navigationItems = navigationSections.flatMap((section) => section.items);

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
    navigationItems.find((item) => item.to === pathname) || {
      title: "ValoraCloud",
    }
  );
}
