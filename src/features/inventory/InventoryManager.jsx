import React, { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Archive, Boxes, BriefcaseBusiness, FileSpreadsheet, Package, PackagePlus, RotateCcw, Settings2 } from "lucide-react";
import AppIcon from "../../components/ui/AppIcon";
import Button from "../../components/ui/Button";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import {
  INVENTORY_TYPES,
  INVENTORY_PRICE_FORMATION_VERSION,
  adaptInventoryItem,
  buildInventoryPayload,
  calculateInventoryPriceFormation,
  filterInventoryItems,
  getDefaultUnitForType,
  getInventoryTypeLabel,
  isInventoryLowStock,
  parseInventoryNumber,
  summarizeInventory,
  validateInventoryDraft,
} from "../../domain/inventoryMvp.mjs";
import { getCategoriesForArea, getInventoryAreaLabel, getInventoryCategoryLabel, isDuplicateAreaName, isDuplicateCategoryName } from "../../domain/inventoryCatalog.mjs";
import { calculateBasePrice, calculateEffectiveInternalPrice } from "../../domain/pricing.js";
import {BUSINESS_PERMISSIONS, hasBusinessPermission} from "../../domain/rbac.mjs";
import {
  createManagedInventoryItem,
  deactivateInventoryItem,
  getInventoryAcquisitions,
  reactivateInventoryItem,
  saveInventoryArea,
  saveInventoryCategory,
  subscribeToInventory,
  subscribeToInventoryAreas,
  subscribeToInventoryCategories,
  updateManagedInventoryItem,
} from "../../services/inventoryService";
import { DEFAULT_INVENTORY_SETTINGS, getBusinessSettings } from "../../services/companyService";
import { formatCLP, formatDate, formatMoney } from "../../utils/formatters";
import InventoryCatalogManager from "./InventoryCatalogManager";
import InventoryImportDialog from "./InventoryImportDialog";
import UnitSelector from "./UnitSelector";
import "./inventory.css";

const EMPTY_DRAFT = Object.freeze({
  tipoItem: "producto",
  codigoSolicitado: "",
  codigoInterno: "",
  nombre: "",
  marca: "",
  modelo: "",
  codigoBarras: "",
  areaId: "",
  categoriaId: "",
  unidad: "unidad",
  costoBase: "",
  margenDeseado: "",
  formacionPrecioVersion: INVENTORY_PRICE_FORMATION_VERSION,
  tasaImpuestoCompra: "0",
  precioManual: "",
  stock: "0",
  stockMinimo: "0",
  unidadStock: "unidad",
  descripcion: "",
});

const INVENTORY_TYPE_ICONS = Object.freeze({
  producto: Package,
  servicio: BriefcaseBusiness,
  actividad: Activity,
});

