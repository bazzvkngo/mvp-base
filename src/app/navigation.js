import {
  BadgeDollarSign,
  BookOpenCheck,
  Boxes,
  Building2,
  ClipboardCheck,
  FilePlus2,
  History,
  LayoutDashboard,
} from "lucide-react";

export const navigationSections = [
  {
    label: "General",
    items: [
      {
        to: "/dashboard",
        label: "Dashboard",
        title: "Dashboard",
        icon: LayoutDashboard,
      },
    ],
  },
  {
    label: "Gestión",
    items: [
      {
        to: "/empresa",
        label: "Empresa",
        title: "Configuración de empresa",
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
        label: "Historial",
        title: "Historial de cotizaciones",
        icon: History,
      },
    ],
  },
];

const navigationItems = navigationSections.flatMap((section) => section.items);

export function getRouteMeta(pathname) {
  if (/^\/cotizaciones\/[^/]+\/editar$/.test(pathname)) {
    return { title: "Editar cotización" };
  }

  return (
    navigationItems.find((item) => item.to === pathname) || {
      title: "ValoraCloud",
    }
  );
}
