import * as XLSX from "xlsx";

const TEMPLATE_FILENAME = "plantilla_inventario_valoracloud.xlsx";
const CSV_FALLBACK_FILENAME = "plantilla_inventario_valoracloud.csv";

const TEMPLATE_COLUMNS = [
  "tipoItem",
  "nombre",
  "categoria",
  "unidad",
  "costoBase",
  "margenDeseado",
  "precioInterno",
  "codigoSku",
  "estado",
  "descripcion",
];

const TEMPLATE_ROWS = [
  {
    tipoItem: "servicio",
    nombre: "Formateo e instalación de Windows",
    categoria: "Sistemas operativos",
    unidad: "servicio",
    costoBase: 38000,
    margenDeseado: 45,
    precioInterno: 0,
    codigoSku: "DEMO-TI-SO-001",
    estado: "activo",
    descripcion: "Instalación limpia de Windows y configuración inicial.",
  },
  {
    tipoItem: "producto",
    nombre: "Cableado UTP",
    categoria: "Redes y conectividad",
    unidad: "metro",
    costoBase: 650,
    margenDeseado: 55,
    precioInterno: 0,
    codigoSku: "DEMO-TI-RED-005",
    estado: "activo",
    descripcion: "Cable UTP por metro para instalaciones de red local.",
  },
  {
    tipoItem: "actividad",
    nombre: "Levantamiento de requerimientos",
    categoria: "Desarrollo web y software",
    unidad: "hora",
    costoBase: 18000,
    margenDeseado: 50,
    precioInterno: 0,
    codigoSku: "DEMO-TI-ACT-001",
    estado: "activo",
    descripcion: "Sesión inicial para definir alcance y requerimientos.",
  },
];

const COLUMN_WIDTHS = {
  tipoItem: 14,
  nombre: 36,
  categoria: 28,
  unidad: 14,
  costoBase: 14,
  margenDeseado: 16,
  precioInterno: 16,
  codigoSku: 18,
  estado: 12,
  descripcion: 58,
};

const INSTRUCTION_ROWS = [
  ["Plantilla de inventario ValoraCloud"],
  [""],
  ["Columnas obligatorias", "tipoItem, nombre, categoria, unidad, costoBase, margenDeseado"],
  ["Columnas opcionales", "precioInterno, codigoSku, estado, descripcion"],
  ["tipoItem acepta", "producto, servicio, actividad"],
  ["estado acepta", "activo, inactivo"],
  [
    "precioInterno",
    "Puede quedar en 0 para que el sistema lo calcule según costoBase y margenDeseado.",
  ],
  [""],
  [
    "Uso recomendado",
    "Completa una fila por producto, servicio o actividad. Conserva los nombres de columnas de la hoja Inventario.",
  ],
];

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadCsvFallback() {
  const rows = [
    TEMPLATE_COLUMNS,
    ...TEMPLATE_ROWS.map((row) =>
      TEMPLATE_COLUMNS.map((column) => row[column] ?? "")
    ),
  ];
  const csv = rows
    .map((row) =>
      row
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, CSV_FALLBACK_FILENAME);
}

export function descargarPlantillaInventario() {
  try {
    const worksheet = XLSX.utils.json_to_sheet(TEMPLATE_ROWS, {
      header: TEMPLATE_COLUMNS,
    });
    worksheet["!cols"] = TEMPLATE_COLUMNS.map((column) => ({
      wch: COLUMN_WIDTHS[column] || Math.max(column.length + 2, 16),
    }));
    worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };

    const instructionsSheet = XLSX.utils.aoa_to_sheet(INSTRUCTION_ROWS);
    instructionsSheet["!cols"] = [{ wch: 24 }, { wch: 92 }];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Inventario");
    XLSX.utils.book_append_sheet(workbook, instructionsSheet, "Instrucciones");
    XLSX.writeFile(workbook, TEMPLATE_FILENAME);
  } catch (error) {
    console.error("No se pudo generar la plantilla Excel:", error);
    downloadCsvFallback();
  }
}
