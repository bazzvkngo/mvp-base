// src/utils/pdfCotizacion.js
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

/**
 * Formatea un número como CLP (ej: $1.070.000)
 */
function formatearCLP(valor) {
  const n = Number(valor) || 0;
  return n.toLocaleString("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
  });
}

/**
 * Genera un PDF de cotización a partir de la propuesta local
 * (la que te devuelve generarPropuestaCotizacion).
 *
 * - negocio: datos de la pyme
 * - cliente: datos del cliente
 * - propuesta: objeto devuelto por generarPropuestaCotizacion
 */
export function generarPdfCotizacion({ negocio, cliente, propuesta }) {
  const doc = new jsPDF();

  // ---------------------------------------------------------------------------
  // 1) Encabezado del negocio
  // ---------------------------------------------------------------------------
  const nombreNegocio = negocio?.nombre || "SERVICIOS INTEGRALES";
  const giro = negocio?.giro || "Consultoría y Asesoría Informática";
  const rut = negocio?.rut || "R.U.T.: 77.091.679-8";
  const direccionNegocio =
    negocio?.direccion || "Avenida Tamarugal 2985";
  const ciudadNegocio = negocio?.ciudad || "Iquique, I Región";

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(nombreNegocio, 14, 15);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(giro, 14, 20);
  doc.text(rut, 14, 25);
  doc.text(`DIRECCIÓN: ${direccionNegocio}`, 14, 30);
  doc.text(`CIUDAD: ${ciudadNegocio}`, 14, 35);

  // Fecha y número de cotización (usamos timestamp simple)
  const fecha = new Date();
  const fechaTexto = fecha.toLocaleDateString("es-CL");
  const nroCotizacion =
    negocio?.numeroCotizacion ||
    `${fecha.getFullYear()}${String(fecha.getMonth() + 1).padStart(
      2,
      "0"
    )}${String(fecha.getDate()).padStart(2, "0")}`;

  doc.setFont("helvetica", "bold");
  doc.text("FECHA:", 150, 20);
  doc.setFont("helvetica", "normal");
  doc.text(fechaTexto, 170, 20);

  doc.setFont("helvetica", "bold");
  doc.text("COTIZACIÓN N°:", 150, 26);
  doc.setFont("helvetica", "normal");
  doc.text(String(nroCotizacion).substring(0, 12), 150, 31);

  // ---------------------------------------------------------------------------
  // 2) Bloque de datos del cliente
  // ---------------------------------------------------------------------------
  const nombreCliente = cliente?.nombre || "";
  const direccionCliente = cliente?.direccion || "";
  const ciudadCliente = cliente?.ciudad || "";
  const empresaCliente = cliente?.empresa || "";
  const descripcionProyecto = cliente?.descripcion || "";

  let y = 45;

  doc.setFont("helvetica", "bold");
  doc.setFillColor(0, 51, 102); // azul oscuro
  doc.setTextColor(255, 255, 255);
  doc.rect(14, y - 5, 182, 7, "F");
  doc.text("CLIENTE", 16, y);

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  y += 8;
  doc.text(`CONTACTO: ${nombreCliente}`, 14, y);
  y += 5;
  doc.text(`DIRECCIÓN: ${direccionCliente}`, 14, y);
  y += 5;
  doc.text(`CIUDAD: ${ciudadCliente}`, 14, y);
  y += 5;
  doc.text(`EMPRESA: ${empresaCliente || "S/N"}`, 14, y);
  y += 5;
  doc.text(`DESCRIPCIÓN: ${descripcionProyecto}`, 14, y);

  // ---------------------------------------------------------------------------
  // 3) Tabla de materiales (desde propuesta.materialesSeleccionados)
  // ---------------------------------------------------------------------------
  const materiales = propuesta?.materialesSeleccionados || [];

  const body = materiales.map((item, index) => [
    String(index + 1),
    item.nombre || "",
    item.unidad || "UNIDAD",
    String(item.cantidad || 0),
    formatearCLP(item.precioUnitario || 0),
    formatearCLP(item.subtotal || 0),
  ]);

  const head = [
    ["ITEM", "DESCRIPCIÓN", "MEDIDA", "CANT.", "P. UNIT.", "TOTAL"],
  ];

  const startY = y + 10;

  autoTable(doc, {
    startY,
    head,
    body,
    headStyles: {
      fillColor: [0, 51, 102],
      textColor: 255,
      halign: "center",
    },
    styles: {
      fontSize: 9,
      cellPadding: 2,
    },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 80 },
      2: { cellWidth: 20 },
      3: { cellWidth: 15 },
      4: { cellWidth: 30 },
      5: { cellWidth: 30 },
    },
  });

  // ---------------------------------------------------------------------------
  // 4) Totales
  // ---------------------------------------------------------------------------
  const finalY = doc.lastAutoTable?.finalY || startY + 10;

  const subtotalMateriales = materiales.reduce(
    (acc, m) => acc + (m.subtotal || 0),
    0
  );

  const costoBase = propuesta?.costoBase || 0;
  const precioRecomendado = propuesta?.precioRecomendado || costoBase;
  const precioMin = propuesta?.precioMin || costoBase;
  const precioMax = propuesta?.precioMax || precioRecomendado;

  const xLabel = 120;
  const xValue = 190;

  doc.setFontSize(10);

  doc.setFont("helvetica", "bold");
  doc.text("EQUIPOS Y MATERIALES SUBTOTAL:", xLabel, finalY + 10, {
    align: "right",
  });
  doc.setFont("helvetica", "normal");
  doc.text(formatearCLP(subtotalMateriales), xValue, finalY + 10, {
    align: "right",
  });

  doc.setFont("helvetica", "bold");
  doc.text("TOTAL PROPUESTA:", xLabel, finalY + 16, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.text(formatearCLP(precioRecomendado), xValue, finalY + 16, {
    align: "right",
  });

  doc.setFontSize(8);
  doc.text(
    `Rango referencia: ${formatearCLP(
      precioMin
    )} - ${formatearCLP(precioMax)}`,
    xLabel,
    finalY + 22,
    { align: "right" }
  );

  // ---------------------------------------------------------------------------
  // 5) Guardar / descargar
  // ---------------------------------------------------------------------------
  const nombreArchivo = `Cotizacion_${
    nombreCliente || "cliente"
  }_${fecha.getFullYear()}${String(fecha.getMonth() + 1).padStart(
    2,
    "0"
  )}${String(fecha.getDate()).padStart(2, "0")}.pdf`;

  doc.save(nombreArchivo);
}
