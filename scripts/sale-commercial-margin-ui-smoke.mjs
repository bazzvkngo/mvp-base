import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";
import {
  BUSINESS_PERMISSIONS,
  hasBusinessPermission,
} from "../src/domain/rbac.mjs";

const product = (overrides = {}) => ({
  lineaId: "product-1",
  itemId: "inventory-product-1",
  tipoItem: "producto",
  cantidad: 1,
  precioUnitario: 1000,
  descuentoPct: 0,
  ...overrides,
});

const service = (overrides = {}) => ({
  lineaId: "service-1",
  itemId: "inventory-service-1",
  tipoItem: "servicio",
  cantidad: 1,
  precioUnitario: 1000,
  descuentoPct: 0,
  ...overrides,
});

const effect = (overrides = {}) => ({
  movimientoId: "movement-1",
  lineaId: "product-1",
  itemId: "inventory-product-1",
  cantidad: 1,
  costoUnitario: 400,
  costoTotal: 400,
  costoHistoricoDisponible: true,
  moneda: "CLP",
  ...overrides,
});

const sale = (overrides = {}) => ({
  ventaId: "sale-1",
  estado: "confirmada",
  moneda: "CLP",
  locale: "es-CL",
  descuento: 0,
  items: [product()],
  efectosInventario: [effect()],
  ...overrides,
});

const P = BUSINESS_PERMISSIONS;
assert.equal(hasBusinessPermission("FINANZAS", P.PROFITABILITY_READ), true);
assert.equal(hasBusinessPermission("VENTAS", P.PROFITABILITY_READ), false);

const vite = await createServer({
  appType: "custom",
  logLevel: "silent",
  server: {middlewareMode: true},
});

try {
  const {default: SaleCommercialMarginPanel} = await vite.ssrLoadModule(
    "/src/features/sales/SaleCommercialMarginPanel.jsx"
  );
  const render = (currentSale, role = "FINANZAS") => renderToStaticMarkup(
    React.createElement(SaleCommercialMarginPanel, {role, sale: currentSale})
  );

  const complete = render(sale());
  assert.match(complete, /Análisis comercial/);
  assert.match(complete, /Ganancia en productos/);
  assert.doesNotMatch(complete, /Margen comercial|Completo/);
  assert.match(complete, /Todos los productos con costo/);
  assert.match(complete, /<dt>Vendido<\/dt>/);
  assert.match(complete, /<dt>Costo de compra<\/dt>/);
  assert.match(complete, /<dt>Ganancia<\/dt>/);
  assert.match(complete, /<dt>Margen %<\/dt>/);
  assert.doesNotMatch(complete, /Costo histórico|Margen bruto|Ingreso neto/);
  assert.match(complete, /Ganaste <strong>\$600<\/strong> \(60 %\) sobre <strong>\$1\.000<\/strong> vendidos en productos\./, "frase con los valores reales");
  assert.doesNotMatch(complete, /no se incluyen/, "venta sólo de productos: nada que excluir");
  assert.ok(complete.indexOf("sale-commercial-margin__summary") < complete.indexOf("sale-commercial-margin__metrics"), "la frase va arriba de la fila de datos");
  console.log("OK UI margen: perfil autorizado ve el bloque completo de productos");

  assert.equal(render(sale(), "VENTAS"), "");
  console.log("OK UI margen: perfil sin profitability.read no renderiza el bloque");

  const discounted = render(sale({
    descuento: 300,
    neto: 1500,
    items: [product({cantidad: 2, precioUnitario: 1000, descuentoPct: 10})],
    efectosInventario: [effect({cantidad: 2, costoUnitario: 400, costoTotal: 800})],
  }));
  assert.match(discounted, /700/);
  assert.match(discounted, /46,67/);
  console.log("OK UI margen: descuento se refleja en margen y porcentaje");

  const mixed = render(sale({
    descuento: 200,
    neto: 1800,
    items: [product(), service()],
  }));
  assert.match(mixed, /vendidos en productos\. Los servicios, actividades y horas no se incluyen\./, "el alcance es parte de la frase");
  assert.doesNotMatch(mixed, /sale-commercial-margin__note/);

  const loss = render(sale({
    items: [product({precioUnitario: 300})],
    efectosInventario: [effect({costoUnitario: 400, costoTotal: 400})],
  }));
  assert.match(loss, /Perdiste <strong>\$100<\/strong> \(33,33 %\) sobre <strong>\$300<\/strong>/);
  const breakEven = render(sale({
    items: [product({precioUnitario: 400})],
    efectosInventario: [effect({costoUnitario: 400, costoTotal: 400})],
  }));
  assert.match(breakEven, /No hubo ganancia/);
  assert.doesNotMatch(breakEven, /Ganaste|Perdiste/);
  console.log("OK UI margen: Venta mixta identifica el alcance exclusivo de productos");

  const onlyServices = render(sale({items: [service()], efectosInventario: []}));
  assert.match(onlyServices, /No aplica/);
  assert.match(onlyServices, /no contiene productos/i);
  assert.doesNotMatch(onlyServices, /Margen %|Ganaste|Perdiste/);
  console.log("OK UI margen: servicios no reciben margen de productos ni 100 % ficticio");

  const incompleteLegacy = render(sale({efectosInventario: []}));
  assert.match(incompleteLegacy, /No disponible/);
  assert.match(incompleteLegacy, /evidencia histórica suficiente/);
  assert.doesNotMatch(incompleteLegacy, /Costo de compra|Ganaste|Perdiste/);
  console.log("OK UI margen: legacy incompleto muestra indisponibilidad sin importes");

  const zeroDenominator = render(sale({
    items: [product({precioUnitario: 0})],
    efectosInventario: [effect({costoUnitario: 100, costoTotal: 100})],
  }));
  assert.match(zeroDenominator, /No disponible/);
  assert.doesNotMatch(zeroDenominator, /NaN|Infinity|0 %/);
  console.log("OK UI margen: denominador cero no muestra porcentaje artificial");

  const largeAmounts = render(sale({
    items: [product({precioUnitario: 900719925474})],
    efectosInventario: [effect({costoUnitario: 123456789, costoTotal: 123456789})],
  }));
  assert.match(largeAmounts, /900\.719\.925\.474/);
  assert.doesNotMatch(largeAmounts, /NaN|Infinity/);
  console.log("OK UI margen: importes grandes se formatean sin perder el panel");

  const canceled = render(sale({estado: "cancelada", estadoStock: "revertido"}));
  assert.match(canceled, /Anulada/);
  assert.match(canceled, /no aporta margen comercial/);
  assert.doesNotMatch(canceled, /Margen %|Ganaste|Perdiste/);
  console.log("OK UI margen: Venta anulada y stock revertido no publican margen");

  const partial = render(sale({
    items: [product({cantidad: 2})],
    efectosInventario: [effect({cantidad: 1})],
  }));
  assert.match(partial, /Cobertura parcial/);
  assert.match(partial, /No se publica un margen parcial/);

  const currencyMismatch = render(sale({
    efectosInventario: [effect({moneda: "USD"})],
  }));
  assert.match(currencyMismatch, /monedas diferentes/);
  assert.doesNotMatch(currencyMismatch, /Margen %|Ganaste|Perdiste/);
  assert.doesNotMatch(partial, /Margen %|Ganaste|Perdiste/, "parcial: sin cifras inventadas");
  console.log("OK UI margen: parcialidad y moneda inconsistente permanecen conservadoras");
} finally {
  await vite.close();
}

