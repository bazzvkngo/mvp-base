import React, {useMemo, useState} from "react";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";

const searchable = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export default function PurchaseCatalogDialog({items, onAdd, onClose, open}) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("todos");
  const filtered = useMemo(() => items.filter((item) => item.estado === "activo" && (type === "todos" || item.tipoItem === type) && searchable(`${item.codigoInterno || item.sku} ${item.nombre}`).includes(searchable(search))).slice(0, 50), [items, search, type]);
  return <ResponsiveDialog open={open} onClose={onClose} title="Agregar desde inventario" description="Ítems activos del negocio. El costo puede ajustarse antes de confirmar." size="large">
    <div className="po-catalog"><div className="po-catalog__toolbar"><input aria-label="Buscar en inventario" placeholder="Buscar nombre o código" value={search} onChange={(event) => setSearch(event.target.value)} /><select value={type} onChange={(event) => setType(event.target.value)}><option value="todos">Todos los tipos</option><option value="producto">Productos</option><option value="servicio">Servicios</option><option value="actividad">Actividades</option></select></div>
      <div className="po-catalog__list">{filtered.map((item) => <article key={item.id}><div><strong>{item.nombre}</strong><small>{item.codigoInterno || item.sku || "Sin código"} · {({producto: "Producto", servicio: "Servicio", actividad: "Actividad"})[item.tipoItem] || "Producto"}{item.tipoItem === "producto" ? ` · Stock actual: ${Number(item.stock || 0)}` : ""}</small></div><span>${Number(item.costoBase || 0).toLocaleString("es-CL")}</span><button type="button" className="po-button po-button--secondary" onClick={() => onAdd(item)}>Agregar</button></article>)}{!filtered.length && <p>No hay ítems activos coincidentes.</p>}</div>
    </div>
  </ResponsiveDialog>;
}
