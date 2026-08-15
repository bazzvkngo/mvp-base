import React, {useEffect, useMemo, useRef, useState} from "react";
import Button from "../../components/ui/Button";
import {isDuplicateAreaName, isDuplicateCategoryName} from "../../domain/inventoryCatalog.mjs";
import {saveInventoryArea, saveInventoryCategory} from "../../services/inventoryService";

function InventoryCatalogManager({areas, businessId, categories, loadErrors, loading, onRetry}) {
  const areaNameRef = useRef(null);
  const categoryNameRef = useRef(null);
  const [selectedAreaId, setSelectedAreaId] = useState("");
  const [areaForm, setAreaForm] = useState(null);
  const [categoryForm, setCategoryForm] = useState(null);
  const [savingArea, setSavingArea] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedArea = useMemo(
    () => areas.find((area) => area.id === selectedAreaId) || null,
    [areas, selectedAreaId]
  );
  const selectedCategories = useMemo(
    () => categories.filter((category) => category.areaId === selectedAreaId),
    [categories, selectedAreaId]
  );
  const categoryCounts = useMemo(() => {
    const counts = new Map();
    categories.forEach((category) => counts.set(category.areaId, (counts.get(category.areaId) || 0) + 1));
    return counts;
  }, [categories]);

  useEffect(() => {
    if (areas.some((area) => area.id === selectedAreaId)) return;
    const firstArea = areas.find((area) => (area.estado || "activo") === "activo") || areas[0];
    setSelectedAreaId(firstArea?.id || "");
  }, [areas, selectedAreaId]);

  const clearMessages = () => { setError(""); setNotice(""); };
  const focusArea = () => window.setTimeout(() => areaNameRef.current?.focus(), 0);
  const focusCategory = () => window.setTimeout(() => categoryNameRef.current?.focus(), 0);
  const openNewArea = () => { clearMessages(); setAreaForm({id: "", nombre: ""}); focusArea(); };
  const openNewCategory = () => {
    if (!selectedAreaId) return;
    clearMessages();
    setCategoryForm({id: "", areaId: selectedAreaId, nombre: ""});
    focusCategory();
  };

  const submitArea = async (event) => {
    event.preventDefault();
    if (!areaForm) return;
    clearMessages();
    if (isDuplicateAreaName(areas, areaForm.nombre, areaForm.id)) {
      setError("Ya existe un área con ese nombre.");
      return;
    }
    try {
      setSavingArea(true);
      const result = await saveInventoryArea(businessId, {
        areaId: areaForm.id || undefined,
        nombre: areaForm.nombre,
        estado: areas.find((area) => area.id === areaForm.id)?.estado || "activo",
      });
      setSelectedAreaId(result.areaId);
      setAreaForm(null);
      setNotice(areaForm.id ? "Área actualizada." : "Área creada.");
    } catch (saveError) {
      setError(saveError.message || "No se pudo guardar el área.");
    } finally {
      setSavingArea(false);
    }
  };

  const submitCategory = async (event) => {
    event.preventDefault();
    if (!categoryForm) return;
    clearMessages();
    if (isDuplicateCategoryName(categories, categoryForm.areaId, categoryForm.nombre, categoryForm.id)) {
      setError("Ya existe una categoría con ese nombre dentro del área.");
      return;
    }
    try {
      setSavingCategory(true);
      await saveInventoryCategory(businessId, {
        categoriaId: categoryForm.id || undefined,
        areaId: categoryForm.areaId,
        nombre: categoryForm.nombre,
        estado: categories.find((category) => category.id === categoryForm.id)?.estado || "activo",
      });
      setCategoryForm(null);
      setNotice(categoryForm.id ? "Categoría actualizada." : "Categoría creada.");
    } catch (saveError) {
      setError(saveError.message || "No se pudo guardar la categoría.");
    } finally {
      setSavingCategory(false);
    }
  };

  const toggleArea = async (area) => {
    clearMessages();
    try {
      await saveInventoryArea(businessId, {areaId: area.id, nombre: area.nombre, estado: area.estado === "inactivo" ? "activo" : "inactivo"});
      setNotice(area.estado === "inactivo" ? "Área reactivada." : "Área desactivada.");
    } catch (toggleError) {
      setError(toggleError.message || "No se pudo cambiar el estado del área.");
    }
  };

  const toggleCategory = async (category) => {
    clearMessages();
    try {
      await saveInventoryCategory(businessId, {categoriaId: category.id, areaId: category.areaId, nombre: category.nombre, estado: category.estado === "inactivo" ? "activo" : "inactivo"});
      setNotice(category.estado === "inactivo" ? "Categoría reactivada." : "Categoría desactivada.");
    } catch (toggleError) {
      setError(toggleError.message || "No se pudo cambiar el estado de la categoría.");
    }
  };

  if (loading) return <p className="inventory-catalog-loading" role="status">Cargando áreas y categorías...</p>;
  if (loadErrors?.areas || loadErrors?.categories) {
    return <div className="inventory-catalog-load-error" role="alert"><strong>No fue posible cargar el catálogo.</strong>{loadErrors.areas && <span>Áreas: {loadErrors.areas}</span>}{loadErrors.categories && <span>Categorías: {loadErrors.categories}</span>}<Button type="button" variant="secondary" onClick={onRetry}>Reintentar carga</Button></div>;
  }
  if (areas.length === 0) {
    return <div className="inventory-catalog-empty"><h3>Aún no tienes áreas creadas.</h3><p>Las áreas y categorías son opcionales y te ayudan a organizar el catálogo según tu negocio.</p>{areaForm ? <AreaForm form={areaForm} inputRef={areaNameRef} onCancel={() => setAreaForm(null)} onChange={setAreaForm} onSubmit={submitArea} saving={savingArea} /> : <Button type="button" onClick={openNewArea}>Crear primera área</Button>}{error && <p className="inventory-catalog-message inventory-catalog-message--error" role="alert">{error}</p>}</div>;
  }

  return <div className="inventory-catalog-manager">
    <p className="inventory-catalog-help">Selecciona un área para administrar sus categorías. Los registros se desactivan en lugar de eliminarse.</p>
    {error && <p className="inventory-catalog-message inventory-catalog-message--error" role="alert">{error}</p>}
    {notice && <p className="inventory-catalog-message inventory-catalog-message--success" role="status">{notice}</p>}
    <div className="inventory-catalog-columns">
      <section className="inventory-catalog-column" aria-labelledby="inventory-areas-title">
        <header className="inventory-catalog-column__header"><div><span className="inventory-catalog-kicker">Organización</span><h3 id="inventory-areas-title">Áreas</h3></div><Button type="button" variant="secondary" className="inventory-catalog-add" onClick={openNewArea}>+ Nueva área</Button></header>
        {areaForm && <AreaForm form={areaForm} inputRef={areaNameRef} onCancel={() => setAreaForm(null)} onChange={setAreaForm} onSubmit={submitArea} saving={savingArea} />}
        <ul className="inventory-catalog-list">{areas.map((area) => <li key={area.id} className={area.id === selectedAreaId ? "is-selected" : ""}><button type="button" className="inventory-catalog-select" onClick={() => { setSelectedAreaId(area.id); setCategoryForm(null); }}><strong>{area.nombre}</strong><small>{categoryCounts.get(area.id) || 0} categorías · {area.estado === "inactivo" ? "Inactiva" : "Activa"}</small></button><span className="inventory-catalog-row-actions"><button type="button" onClick={() => { setAreaForm({id: area.id, nombre: area.nombre}); focusArea(); }}>Editar</button><button type="button" onClick={() => toggleArea(area)}>{area.estado === "inactivo" ? "Activar" : "Desactivar"}</button></span></li>)}</ul>
      </section>
      <section className="inventory-catalog-column" aria-labelledby="inventory-categories-title">
        <header className="inventory-catalog-column__header"><div><span className="inventory-catalog-kicker">{selectedArea?.nombre || "Área"}</span><h3 id="inventory-categories-title">Categorías</h3></div><Button type="button" variant="secondary" className="inventory-catalog-add" disabled={!selectedArea || selectedArea.estado === "inactivo"} onClick={openNewCategory}>+ Nueva categoría</Button></header>
        {categoryForm && <CategoryForm areaName={selectedArea?.nombre} form={categoryForm} inputRef={categoryNameRef} onCancel={() => setCategoryForm(null)} onChange={setCategoryForm} onSubmit={submitCategory} saving={savingCategory} />}
        {selectedCategories.length ? <ul className="inventory-catalog-list">{selectedCategories.map((category) => <li key={category.id}><span className="inventory-catalog-row-copy"><strong>{category.nombre}</strong><small>{category.estado === "inactivo" ? "Inactiva" : "Activa"}</small></span><span className="inventory-catalog-row-actions"><button type="button" onClick={() => { setCategoryForm({id: category.id, areaId: category.areaId, nombre: category.nombre}); focusCategory(); }}>Editar</button><button type="button" onClick={() => toggleCategory(category)}>{category.estado === "inactivo" ? "Activar" : "Desactivar"}</button></span></li>)}</ul> : <div className="inventory-catalog-column-empty"><p>Esta área todavía no tiene categorías.</p>{selectedArea?.estado !== "inactivo" && <button type="button" onClick={openNewCategory}>Crear primera categoría</button>}</div>}
      </section>
    </div>
  </div>;
}

function AreaForm({form, inputRef, onCancel, onChange, onSubmit, saving}) {
  return <form className="inventory-catalog-inline-form" onSubmit={onSubmit}><label><span>Nombre del área</span><input ref={inputRef} className="erp-control" required maxLength={80} value={form.nombre} onChange={(event) => onChange({...form, nombre: event.target.value})} /></label><div><Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? "Guardando..." : form.id ? "Actualizar" : "Crear área"}</Button></div></form>;
}

function CategoryForm({areaName, form, inputRef, onCancel, onChange, onSubmit, saving}) {
  return <form className="inventory-catalog-inline-form" onSubmit={onSubmit}><p>Área: <strong>{areaName}</strong></p><label><span>Nombre de la categoría</span><input ref={inputRef} className="erp-control" required maxLength={80} value={form.nombre} onChange={(event) => onChange({...form, nombre: event.target.value})} /></label><div><Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? "Guardando..." : form.id ? "Actualizar" : "Crear categoría"}</Button></div></form>;
}

export default InventoryCatalogManager;
