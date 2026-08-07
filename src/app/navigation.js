import {
  BadgeDollarSign,
  BarChart3,
  BookOpenCheck,
  Boxes,
  Building2,
  ClipboardCheck,
  FilePlus2,
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
    label: "Operación",
    items: [
      {
        to: "/dashboard",
        label: "Resumen",
        title: "Resumen",
        icon: LayoutDashboard,
      },
      {
        to: "/finanzas",
        label: "Finanzas",
        title: "Finanzas",
        icon: WalletCards,
      },
      {
        to: "/estadisticas",
        label: "Estadísticas",
        title: "Estadísticas",
        icon: BarChart3,
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
        to: "/inventario",
        label: "Inventario",
        title: "Inventario",
        icon: Boxes,
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
        to: "/proveedores",
        label: "Proveedores",
        title: "Proveedores",
        icon: Truck,
      },
      {
        to: "/valorizacion",
        label: "Valorización",
        title: "Valorización",
        icon: BadgeDollarSign,
      },
      {
        to: "/cotizaciones/nueva",
        label: "Nueva cotización",
        title: "Nueva cotización",
        icon: FilePlus2,
        activeWhen: (pathname) =>
          pathname === "/cotizaciones/nueva" ||
          /^\/cotizaciones\/[^/]+\/editar$/.test(pathname),
      },
      {
        to: "/cotizaciones",
        label: "Cotizaciones",
        title: "Cotizaciones",
        icon: History,
      },
    ],
  },
  {
    label: "Compras",
    items: [
      {
        to: "/compras/nueva",
        label: "Nueva compra",
        title: "Nueva compra",
        icon: FilePlus2,
        activeWhen: (pathname) =>
          pathname === "/compras/nueva" ||
          /^\/compras\/[^/]+\/editar$/.test(pathname),
      },
      {
        to: "/compras",
        label: "Compras",
        title: "Compras",
        icon: ShoppingCart,
        activeWhen: (pathname) =>
          pathname === "/compras" || /^\/compras\/[^/]+$/.test(pathname),
      },
      {
        to: "/ordenes-compra/nueva",
        label: "Nueva orden",
        title: "Nueva orden de compra",
        icon: FilePlus2,
        activeWhen: (pathname) =>
          pathname === "/ordenes-compra/nueva" ||
          /^\/ordenes-compra\/[^/]+\/editar$/.test(pathname),
      },
      {
        to: "/ordenes-compra",
        label: "Órdenes de compra",
        title: "Órdenes de compra",
        icon: ShoppingCart,
        activeWhen: (pathname) =>
          pathname === "/ordenes-compra" ||
          /^\/ordenes-compra\/[^/]+$/.test(pathname),
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

  return (
    navigationItems.find((item) => item.to === pathname) || {
      title: "ValoraCloud",
    }
  );
}
