import React from "react";

const money = (value) => `$${Math.round(Number(value || 0)).toLocaleString("es-CL")}`;

export default function PurchaseOrderPrintView({company, order}) {
  return (
    <section className="po-print">
      <header className="po-print__header">
        <div className="po-print__title"><small>Documento comercial</small><h1>ORDEN DE COMPRA</h1><strong>{order.numero}</strong></div>
        <div className="po-print__company">
          <strong>{company?.razonSocial || company?.nombreComercial || "Empresa compradora"}</strong>
          <p>{company?.rut}</p>
          <p>{company?.direccion}</p>
          <p>{company?.email || company?.telefono}</p>
        </div>
      </header>
      <div className="po-print__parties">
        <section><small>Proveedor</small><strong>{order.proveedorSnapshot?.razonSocial}</strong><p>{order.proveedorSnapshot?.rut}</p><p>{order.proveedorSnapshot?.direccion}</p></section>
        <section><small>Documento</small><strong>{order.numero}</strong><p>Emisión: {order.fechaEmision || "—"}</p><p>Entrega estimada: {order.fechaEntregaEstimada || "—"}</p><p>Estado: {order.estado || "borrador"}</p></section>
      </div>
      <table><thead><tr><th>Ítem</th><th>Cantidad</th><th>Costo</th><th>Desc.</th><th>Total</th></tr></thead><tbody>
        {order.items.map((item) => <tr key={item.lineaId}><td><strong>{item.codigo} · {item.nombre}</strong>{item.descripcion ? <small>{item.descripcion}</small> : null}</td><td>{item.cantidad}</td><td>{money(item.costoUnitario)}</td><td>{item.descuentoPct}%</td><td><strong>{money(item.totalLinea)}</strong></td></tr>)}
      </tbody></table>
      <div className="po-print__totals"><p>Neto: {money(order.neto)}</p><p>IVA: {money(order.iva)}</p><strong>Total: {money(order.total)}</strong></div>
      {order.condicionesPago && <p><strong>Condiciones:</strong> {order.condicionesPago}</p>}
      {order.observaciones && <p><strong>Observaciones:</strong> {order.observaciones}</p>}
    </section>
  );
}