function requestId() {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random()}`;
  return `inventory_${String(id).replace(/[^a-zA-Z0-9_-]/g, "")}`.slice(0, 120);
}

function InventoryManager({ businessId, readOnly = false, role = "OWNER" }) {
  const cannotWrite = readOnly || !hasBusinessPermission(role, BUSINESS_PERMISSIONS.INVENTORY_WRITE);
  const canReadCosts = hasBusinessPermission(role, BUSINESS_PERMISSIONS.INVENTORY_COSTS_READ);
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
  const [catalogReturnToForm, setCatalogReturnToForm] = useState(false);
  const [quickCreate, setQuickCreate] = useState("");
  const [quickName, setQuickName] = useState("");
  const [quickError, setQuickError] = useState("");
  const [quickSaving, setQuickSaving] = useState(false);
  const [detailItem, setDetailItem] = useState(null);
  const [acquisitions, setAcquisitions] = useState([]);
  const [acquisitionsState, setAcquisitionsState] = useState({loading: false, error: ""});
  const [editingItem, setEditingItem] = useState(null);
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT });
  const [manualPriceEnabled, setManualPriceEnabled] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [catalogState, setCatalogState] = useState({ loading: true, errors: { areas: "", categories: "" }, retry: 0 });
  const createRequestRef = useRef("");
  const quickNameRef = useRef(null);

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

  useEffect(() => {
    if (!businessId || !canReadCosts || !detailItem?.id || adaptInventoryItem(detailItem).tipoItem !== "producto") {
      setAcquisitions([]);
      setAcquisitionsState({loading: false, error: ""});
      return undefined;
    }
    let active = true;
    setAcquisitions([]);
    setAcquisitionsState({loading: true, error: ""});
    getInventoryAcquisitions(businessId, detailItem.id)
      .then((records) => {
        if (!active) return;
        setAcquisitions(records);
        setAcquisitionsState({loading: false, error: ""});
      })
      .catch((error) => {
        console.error("Error al cargar adquisiciones:", error);
        if (active) {
          setAcquisitionsState({
            loading: false,
            error: "No se pudo cargar el historial de adquisiciones.",
          });
        }
      });
    return () => { active = false; };
  }, [businessId, canReadCosts, detailItem]);

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
    setManualPriceEnabled(false);
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
      codigoInterno: item.codigoInterno || item.sku || "",
      nombre: item.nombre,
      marca: item.marca,
      modelo: item.modelo,
      codigoBarras: item.codigoBarras,
      areaId: item.areaId || "",
      categoriaId: item.categoriaId || "",
      unidad: item.unidad,
      costoBase: String(item.costoBase),
      margenDeseado: String(item.margenDeseado),
      formacionPrecioVersion: item.formacionPrecioVersion === INVENTORY_PRICE_FORMATION_VERSION
        ? INVENTORY_PRICE_FORMATION_VERSION
        : "",
      tasaImpuestoCompra: item.formacionPrecioVersion === INVENTORY_PRICE_FORMATION_VERSION
        ? String(item.tasaImpuestoCompra ?? 0)
        : "0",
      precioManual: item.precioManual === true ? String(item.precioInterno ?? "") : "",
      stock: String(item.stock ?? 0),
      stockMinimo: String(item.stockMinimo ?? 0),
      unidadStock: item.unidadStock || item.unidad || "unidad",
      descripcion: item.descripcion || "",
    });
    setManualPriceEnabled(item.precioManual === true);
    setFieldErrors({});
    createRequestRef.current = "";
    setDetailItem(null);
    setFormOpen(true);
  };

  const updateDraft = (field, value) => {
    setDraft((current) => {
      const next = { ...current, [field]: value };
      if (field === "tipoItem" && value) {
        next.unidad = current.unidad || getDefaultUnitForType(value);
        if (value !== "producto") {
          next.marca = "";
          next.modelo = "";
          next.codigoBarras = "";
          next.stock = "0";
          next.stockMinimo = "0";
          next.formacionPrecioVersion = "";
          next.tasaImpuestoCompra = "0";
        } else if (!editingItem) {
          next.formacionPrecioVersion = INVENTORY_PRICE_FORMATION_VERSION;
          next.tasaImpuestoCompra = "0";
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

  const openCatalogManager = () => {
    const returnsToForm = formOpen;
    setCatalogReturnToForm(returnsToForm);
    if (returnsToForm) setFormOpen(false);
    setCatalogOpen(true);
  };

  const closeCatalogManager = () => {
    setCatalogOpen(false);
    if (catalogReturnToForm) {
      setCatalogReturnToForm(false);
      setFormOpen(true);
    }
  };

  const openQuickCreate = (type) => {
    if (type === "category" && !draft.areaId) return;
    setQuickName("");
    setQuickError("");
    setQuickCreate(type);
  };

  const closeQuickCreate = () => {
    if (quickSaving) return;
    setQuickCreate("");
    setQuickName("");
    setQuickError("");
  };

  const submitQuickCreate = async (event) => {
    event.preventDefault();
    const name = quickName.trim();
    if (!name) {
      setQuickError("Escribe un nombre.");
      return;
    }
    if (quickCreate === "area" && isDuplicateAreaName(areas, name)) {
      setQuickError("Ya existe un área con ese nombre.");
      return;
    }
    if (quickCreate === "category" && isDuplicateCategoryName(categories, draft.areaId, name)) {
      setQuickError("Ya existe una categoría con ese nombre dentro del área.");
      return;
    }
    try {
      setQuickSaving(true);
      setQuickError("");
      if (quickCreate === "area") {
        const result = await saveInventoryArea(businessId, {nombre: name, estado: "activo"});
        updateDraft("areaId", result.areaId);
      } else {
        const result = await saveInventoryCategory(businessId, {areaId: draft.areaId, nombre: name, estado: "activo"});
        updateDraft("categoriaId", result.categoriaId);
      }
      setQuickCreate("");
      setQuickName("");
    } catch (error) {
      setQuickError(error.message || `No se pudo crear ${quickCreate === "area" ? "el área" : "la categoría"}.`);
    } finally {
      setQuickSaving(false);
    }
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
        if (!createRequestRef.current) createRequestRef.current = requestId();
        await updateManagedInventoryItem(businessId, editingItem.id, payload, {
          requestId: createRequestRef.current,
        });
        createRequestRef.current = "";
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
  const usesPurchaseTaxPriceFormation = draft.tipoItem === "producto" &&
    Number(draft.formacionPrecioVersion) === INVENTORY_PRICE_FORMATION_VERSION;
  const purchaseTaxRate = parseInventoryNumber(draft.tasaImpuestoCompra);
  const purchaseTaxMode = !usesPurchaseTaxPriceFormation
    ? "historico"
    : purchaseTaxRate === 0
      ? "0"
      : purchaseTaxRate === 19
        ? "19"
        : "personalizado";
  const productPriceFormation = calculateInventoryPriceFormation({
    costoBase: parseInventoryNumber(draft.costoBase) || 0,
    tasaImpuestoCompra: purchaseTaxRate || 0,
    margenDeseado: parseInventoryNumber(draft.margenDeseado) || 0,
    precioInterno: parseInventoryNumber(draft.precioManual),
    precioManual: manualPriceEnabled && String(draft.precioManual).trim() !== "",
  });
  const legacyCalculatedPrice = Math.round(calculateBasePrice({ costoBase: parseInventoryNumber(draft.costoBase) || 0, margenDeseado: parseInventoryNumber(draft.margenDeseado) || 0 }));
  const calculatedPrice = usesPurchaseTaxPriceFormation
    ? productPriceFormation.precioVentaSugerido
    : legacyCalculatedPrice;
  const effectivePrice = usesPurchaseTaxPriceFormation
    ? productPriceFormation.precioVentaFinal
    : Math.round(calculateEffectiveInternalPrice({ costoBase: parseInventoryNumber(draft.costoBase) || 0, margenDeseado: parseInventoryNumber(draft.margenDeseado) || 0, precioInterno: parseInventoryNumber(draft.precioManual), precioManual: manualPriceEnabled && String(draft.precioManual).trim() !== "" }));
  const changePurchaseTaxMode = (mode) => {
    if (mode === "historico") return;
    setDraft((current) => ({
      ...current,
      formacionPrecioVersion: INVENTORY_PRICE_FORMATION_VERSION,
      tasaImpuestoCompra: mode === "19"
        ? "19"
        : mode === "0"
          ? "0"
          : (![0, 19].includes(parseInventoryNumber(current.tasaImpuestoCompra))
            ? current.tasaImpuestoCompra
            : ""),
    }));
    setFieldErrors((current) => ({ ...current, tasaImpuestoCompra: "" }));
  };

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
          <label className="erp-field inventory-search"><span className="erp-field__label">Buscar por nombre, SKU, código de barras, marca o modelo</span><input className="erp-control" value={filters.query} onChange={(event) => setFilter("query", event.target.value)} placeholder="Ej. NB-001, Lenovo o 7801234567890" /></label>
          <Filter label="Tipo" value={filters.type} onChange={(value) => setFilter("type", value)}><option value="todos">Todos</option>{INVENTORY_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</Filter>
          <Filter label="Área" value={filters.areaId} onChange={(value) => setFilter("areaId", value)}><option value="todas">Todas</option><option value="sin_area">Sin área</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.nombre}</option>)}</Filter>
          <Filter label="Categoría" value={filters.categoryId} onChange={(value) => setFilter("categoryId", value)} disabled={!filters.areaId || filters.areaId === "todas" || filters.areaId === "sin_area"}><option value="todas">Todas</option><option value="sin_categoria">Sin categoría</option>{filterCategories.map((category) => <option key={category.id} value={category.id}>{category.nombre}</option>)}</Filter>
          <Filter label="Estado" value={filters.status} onChange={(value) => setFilter("status", value)}><option value="activo">Activos</option><option value="inactivo">Archivados</option><option value="todos">Todos</option></Filter>
        </div>

        {loading ? <div className="erp-empty-state">Cargando inventario…</div> : visibleItems.length === 0 ? (
          <div className="erp-empty-state inventory-empty-state"><AppIcon icon={Boxes} size={34} /><h3>{items.length ? "No hay resultados" : "Tu inventario está listo para comenzar"}</h3><p>{items.length ? "Prueba cambiando la búsqueda o los filtros." : "Crea manualmente tu primer ítem o importa una planilla existente."}</p>{!cannotWrite && <div><button type="button" className="inventory-button inventory-button--primary" onClick={openNewItem}>Crear primer ítem</button><button type="button" className="inventory-button inventory-button--secondary" onClick={() => setImportOpen(true)}>Importar desde Excel</button></div>}</div>
        ) : <InventoryList items={visibleItems} areas={areas} categories={categories} cannotWrite={cannotWrite} onArchive={(item) => changeStatus(item, "inactivo")} onEdit={openEditItem} onReactivate={(item) => changeStatus(item, "activo")} onView={setDetailItem} />}
      </section>

      <ResponsiveDialog className="inventory-item-dialog" open={formOpen} onClose={closeForm} size="large" eyebrow="Inventario" title={editingItem ? "Editar ítem" : "Nuevo ítem"} description={editingItem ? `Código ${editingItem.codigoInterno || editingItem.sku || "heredado"}` : "Registra la identidad, clasificación y valores comerciales del ítem."} footer={<><Button type="button" variant="secondary" disabled={saving} onClick={closeForm}>Cancelar</Button><Button type="submit" form="inventory-item-form" disabled={saving}>{saving ? "Guardando…" : editingItem ? "Guardar cambios" : "Crear ítem"}</Button></>}>
        <form id="inventory-item-form" className="inventory-item-form" onSubmit={saveItem}>
          <div className="inventory-type-selector" role="group" aria-label="Tipo de ítem">{INVENTORY_TYPES.map((type) => { const TypeIcon = INVENTORY_TYPE_ICONS[type.value]; return <button key={type.value} type="button" className={draft.tipoItem === type.value ? "is-active" : ""} aria-pressed={draft.tipoItem === type.value} disabled={Boolean(editingItem) && draft.tipoItem !== type.value} onClick={() => selectType(type.value)}><AppIcon icon={TypeIcon} size={16} />{type.label}</button>; })}</div>
            <section className="inventory-form-section"><h3>Identificación</h3>
              <div className="inventory-identity-primary">
                <Field label="Nombre del ítem" required error={fieldErrors.nombre}><input autoFocus className="erp-control" value={draft.nombre} onChange={(event) => updateDraft("nombre", event.target.value)} maxLength={140} /></Field>
                <Field label="Código interno" error={fieldErrors.codigoSolicitado} hint={editingItem ? "No se puede modificar." : "Se asignará al guardar si queda vacío."}><input className="erp-control inventory-code-input" disabled={Boolean(editingItem)} value={editingItem ? draft.codigoInterno : draft.codigoSolicitado} onChange={(event) => updateDraft("codigoSolicitado", event.target.value)} maxLength={40} placeholder="Ej. NB-001" /></Field>
              </div>
              {draft.tipoItem === "producto" && <div className="inventory-product-identity"><Field label="Marca" error={fieldErrors.marca}><input className="erp-control" value={draft.marca} onChange={(event) => updateDraft("marca", event.target.value)} maxLength={100} placeholder="Ej. Lenovo" /></Field><Field label="Modelo" error={fieldErrors.modelo}><input className="erp-control" value={draft.modelo} onChange={(event) => updateDraft("modelo", event.target.value)} maxLength={100} placeholder="Ej. ThinkPad E13" /></Field><Field label="Código de barras" error={fieldErrors.codigoBarras} hint="Conserva ceros iniciales."><input className="erp-control inventory-code-input" value={draft.codigoBarras} onChange={(event) => updateDraft("codigoBarras", event.target.value)} maxLength={120} autoComplete="off" placeholder="Ej. 07801234567890" /></Field></div>}
              <Field label="Descripción"><textarea className="erp-control inventory-textarea" rows="2" maxLength={1200} value={draft.descripcion} onChange={(event) => updateDraft("descripcion", event.target.value)} /></Field>
            </section>
            <section className="inventory-form-section"><h3>Clasificación</h3><div className="inventory-classification-grid">
              <UnitSelector type={draft.tipoItem} value={draft.unidad} error={fieldErrors.unidad} onChange={(value) => updateDraft("unidad", value)} />
              <CatalogSelect label="Área" value={draft.areaId} onChange={(value) => updateDraft("areaId", value)} onCreate={() => openQuickCreate("area")}><option value="">Sin área</option>{activeAreas.map((area) => <option key={area.id} value={area.id}>{area.nombre}</option>)}</CatalogSelect>
              <CatalogSelect label="Categoría" value={draft.categoriaId} disabled={!draft.areaId} error={fieldErrors.categoriaId} createDisabled={!draft.areaId} createTitle={!draft.areaId ? "Selecciona un área primero" : "Crear categoría"} onChange={(value) => updateDraft("categoriaId", value)} onCreate={() => openQuickCreate("category")}><option value="">Sin categoría</option>{formCategories.map((category) => <option key={category.id} value={category.id}>{category.nombre}</option>)}</CatalogSelect>
            </div><button type="button" className="inventory-link-button" onClick={openCatalogManager}>Administrar áreas y categorías</button></section>
            <section className="inventory-form-section">
              <h3>Precio</h3>
              {draft.tipoItem === "producto" ? <>
                <div className="inventory-price-grid">
                  <Field label="Costo unitario neto" required error={fieldErrors.costoBase}><input className="erp-control" type="number" min="0" step="any" value={draft.costoBase} onChange={(event) => updateDraft("costoBase", event.target.value)} /></Field>
                  <Field label="IVA de compra" required error={fieldErrors.tasaImpuestoCompra}>
                    <select className="erp-control" value={purchaseTaxMode} onChange={(event) => changePurchaseTaxMode(event.target.value)}>
                      {!usesPurchaseTaxPriceFormation && <option value="historico">Sin IVA / esquema anterior</option>}
                      <option value="0">Sin IVA / 0%</option>
                      <option value="19">19%</option>
                      <option value="personalizado">Personalizado</option>
                    </select>
                  </Field>
                  <PriceResult label="Costo pagado" value={productPriceFormation.costoPagado} detail={`IVA: ${formatCLP(productPriceFormation.montoImpuestoCompra)}`} />
                </div>
                {purchaseTaxMode === "personalizado" && <div className="inventory-custom-tax-field"><Field label="Tasa personalizada (%)" required error={fieldErrors.tasaImpuestoCompra}><input className="erp-control" type="number" min="0" max="100" step="any" value={draft.tasaImpuestoCompra} onChange={(event) => updateDraft("tasaImpuestoCompra", event.target.value)} /></Field></div>}
                <div className="inventory-price-grid inventory-price-grid--commercial">
                  <Field label="Recargo (%)" required error={fieldErrors.margenDeseado}><input className="erp-control" type="number" min="0" max="1000" step="any" value={draft.margenDeseado} onChange={(event) => updateDraft("margenDeseado", event.target.value)} /></Field>
                  <PriceResult label="Precio sugerido" value={calculatedPrice} />
                  <PriceResult label="Precio de venta final" value={effectivePrice} tone="final" />
                </div>
              </> : <div className="inventory-price-grid">
                <Field label="Costo unitario" required error={fieldErrors.costoBase}><input className="erp-control" type="number" min="0" step="any" value={draft.costoBase} onChange={(event) => updateDraft("costoBase", event.target.value)} /></Field>
                <Field label="Recargo (%)" required error={fieldErrors.margenDeseado}><input className="erp-control" type="number" min="0" max="1000" step="any" value={draft.margenDeseado} onChange={(event) => updateDraft("margenDeseado", event.target.value)} /></Field>
                <PriceResult label="Precio de venta final" value={effectivePrice} tone="final" detail={manualPriceEnabled && String(draft.precioManual).trim() !== "" ? `Sugerido: ${formatCLP(calculatedPrice)}` : ""} />
              </div>}
              <label className="inventory-manual-price-toggle"><input type="checkbox" checked={manualPriceEnabled} onChange={(event) => { const enabled = event.target.checked; setManualPriceEnabled(enabled); if (!enabled) updateDraft("precioManual", ""); }} /><span>Definir precio de venta manual</span></label>
              {manualPriceEnabled && <div className="inventory-manual-price-field"><Field label="Precio de venta final" error={fieldErrors.precioManual}><input className="erp-control" type="number" min="0" step="any" value={draft.precioManual} onChange={(event) => updateDraft("precioManual", event.target.value)} /></Field></div>}
            </section>
            {draft.tipoItem === "producto" && <section className="inventory-form-section"><h3>Existencias</h3><div className="inventory-form-grid inventory-form-grid--three"><Field label="Stock actual" error={fieldErrors.stock}><input className="erp-control" type="number" min="0" step="any" value={draft.stock} onChange={(event) => updateDraft("stock", event.target.value)} /></Field><Field label="Stock mínimo" error={fieldErrors.stockMinimo}><input className="erp-control" type="number" min="0" step="any" value={draft.stockMinimo} onChange={(event) => updateDraft("stockMinimo", event.target.value)} /></Field><Field label="Unidad de inventario"><select className="erp-control" value={draft.unidadStock} onChange={(event) => updateDraft("unidadStock", event.target.value)}><option value={draft.unidad}>{draft.unidad || "Unidad seleccionada"}</option><option value="unidad">Unidad</option></select></Field></div><p className="inventory-stock-helper">Se marcará como stock bajo al alcanzar el mínimo.</p></section>}
            {feedback.type === "error" && <p className="inventory-feedback inventory-feedback--error" role="alert">{feedback.message}</p>}
        </form>
      </ResponsiveDialog>

      <ResponsiveDialog className="inventory-catalog-dialog" open={catalogOpen} onClose={closeCatalogManager} size="large" eyebrow="Inventario" title="Áreas y categorías" description="Organiza el catálogo según las necesidades de tu negocio."><InventoryCatalogManager areas={areas} businessId={businessId} categories={categories} loadErrors={catalogState.errors} loading={catalogState.loading} onRetry={() => setCatalogState((current) => ({ ...current, retry: current.retry + 1 }))} /></ResponsiveDialog>
      <ResponsiveDialog open={Boolean(quickCreate)} onClose={closeQuickCreate} initialFocusRef={quickNameRef} size="small" eyebrow="Clasificación" title={quickCreate === "area" ? "Nueva área" : "Nueva categoría"} description={quickCreate === "area" ? "Crea un área sin perder los datos del ítem." : "La categoría quedará asociada al área seleccionada."} footer={<><Button type="button" variant="secondary" disabled={quickSaving} onClick={closeQuickCreate}>Cancelar</Button><Button type="submit" form="inventory-quick-classification-form" disabled={quickSaving}>{quickSaving ? "Creando..." : quickCreate === "area" ? "Crear área" : "Crear categoría"}</Button></>}><form id="inventory-quick-classification-form" className="inventory-quick-classification-form" onSubmit={submitQuickCreate}>{quickCreate === "category" && <p>Área: <strong>{areas.find((area) => area.id === draft.areaId)?.nombre || "Área seleccionada"}</strong></p>}<Field label="Nombre" required error={quickError}><input ref={quickNameRef} className="erp-control" maxLength={80} value={quickName} onChange={(event) => { setQuickName(event.target.value); setQuickError(""); }} /></Field></form></ResponsiveDialog>
      <InventoryImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={(info) => setFeedback(info?.partial ? { type: "notice", message: "La importación quedó parcial; revisa el resumen antes de continuar." } : { type: "success", message: "Importación confirmada correctamente." })} businessId={businessId} areas={areas} categories={categories} existingItems={items} />
      <ItemDetail item={detailItem} areas={areas} categories={categories} acquisitions={acquisitions} acquisitionsState={acquisitionsState} cannotWrite={cannotWrite} showCosts={canReadCosts} onClose={() => setDetailItem(null)} onEdit={openEditItem} onArchive={(item) => changeStatus(item, "inactivo")} onReactivate={(item) => changeStatus(item, "activo")} />
    </section>
  );
}

function Metric({ label, tone, value }) { return <article className={`erp-metric-card${tone ? ` inventory-metric--${tone}` : ""}`}><span className="erp-metric-card__label">{label}</span><strong className="erp-metric-card__value">{value}</strong></article>; }
function Filter({ children, disabled, label, onChange, value }) { return <label className="erp-field"><span className="erp-field__label">{label}</span><select className="erp-control" disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>; }
function Field({ children, error, hint, label, required }) { return <label className="erp-field"><span className="erp-field__label">{label}{required ? " *" : ""}</span>{children}{hint && <small className="inventory-field-hint">{hint}</small>}{error && <small className="inventory-field-error">{error}</small>}</label>; }
function PriceResult({ detail, label, tone = "", value }) { return <div className={`inventory-sale-price${tone ? ` inventory-sale-price--${tone}` : ""}`}><span>{label}</span><strong>{formatCLP(value)}</strong>{detail && <small>{detail}</small>}</div>; }
function CatalogSelect({children, createDisabled, createTitle, disabled, error, label, onChange, onCreate, value}) { return <label className="erp-field inventory-catalog-select-field"><span className="erp-field__label">{label}</span><span><select className="erp-control" disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select><button type="button" disabled={createDisabled} title={createTitle || `Crear ${label.toLowerCase()}`} aria-label={`Crear ${label.toLowerCase()}`} onClick={onCreate}>+</button></span>{error && <small className="inventory-field-error">{error}</small>}</label>; }

function IdentityMetadata({ item }) {
  const metadata = [item.marca, item.modelo].filter(Boolean).join(" · ");
  return metadata ? <small className="inventory-identity-meta">{metadata}</small> : null;
}

function StockPresentation({ item }) {
  if (item.tipoItem !== "producto") {
    return <span className="inventory-no-stock">Sin existencias</span>;
  }
  return <div className="inventory-stock-cell"><span>{item.stock} {item.unidadStock || item.unidad}</span>{isInventoryLowStock(item) && <span className="inventory-stock-low">Stock bajo</span>}</div>;
}

function InventoryList({ areas, cannotWrite, categories, items, onArchive, onEdit, onReactivate, onView }) {
  return <><div className="erp-table-region erp-desktop-only"><table className="erp-table inventory-table"><thead><tr><th>SKU</th><th>Ítem</th><th>Tipo</th><th>Stock</th><th>Precio</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td className="inventory-code">{item.codigoInterno || item.sku || "—"}</td><td><button className="inventory-item-link" type="button" onClick={() => onView(item)}>{item.nombre}</button><IdentityMetadata item={item} /></td><td>{getInventoryTypeLabel(item.tipoItem)}<small>{item.unidad}</small></td><td><StockPresentation item={item} /></td><td><strong>{formatCLP(item.precioEfectivo)}</strong></td><td><Status item={item} /></td><td><Actions item={item} cannotWrite={cannotWrite} onArchive={onArchive} onEdit={onEdit} onReactivate={onReactivate} /></td></tr>)}</tbody></table></div><div className="erp-card-list erp-mobile-only">{items.map((item) => <article className="erp-record-card inventory-mobile-card" key={item.id}><header className="erp-record-card__header"><div><span className="inventory-code">{item.codigoInterno || item.sku || "Sin código"}</span><h3 className="erp-record-card__title">{item.nombre}</h3><IdentityMetadata item={item} /><p className="erp-record-card__subtitle">{getInventoryTypeLabel(item.tipoItem)} · {item.unidad}</p></div><Status item={item} /></header><dl className="erp-meta-grid"><div className="erp-meta"><dt className="erp-meta__label">Clasificación</dt><dd className="erp-meta__value">{getInventoryAreaLabel(item, areas)} / {getInventoryCategoryLabel(item, categories)}</dd></div><div className="erp-meta"><dt className="erp-meta__label">Costo / precio</dt><dd className="erp-meta__value">{formatCLP(item.costoBase)} / {formatCLP(item.precioEfectivo)}</dd></div><div className="erp-meta"><dt className="erp-meta__label">Stock</dt><dd className="erp-meta__value"><StockPresentation item={item} /></dd></div></dl><button type="button" className="inventory-button inventory-button--secondary" onClick={() => onView(item)}>Ver detalle</button><Actions item={item} cannotWrite={cannotWrite} onArchive={onArchive} onEdit={onEdit} onReactivate={onReactivate} /></article>)}</div></>;
}

function Status({ item }) { return <span className={`inventory-status inventory-status--${item.estado === "activo" ? "active" : "archived"}`}>{item.estado === "activo" ? "Activo" : "Archivado"}</span>; }
function Actions({ cannotWrite, item, onArchive, onEdit, onReactivate }) { if (cannotWrite) return null; return <div className="inventory-row-actions"><button type="button" onClick={() => onEdit(item)}>Editar</button>{item.estado === "activo" ? <button type="button" onClick={() => onArchive(item)}><AppIcon icon={Archive} size={15} />Archivar</button> : <button type="button" onClick={() => onReactivate(item)}><AppIcon icon={RotateCcw} size={15} />Reactivar</button>}</div>; }

function ItemDetail({ acquisitions, acquisitionsState, areas, cannotWrite, categories, item, onArchive, onClose, onEdit, onReactivate, showCosts }) {
  if (!item) return null;
  const adapted = adaptInventoryItem(item);
  const currency = adapted.costoPromedioMoneda || "CLP";
  const providerName = adapted.ultimoProveedor?.razonSocial || "Sin adquisiciones registradas";
  return <ResponsiveDialog open onClose={onClose} size="large" eyebrow="Inventario" title={adapted.nombre} description={adapted.codigoInterno || adapted.sku || "Registro heredado sin código"} footer={!cannotWrite ? <Actions item={adapted} onEdit={onEdit} onArchive={onArchive} onReactivate={onReactivate} /> : null}>
    <dl className="inventory-detail-grid">
      <Detail label="SKU / código interno" value={adapted.codigoInterno || "No informado"} />
      {adapted.tipoItem === "producto" && <><Detail label="Marca" value={adapted.marca || "No informada"} /><Detail label="Modelo" value={adapted.modelo || "No informado"} /><Detail label="Código de barras" value={adapted.codigoBarras || "No informado"} /></>}
      <Detail label="Tipo" value={getInventoryTypeLabel(adapted.tipoItem)} />
      <Detail label="Área" value={getInventoryAreaLabel(adapted, areas)} />
      <Detail label="Categoría" value={getInventoryCategoryLabel(adapted, categories)} />
      <Detail label="Unidad" value={adapted.unidad} />
      {adapted.tipoItem === "producto" ? <>
        <Detail label="Costo unitario neto" value={formatCLP(adapted.costoBase)} />
        <Detail label="IVA de compra" value={`${adapted.tasaImpuestoCompra}% · ${formatCLP(adapted.montoImpuestoCompra)}`} />
        <Detail label="Costo pagado" value={formatCLP(adapted.costoPagado)} />
        {showCosts && <Detail label="Costo promedio" value={adapted.costoPromedio === null ? "Sin adquisiciones" : formatMoney(adapted.costoPromedio, currency)} />}
        {showCosts && <Detail label="Último costo" value={adapted.ultimoCosto === null ? "Sin adquisiciones" : formatMoney(adapted.ultimoCosto, currency)} />}
        {showCosts && <Detail label="Último proveedor" value={providerName} />}
        <Detail label="Recargo" value={`${adapted.margenDeseado}%`} />
        <Detail label="Precio sugerido" value={formatCLP(adapted.precioCalculado)} />
        <Detail label="Precio de venta final" value={formatCLP(adapted.precioEfectivo)} />
      </> : <>
        <Detail label="Costo unitario" value={formatCLP(adapted.costoBase)} />
        <Detail label="Recargo" value={`${adapted.margenDeseado}%`} />
        <Detail label="Precio sugerido" value={formatCLP(adapted.precioCalculado)} />
        <Detail label="Precio de venta final" value={formatCLP(adapted.precioEfectivo)} />
      </>}
      {adapted.tipoItem === "producto" && <><Detail label="Stock actual" value={`${adapted.stock} ${adapted.unidadStock || adapted.unidad}`} /><Detail label="Stock mínimo" value={adapted.stockMinimo} /><Detail label="Nivel de stock" value={isInventoryLowStock(adapted) ? "Stock bajo" : "Disponible"} /></>}
    </dl>
    {adapted.descripcion && <div className="inventory-detail-description"><strong>Descripción</strong><p>{adapted.descripcion}</p></div>}
    {showCosts && adapted.tipoItem === "producto" && <AcquisitionHistory acquisitions={acquisitions} state={acquisitionsState} />}
  </ResponsiveDialog>;
}
function AcquisitionHistory({ acquisitions, state }) {
  return <section className="inventory-acquisition-history">
    <h3>Historial de adquisiciones</h3>
    {state.loading ? <p>Cargando adquisiciones…</p> : state.error ? <p className="inventory-feedback inventory-feedback--error">{state.error}</p> : acquisitions.length === 0 ? <p>Este producto aún no tiene adquisiciones registradas desde Recepción.</p> : <div className="inventory-acquisition-list">{acquisitions.map((entry) => {
      const provider = entry.proveedorSnapshot?.razonSocial || "Proveedor no informado";
      const chain = [entry.ordenCompraNumero, entry.recepcionNumero, entry.compraNumero].filter(Boolean).join(" · ");
      return <article key={entry.id}>
        <div><strong>{formatDate(entry.fechaAdquisicion)}</strong><span>{provider}</span></div>
        <div><strong>{entry.cantidad} {entry.productoSnapshot?.unidad || "unidad"}</strong><span>{formatMoney(entry.costoPagadoUnitario, entry.moneda)} c/u · {formatMoney(entry.costoPagadoTotal, entry.moneda)} total</span></div>
        <small>{chain || "Origen documental no informado"} · UID {entry.registradoPorUid || "no informado"}</small>
      </article>;
    })}</div>}
  </section>;
}
function Detail({ label, value }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }

export default InventoryManager;