const panelSource = fs.readFileSync("src/features/sales/SaleCommercialMarginPanel.jsx", "utf8");
const pageSource = fs.readFileSync("src/pages/NewSalePage.jsx", "utf8");
const salesStyles = fs.readFileSync("src/features/sales/sales.css", "utf8");
assert.match(panelSource, /hasBusinessPermission\(/);
assert.match(panelSource, /BUSINESS_PERMISSIONS\.PROFITABILITY_READ/);
assert.match(panelSource, /if \(!sale \|\| !canViewProfitability\) return null/);
assert.doesNotMatch(panelSource, /firebase|inventoryService|costoBase|costoPromedio|ultimoCosto/i);
assert.doesNotMatch(panelSource, /efectosInventario|movimientoId|lineaId|itemId/);
assert.match(pageSource, /const isSaleDetailRoute = Boolean\(ventaId\)/);
assert.match(pageSource, /isSaleDetailRoute && <SaleCommercialMarginPanel role=\{role\} sale=\{sale\}/);
assert.match(salesStyles, /\.sale-commercial-margin__metrics\s*\{[\s\S]*minmax\(0, 1fr\)/);
assert.match(salesStyles, /\.sale-commercial-margin__metrics dd\s*\{[\s\S]*overflow-wrap: anywhere/);
assert.match(salesStyles, /\.sale-commercial-margin__metrics\s*\{[\s\S]*?repeat\(4, minmax\(0, 1fr\)\)/, "cuatro datos en una fila");
assert.match(salesStyles, /@media \(max-width: 620px\)[\s\S]*\.sale-commercial-margin__metrics\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, "móvil: dos columnas");
assert.doesNotMatch(salesStyles, /sale-commercial-margin__(note|notice)/, "sin notas en letra chica");
console.log("OK UI margen: guard RBAC real, ruta sólo detalle y sin lecturas/campos internos nuevos");

console.log("Smoke UI de Margen Comercial de Ventas V1 completado.");
