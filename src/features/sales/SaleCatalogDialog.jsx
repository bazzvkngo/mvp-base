import React, {useMemo, useState} from "react";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";

const searchable = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const money = (value) => `$${Math.round(Number(value || 0)).toLocaleString("es-CL")}`;

export default function SaleCatalogDialog({items, onAdd, onClose, open}) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("todos");
  const filtered = useMemo(() => items.filter((item) => item.estado === "activo" && (type === "todos" || item.tipoItem === type) && searchable(`${item.codigoInterno || item.sku} ${item.nombre}`).includes(searchable(search))).slice(0, 50), [items, search, type]);
  return <ResponsiveDialog open={open} onClose={onClose} title="Agregar desde inventario" description="Ítems activos del negocio. El precio puede ajustarse en el borrador." size="large"><div className="po-catalog"><div className="po-catalog__toolbar"><input aria-label="Buscar en inventario" placeholder="Buscar nombre o código" value={search} onChange={(event) => setSearch(event.target.value)} /><select value={type} onChange={(event) => setType(event.target.value)}><option value="todos">Todos los tipos</option><option value="producto">Productos</option><option value="servicio">Servicios</option><option value="actividad">Actividades</option></select></div><div className="po-catalog__list">{filtered.map((item) => <article key={item.id}><div><strong>{item.nombre}</strong><small>{item.codigoInterno || item.sku || "Sin código"} · {item.tipoItem}{item.tipoItem === "producto" ? ` · Stock disponible: ${Number(item.stock || 0)}` : ""}</small></div><span>{money(item.precioInterno)}</span><button type="button" className="po-button po-button--secondary" onClick={() => onAdd(item)}>Agregar</button></article>)}{!filtered.length && <p>No hay ítems activos coincidentes.</p>}</div></div></ResponsiveDialog>;
}
