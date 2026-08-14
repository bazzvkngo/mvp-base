import React, { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Boxes, FileSpreadsheet, PackagePlus, RotateCcw, Settings2 } from "lucide-react";
import AppIcon from "../../components/ui/AppIcon";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {
  INVENTORY_TYPES,
  adaptInventoryItem,
  buildInventoryPayload,
  filterInventoryItems,
  getDefaultUnitForType,
  getInventoryTypeLabel,
  parseInventoryNumber,
  summarizeInventory,
  validateInventoryDraft,
} from "../../domain/inventoryMvp.mjs";
import { getCategoriesForArea, getInventoryAreaLabel, getInventoryCategoryLabel } from "../../domain/inventoryCatalog.mjs";
import { calculateBasePrice, calculateEffectiveInternalPrice } from "../../domain/pricing.js";
import {
  createManagedInventoryItem,
  deactivateInventoryItem,
  reactivateInventoryItem,
  subscribeToInventory,
  subscribeToInventoryAreas,
  subscribeToInventoryCategories,
  updateManagedInventoryItem,
} from "../../services/inventoryService";
import { DEFAULT_INVENTORY_SETTINGS, getBusinessSettings } from "../../services/companyService";
import { formatCLP } from "../../utils/formatters";
import InventoryCatalogManager from "./InventoryCatalogManager";
import InventoryImportDialog from "./InventoryImportDialog";
import UnitSelector from "./UnitSelector";
import "./inventory.css";

const EMPTY_DRAFT = Object.freeze({
  tipoItem: "",
  nombre: "",
  areaId: "",
  categoriaId: "",
  unidad: "",
  costoBase: "",
  margenDeseado: "",
  precioManual: "",
  stock: "0",
  stockMinimo: "0",
  unidadStock: "unidad",
  descripcion: "",
});

