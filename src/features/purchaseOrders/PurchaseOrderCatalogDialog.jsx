import React, {useMemo, useState} from "react";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";

function searchable(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CL");
}

export default function PurchaseOrderCatalogDialog({items, onAdd, onClose, open}) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("todos");
  const filtered = useMemo(() => items.filter((item) => {
    if (item.estado !== "activo") return false;
    if (type !== "todos" && item.tipoItem !== type) return false;
    const haystack = searchable(`${item.codigoInterno || item.sku || ""} ${item.nombre || ""}`);
    return haystack.includes(searchable(search));
  }).slice(0, 50), [items, search, type]);

  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      title="Agregar desde inventario"
      description="Productos, servicios y actividades activos. El costo se puede ajustar en la orden."
      size="large"
    >
      <div className="po-catalog">
        <div className="po-catalog__toolbar">
          <input
            aria-label="Buscar en inventario"
            placeholder="Buscar nombre o código"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="todos">Todos los tipos</option>
            <option value="producto">Productos</option>
            <option value="servicio">Servicios</option>
            <option value="actividad">Actividades</option>
          </select>
        </div>
        <div className="po-catalog__list">
          {filtered.map((item) => (
            <article key={item.id}>
              <div>
                <strong>{item.nombre}</strong>
                <small>{item.codigoInterno || item.sku || "Sin código"} · {item.tipoItem}</small>
              </div>
              <span>${Number(item.costoBase || 0).toLocaleString("es-CL")}</span>
              <button type="button" className="po-button po-button--secondary" onClick={() => onAdd(item)}>
                Agregar
              </button>
            </article>
          ))}
          {!filtered.length && <p>No hay ítems activos coincidentes.</p>}
        </div>
      </div>
    </ResponsiveDialog>
  );
}