function requestId() {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random()}`;
  return `inventory_${String(id).replace(/[^a-zA-Z0-9_-]/g, "")}`.slice(0, 120);
}

function InventoryManager({ businessId, readOnly = false, role = "OWNER" }) {
  const cannotWrite = readOnly || role === "MEMBER";
  const [items, setItems] = useState([]);
  const [areas, setAreas] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [settings, setSettings] = useState(DEFAULT_INVENTORY_SETTINGS);
  const [filters, setFilters] = useState({ query: "", type: "todos", areaId: "todas", categoryId: "todas", status: "activo" });
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [detailItem, setDetailItem] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT });
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [catalogState, setCatalogState] = useState({ loading: true, errors: { areas: "", categories: "" }, retry: 0 });
  const createRequestRef = useRef("");

  useEffect(() => {
    if (!businessId) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    return subscribeToInventory(businessId, (records) => {
      setItems(records);
      setLoading(false);
      setLoadError("");
    }, (error) => {
      console.error("Error al cargar inventario:", error);
      setLoading(false);
      setLoadError("No se pudo cargar el inventario del negocio.");
    });
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return undefined;
    const stops = [];
    setCatalogState((current) => ({ ...current, loading: true, errors: { areas: "", categories: "" } }));
    stops.push(subscribeToInventoryAreas(businessId, (records) => {
      setAreas(records);
      setCatalogState((current) => ({ ...current, loading: false, errors: { ...current.errors, areas: "" } }));
    }, () => setCatalogState((current) => ({ ...current, loading: false, errors: { ...current.errors, areas: "No se pudieron cargar las áreas." } }))));
    stops.push(subscribeToInventoryCategories(businessId, (records) => {
      setCategories(records);
      setCatalogState((current) => ({ ...current, loading: false, errors: { ...current.errors, categories: "" } }));
    }, () => setCatalogState((current) => ({ ...current, loading: false, errors: { ...current.errors, categories: "No se pudieron cargar las categorías." } }))));
    return () => stops.forEach((stop) => stop());
  }, [businessId, catalogState.retry]);

  useEffect(() => {
    if (!businessId) return undefined;
    let active = true;
    getBusinessSettings(businessId, "inventario").then((value) => active && setSettings(value)).catch(() => {});
    return () => { active = false; };
  }, [businessId]);

  const summary = useMemo(() => summarizeInventory(items, { lowStockThreshold: settings.umbralStockBajo }), [items, settings.umbralStockBajo]);
  const visibleItems = useMemo(() => filterInventoryItems(items, filters), [filters, items]);
  const activeAreas = useMemo(() => areas.filter((area) => (area.estado || "activo") === "activo"), [areas]);
  const formCategories = useMemo(() => getCategoriesForArea(categories, draft.areaId), [categories, draft.areaId]);
  const filterCategories = useMemo(() => getCategoriesForArea(categories, filters.areaId, { activeOnly: false }), [categories, filters.areaId]);

  const setFilter = (field, value) => setFilters((current) => ({
    ...current,
    [field]: value,
    ...(field === "areaId" ? { categoryId: "todas" } : {}),
  }));

  const openNewItem = () => {
    setEditingItem(null);
    setDraft({ ...EMPTY_DRAFT });
    setFieldErrors({});
    createRequestRef.current = "";
    setFormOpen(true);
  };

  const openEditItem = (rawItem) => {
    const item = adaptInventoryItem(rawItem);
    setEditingItem(rawItem);
    setDraft({
      ...EMPTY_DRAFT,
      tipoItem: item.tipoItem,
      nombre: item.nombre,
      areaId: item.areaId || "",
      categoriaId: item.categoriaId || "",
      unidad: item.unidad,
      costoBase: String(item.costoBase),
      margenDeseado: String(item.margenDeseado),
      precioManual: item.precioManual === true ? String(item.precioInterno ?? "") : "",
      stock: String(item.stock ?? 0),
      stockMinimo: String(item.stockMinimo ?? 0),
      unidadStock: item.unidadStock || item.unidad || "unidad",
      descripcion: item.descripcion || "",
    });
    setFieldErrors({});
    setDetailItem(null);
    setFormOpen(true);
  };

  const updateDraft = (field, value) => {
    setDraft((current) => {
      const next = { ...current, [field]: value };
      if (field === "tipoItem" && value) {
        next.unidad = current.unidad || getDefaultUnitForType(value);
        if (value !== "producto") {
          next.stock = "0";
          next.stockMinimo = "0";
        }
      }
      if (field === "areaId") next.categoriaId = "";
      return next;
    });
    setFieldErrors((current) => ({ ...current, [field]: "" }));
  };

  const closeForm = () => {
    if (saving) return;
    setFormOpen(false);
    setEditingItem(null);
    setFieldErrors({});
  };

  const saveItem = async (event) => {
    event.preventDefault();
    const errors = validateInventoryDraft(draft);
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    setSaving(true);
    setFeedback({ type: "", message: "" });
    try {
      const payload = buildInventoryPayload(
        draft,
        categories,
        editingItem
          ? { authorizedStatus: adaptInventoryItem(editingItem).estado }
          : undefined
      );
      if (editingItem) {
        await updateManagedInventoryItem(businessId, editingItem.id, payload, {
          preserveLegacyModel: editingItem.modeloInventarioVersion !== 2 || !editingItem.codigoInterno,
          allowNegativeStock: false,
        });
        setFeedback({ type: "success", message: "Ítem actualizado correctamente." });
      } else {
        if (!createRequestRef.current) createRequestRef.current = requestId();
        const created = await createManagedInventoryItem(businessId, payload, createRequestRef.current);
        setFeedback({ type: "success", message: `Ítem creado con código ${created.codigoInterno}.` });
      }
      setFormOpen(false);
      setEditingItem(null);
      setFieldErrors({});
    } catch (error) {
      setFeedback({ type: "error", message: error.message || "No se pudo guardar el ítem." });
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (item, nextStatus) => {
    setFeedback({ type: "", message: "" });
    try {
      if (nextStatus === "activo") await reactivateInventoryItem(businessId, item.id);
      else await deactivateInventoryItem(businessId, item.id);
      setFeedback({ type: "success", message: nextStatus === "activo" ? "Ítem reactivado." : "Ítem archivado; sus referencias se conservan." });
      setDetailItem(null);
    } catch (error) {
      setFeedback({ type: "error", message: error.message || "No se pudo cambiar el estado." });
    }
  };

  const selectType = (type) => updateDraft("tipoItem", type);
  const calculatedPrice = Math.round(calculateBasePrice({ costoBase: parseInventoryNumber(draft.costoBase) || 0, margenDeseado: parseInventoryNumber(draft.margenDeseado) || 0 }));
  const effectivePrice = Math.round(calculateEffectiveInternalPrice({ costoBase: parseInventoryNumber(draft.costoBase) || 0, margenDeseado: parseInventoryNumber(draft.margenDeseado) || 0, precioInterno: parseInventoryNumber(draft.precioManual), precioManual: String(draft.precioManual).trim() !== "" }));

  return (
    <section className="erp-page inventory-page">
      <div className="erp-module-intro">
        <div className="erp-page-intro">
          <p>Administra productos, servicios y actividades del negocio activo.</p>
        </div>
        {!cannotWrite && <div className="erp-module-actions inventory-header-actions">
          <button type="button" className="inventory-button inventory-button--secondary" onClick={() => setImportOpen(true)}><AppIcon icon={FileSpreadsheet} size={18} />Importar Excel</button>
          <button type="button" className="inventory-button inventory-button--primary" onClick={openNewItem}><AppIcon icon={PackagePlus} size={18} />Nuevo ítem</button>
        </div>}
      </div>

      {cannotWrite && <p className="inventory-feedback inventory-feedback--notice">Puedes consultar el inventario. La creación y edición requieren rol Propietario o Administrador.</p>}
      {feedback.message && <p className={`inventory-feedback inventory-feedback--${feedback.type}`} role={feedback.type === "error" ? "alert" : "status"}>{feedback.message}</p>}
      {loadError && <p className="inventory-feedback inventory-feedback--error" role="alert">{loadError}</p>}

      <div className="erp-metric-grid inventory-summary" aria-label="Resumen del inventario">
        <Metric label="Ítems activos" value={summary.total} />
        <Metric label="Productos" value={summary.products} />
        <Metric label="Servicios y actividades" value={summary.servicesAndActivities} />
        <Metric label="Stock bajo" value={summary.lowStock} tone={summary.lowStock ? "warning" : ""} />
        <Metric label="Costo del inventario" value={formatCLP(summary.inventoryCost)} />
      </div>

      <section className="erp-panel inventory-list-panel" aria-labelledby="inventory-list-title">
        <div className="erp-panel-header">
          <div><h2 id="inventory-list-title" className="erp-panel-title">Ítems del inventario</h2><p className="erp-secondary-text">{visibleItems.length} registro{visibleItems.length === 1 ? "" : "s"} según los filtros actuales.</p></div>
          {!cannotWrite && <button type="button" className="inventory-button inventory-button--ghost" onClick={() => setCatalogOpen(true)}><AppIcon icon={Settings2} size={18} />Áreas y categorías</button>}
        </div>
        <div className="erp-filters inventory-filters">
          <label className="erp-field inventory-search"><span className="erp-field__label">Buscar por código o nombre</span><input className="erp-control" value={filters.query} onChange={(event) => setFilter("query", event.target.value)} placeholder="Ej. PR-0004 o cable" /></label>
          <Filter label="Tipo" value={filters.type} onChange={(value) => setFilter("type", value)}><option value="todos">Todos</option>{INVENTORY_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</Filter>
          <Filter label="Área" value={filters.areaId} onChange={(value) => setFilter("areaId", value)}><option value="todas">Todas</option><option value="sin_area">Sin área</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.nombre}</option>)}</Filter>
          <Filter label="Categoría" value={filters.categoryId} onChange={(value) => setFilter("categoryId", value)} disabled={!filters.areaId || filters.areaId === "todas" || filters.areaId === "sin_area"}><option value="todas">Todas</option><option value="sin_categoria">Sin categoría</option>{filterCategories.map((category) => <option key={category.id} value={category.id}>{category.nombre}</option>)}</Filter>
          <Filter label="Estado" value={filters.status} onChange={(value) => setFilter("status", value)}><option value="activo">Activos</option><option value="inactivo">Archivados</option><option value="todos">Todos</option></Filter>
        </div>

        {loading ? <div className="erp-empty-state">Cargando inventario…</div> : visibleItems.length === 0 ? (
          <div className="erp-empty-state inventory-empty-state"><AppIcon icon={Boxes} size={34} /><h3>{items.length ? "No hay resultados" : "Tu inventario está listo para comenzar"}</h3><p>{items.length ? "Prueba cambiando la búsqueda o los filtros." : "Crea manualmente tu primer ítem o importa una planilla existente."}</p>{!cannotWrite && <div><button type="button" className="inventory-button inventory-button--primary" onClick={openNewItem}>Crear primer ítem</button><button type="button" className="inventory-button inventory-button--secondary" onClick={() => setImportOpen(true)}>Importar desde Excel</button></div>}</div>
        ) : <InventoryList items={visibleItems} areas={areas} categories={categories} cannotWrite={cannotWrite} onArchive={(item) => changeStatus(item, "inactivo")} onEdit={openEditItem} onReactivate={(item) => changeStatus(item, "activo")} onView={setDetailItem} />}
      </section>

      <ResponsiveDialog open={formOpen} onClose={closeForm} size="large" eyebrow="Inventario" title={editingItem ? "Editar ítem" : "Nuevo ítem"} description={editingItem ? `Código ${editingItem.codigoInterno || editingItem.sku || "heredado"}` : "El código interno se asignará de forma segura al guardar."}>
        <form className="inventory-item-form" onSubmit={saveItem}>
          {!draft.tipoItem ? <div className="inventory-type-step"><h3>¿Qué necesitas registrar?</h3><div>{INVENTORY_TYPES.map((type) => <button key={type.value} type="button" onClick={() => selectType(type.value)}><strong>{type.label}</strong><span>{type.description}</span></button>)}</div></div> : <>
            {!editingItem && <button type="button" className="inventory-link-button" onClick={() => selectType("")}>← Cambiar tipo</button>}
            <div className="inventory-form-section"><div><h3>Datos principales</h3><p>{getInventoryTypeLabel(draft.tipoItem)} · El código se asignará al guardar.</p></div><div className="inventory-form-grid">
              <Field label="Nombre" required error={fieldErrors.nombre}><input autoFocus className="erp-control" value={draft.nombre} onChange={(event) => updateDraft("nombre", event.target.value)} maxLength={140} /></Field>
              <UnitSelector type={draft.tipoItem} value={draft.unidad} error={fieldErrors.unidad} onChange={(value) => updateDraft("unidad", value)} />
              <Field label="Área (opcional)"><select className="erp-control" value={draft.areaId} onChange={(event) => updateDraft("areaId", event.target.value)}><option value="">Sin área</option>{activeAreas.map((area) => <option key={area.id} value={area.id}>{area.nombre}</option>)}</select></Field>
              <Field label="Categoría (opcional)" error={fieldErrors.categoriaId}><select className="erp-control" value={draft.categoriaId} disabled={!draft.areaId} onChange={(event) => updateDraft("categoriaId", event.target.value)}><option value="">Sin categoría</option>{formCategories.map((category) => <option key={category.id} value={category.id}>{category.nombre}</option>)}</select></Field>
            </div><button type="button" className="inventory-link-button" onClick={() => setCatalogOpen(true)}>Administrar áreas y categorías sin perder estos datos</button></div>
            {draft.tipoItem === "producto" && <div className="inventory-form-section"><div><h3>Control de stock</h3><p>Solo los productos físicos participan en alertas y costo de inventario.</p></div><div className="inventory-form-grid inventory-form-grid--three"><Field label="Stock disponible" error={fieldErrors.stock}><input className="erp-control" type="number" min="0" step="any" value={draft.stock} onChange={(event) => updateDraft("stock", event.target.value)} /></Field><Field label="Stock mínimo" error={fieldErrors.stockMinimo}><input className="erp-control" type="number" min="0" step="any" value={draft.stockMinimo} onChange={(event) => updateDraft("stockMinimo", event.target.value)} /></Field><Field label="Unidad de stock"><select className="erp-control" value={draft.unidadStock} onChange={(event) => updateDraft("unidadStock", event.target.value)}><option value={draft.unidad}>{draft.unidad || "Unidad seleccionada"}</option><option value="unidad">Unidad</option></select></Field></div></div>}
            <div className="inventory-form-section"><div><h3>Precio interno</h3><p>ValoraCloud usa las funciones de dominio para mantener una sola regla de cálculo.</p></div><div className="inventory-price-grid"><Field label="Costo base unitario" required error={fieldErrors.costoBase}><input className="erp-control" type="number" min="0" step="any" value={draft.costoBase} onChange={(event) => updateDraft("costoBase", event.target.value)} /></Field><Field label="Margen deseado (%)" required error={fieldErrors.margenDeseado}><input className="erp-control" type="number" min="0" max="1000" step="any" value={draft.margenDeseado} onChange={(event) => updateDraft("margenDeseado", event.target.value)} /></Field><div className="inventory-price-result"><span>Precio calculado</span><strong>{formatCLP(calculatedPrice)}</strong></div><Field label="Ajuste manual opcional" error={fieldErrors.precioManual} hint="Reemplaza el precio calculado solo para este ítem."><input className="erp-control" type="number" min="0" step="any" value={draft.precioManual} onChange={(event) => updateDraft("precioManual", event.target.value)} placeholder="Sin ajuste" /></Field><div className="inventory-effective-price"><span>Precio efectivo en ValoraCloud</span><strong>{formatCLP(effectivePrice)}</strong></div></div></div>
            <div className="inventory-form-section"><div><h3>Descripción</h3></div><Field label="Descripción (opcional)"><textarea className="erp-control inventory-textarea" rows="4" maxLength={1200} value={draft.descripcion} onChange={(event) => updateDraft("descripcion", event.target.value)} /></Field></div>
            {feedback.type === "error" && <p className="inventory-feedback inventory-feedback--error" role="alert">{feedback.message}</p>}
            <div className="inventory-form-actions"><button type="button" className="inventory-button inventory-button--secondary" onClick={closeForm}>Cancelar</button><button type="submit" className="inventory-button inventory-button--primary" disabled={saving}>{saving ? "Guardando…" : editingItem ? "Guardar cambios" : "Crear ítem"}</button></div>
          </>}
        </form>
      </ResponsiveDialog>

      <ResponsiveDialog open={catalogOpen} onClose={() => setCatalogOpen(false)} size="large" eyebrow="Inventario" title="Áreas y categorías" description="Organiza el catálogo cuando lo necesites; la clasificación no bloquea la creación."><InventoryCatalogManager areas={areas} businessId={businessId} categories={categories} loadErrors={catalogState.errors} loading={catalogState.loading} onRetry={() => setCatalogState((current) => ({ ...current, retry: current.retry + 1 }))} /></ResponsiveDialog>
      <InventoryImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={(info) => setFeedback(info?.partial ? { type: "notice", message: "La importación quedó parcial; revisa el resumen antes de continuar." } : { type: "success", message: "Importación confirmada correctamente." })} businessId={businessId} areas={areas} categories={categories} existingItems={items} />
      <ItemDetail item={detailItem} areas={areas} categories={categories} cannotWrite={cannotWrite} onClose={() => setDetailItem(null)} onEdit={openEditItem} onArchive={(item) => changeStatus(item, "inactivo")} onReactivate={(item) => changeStatus(item, "activo")} />
    </section>
  );
}

function Metric({ label, tone, value }) { return <article className={`erp-metric-card${tone ? ` inventory-metric--${tone}` : ""}`}><span className="erp-metric-card__label">{label}</span><strong className="erp-metric-card__value">{value}</strong></article>; }
function Filter({ children, disabled, label, onChange, value }) { return <label className="erp-field"><span className="erp-field__label">{label}</span><select className="erp-control" disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>; }
function Field({ children, error, hint, label, required }) { return <label className="erp-field"><span className="erp-field__label">{label}{required ? " *" : ""}</span>{children}{hint && <small className="inventory-field-hint">{hint}</small>}{error && <small className="inventory-field-error">{error}</small>}</label>; }

function InventoryList({ areas, cannotWrite, categories, items, onArchive, onEdit, onReactivate, onView }) {
  return <><div className="erp-table-region erp-desktop-only"><table className="erp-table inventory-table"><thead><tr><th>Código</th><th>Ítem</th><th>Tipo</th><th>Área / categoría</th><th>Unidad</th><th>Costo</th><th>Precio</th><th>Stock</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td className="inventory-code">{item.codigoInterno || item.sku || "—"}</td><td><button className="inventory-item-link" type="button" onClick={() => onView(item)}>{item.nombre}</button></td><td>{getInventoryTypeLabel(item.tipoItem)}</td><td>{getInventoryAreaLabel(item, areas)}<small>{getInventoryCategoryLabel(item, categories)}</small></td><td>{item.unidad}</td><td>{formatCLP(item.costoBase)}</td><td><strong>{formatCLP(item.precioEfectivo)}</strong></td><td>{item.tipoItem === "producto" ? <span className={item.stock <= item.stockMinimo ? "inventory-stock-low" : ""}>{item.stock}</span> : "—"}</td><td><Status item={item} /></td><td><Actions item={item} cannotWrite={cannotWrite} onArchive={onArchive} onEdit={onEdit} onReactivate={onReactivate} /></td></tr>)}</tbody></table></div><div className="erp-card-list erp-mobile-only">{items.map((item) => <article className="erp-record-card inventory-mobile-card" key={item.id}><header className="erp-record-card__header"><div><span className="inventory-code">{item.codigoInterno || item.sku || "Sin código"}</span><h3 className="erp-record-card__title">{item.nombre}</h3><p className="erp-record-card__subtitle">{getInventoryTypeLabel(item.tipoItem)} · {item.unidad}</p></div><Status item={item} /></header><dl className="erp-meta-grid"><div className="erp-meta"><dt className="erp-meta__label">Clasificación</dt><dd className="erp-meta__value">{getInventoryAreaLabel(item, areas)} / {getInventoryCategoryLabel(item, categories)}</dd></div><div className="erp-meta"><dt className="erp-meta__label">Costo / precio</dt><dd className="erp-meta__value">{formatCLP(item.costoBase)} / {formatCLP(item.precioEfectivo)}</dd></div>{item.tipoItem === "producto" && <div className="erp-meta"><dt className="erp-meta__label">Stock</dt><dd className="erp-meta__value">{item.stock} (mín. {item.stockMinimo})</dd></div>}</dl><button type="button" className="inventory-button inventory-button--secondary" onClick={() => onView(item)}>Ver detalle</button><Actions item={item} cannotWrite={cannotWrite} onArchive={onArchive} onEdit={onEdit} onReactivate={onReactivate} /></article>)}</div></>;
}

function Status({ item }) { return <span className={`inventory-status inventory-status--${item.estado === "activo" ? "active" : "archived"}`}>{item.estado === "activo" ? "Activo" : "Archivado"}</span>; }
function Actions({ cannotWrite, item, onArchive, onEdit, onReactivate }) { if (cannotWrite) return null; return <div className="inventory-row-actions"><button type="button" onClick={() => onEdit(item)}>Editar</button>{item.estado === "activo" ? <button type="button" onClick={() => onArchive(item)}><AppIcon icon={Archive} size={15} />Archivar</button> : <button type="button" onClick={() => onReactivate(item)}><AppIcon icon={RotateCcw} size={15} />Reactivar</button>}</div>; }

function ItemDetail({ areas, cannotWrite, categories, item, onArchive, onClose, onEdit, onReactivate }) {
  if (!item) return null;
  const adapted = adaptInventoryItem(item);
  return <ResponsiveDialog open onClose={onClose} eyebrow="Inventario" title={adapted.nombre} description={adapted.codigoInterno || adapted.sku || "Registro heredado sin código"} footer={!cannotWrite ? <Actions item={adapted} onEdit={onEdit} onArchive={onArchive} onReactivate={onReactivate} /> : null}><dl className="inventory-detail-grid"><Detail label="Tipo" value={getInventoryTypeLabel(adapted.tipoItem)} /><Detail label="Área" value={getInventoryAreaLabel(adapted, areas)} /><Detail label="Categoría" value={getInventoryCategoryLabel(adapted, categories)} /><Detail label="Unidad" value={adapted.unidad} /><Detail label="Costo base" value={formatCLP(adapted.costoBase)} /><Detail label="Margen" value={`${adapted.margenDeseado}%`} /><Detail label="Precio calculado" value={formatCLP(adapted.precioCalculado)} /><Detail label="Precio efectivo" value={formatCLP(adapted.precioEfectivo)} />{adapted.tipoItem === "producto" && <><Detail label="Stock disponible" value={adapted.stock} /><Detail label="Stock mínimo" value={adapted.stockMinimo} /></>}</dl>{adapted.descripcion && <div className="inventory-detail-description"><strong>Descripción</strong><p>{adapted.descripcion}</p></div>}</ResponsiveDialog>;
}
function Detail({ label, value }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }

export default InventoryManager;
