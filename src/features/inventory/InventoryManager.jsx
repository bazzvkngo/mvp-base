import React, { useEffect, useMemo, useState } from "react";
import { PackageOpen } from "lucide-react";
import AppIcon from "../../components/ui/AppIcon";
import ResponsiveDialog from "../../components/ui/ResponsiveDialog";
import InventoryCatalogManager from "./InventoryCatalogManager";
import {
  buildNewCategoryPayload,
  getCategoriesForArea,
  getInventoryAreaLabel,
  getInventoryCategoryLabel,
  isDuplicateCategoryName,
  keepCompatibleCategoryId,
  OTHER_CATEGORY_OPTION,
} from "../../domain/inventoryCatalog.mjs";
import {
  createManagedInventoryItem,
  deactivateInventoryItem,
  getInventoryItems,
  reactivateInventoryItem,
  saveInventoryCategory,
  subscribeToInventoryAreas,
  subscribeToInventoryCategories,
  subscribeToInventory,
  updateManagedInventoryItem,
} from "../../services/inventoryService";
import { formatCLP, formatPercent } from "../../utils/formatters";
import {
  DEFAULT_INVENTORY_SETTINGS,
  getBusinessSettings,
} from "../../services/companyService";

const EMPTY_FORM = {
  tipoItem: "",
  areaId: "",
  categoriaId: "",
  categoria: "",
  nombre: "",
  descripcion: "",
  unidad: "",
  costoBase: "",
  margenDeseado: "",
  precioInterno: "",
  marca: "",
  modelo: "",
  stock: "0",
  stockMinimo: "0",
  codigoBarras: "",
  estado: "activo",
};

const tipoLabels = {
  producto: "Producto",
  servicio: "Servicio",
  actividad: "Actividad",
};

const estadoLabels = {
  activo: "Activo",
  inactivo: "Inactivo",
  eliminado: "Eliminado",
};

const OTHER_OPTION = "__otro__";
const MANUAL_PRICE_FLAGS = [
  "precioManual",
  "ajusteManual",
  "usarPrecioManual",
  "precioPersonalizado",
];

const UNIT_OPTIONS = [
  { value: "servicio", label: "Servicio" },
  { value: "hora", label: "Hora" },
  { value: "equipo", label: "Equipo" },
  { value: "visita", label: "Visita" },
  { value: "punto", label: "Punto" },
  { value: "metro", label: "Metro" },
  { value: "unidad", label: "Unidad" },
  { value: "proyecto", label: "Proyecto" },
  { value: "mes", label: "Mes" },
  { value: "cuenta", label: "Cuenta" },
];

function calcularPrecioInterno(costoBase, margenDeseado) {
  const costo = Number(costoBase);
  const margen = Number(margenDeseado);
  if (!Number.isFinite(costo) || !Number.isFinite(margen)) return "";
  return Math.round(costo + (costo * margen) / 100);
}

function calculateGrossProfitability(costoBase, precioInternoEfectivo) {
  const costo = Number(costoBase);
  const precio = Number(precioInternoEfectivo);

  if (
    !Number.isFinite(costo) ||
    !Number.isFinite(precio) ||
    costo <= 0 ||
    precio <= 0
  ) {
    return null;
  }

  const gananciaBruta = precio - costo;
  const margenBrutoEstimado = (gananciaBruta / precio) * 100;

  if (!Number.isFinite(margenBrutoEstimado)) return null;

  return {
    gananciaBruta,
    margenBrutoEstimado,
  };
}

function getProfitabilityStyle(gananciaBruta) {
  if (gananciaBruta > 0) return styles.profitabilityPositive;
  if (gananciaBruta < 0) return styles.profitabilityNegative;
  return styles.profitabilityNeutral;
}

function formatSignedCLP(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return formatCLP(0);
  if (amount < 0) return `-${formatCLP(Math.abs(amount))}`;
  return formatCLP(amount);
}

function normalizeOptionText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function findStandardUnit(value) {
  const normalized = normalizeOptionText(value);
  if (!normalized) return null;
  return (
    UNIT_OPTIONS.find(
      (option) =>
        normalizeOptionText(option.value) === normalized ||
        normalizeOptionText(option.label) === normalized
    ) || null
  );
}

function getUnitSelectValue(value) {
  if (!value) return "";
  return findStandardUnit(value)?.value || OTHER_OPTION;
}

function hasManualPriceOverride(item) {
  return MANUAL_PRICE_FLAGS.some((flag) => item?.[flag] === true);
}

function formatFirestoreDate(value) {
  if (!value) return "-";
  if (typeof value.toDate === "function") {
    return value.toDate().toLocaleString("es-CL");
  }
  if (value instanceof Date) {
    return value.toLocaleString("es-CL");
  }
  return "-";
}

function createInventoryRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function getCatalogLoadErrorMessage(scope, error) {
  const label = scope === "areas" ? "las áreas" : "las categorías";
  const code = String(error?.code || "");
  if (code.includes("permission-denied")) {
    return `No fue posible acceder a ${label}. Revisa la sesión y la configuración local.`;
  }
  if (code.includes("unavailable") || code.includes("network")) {
    return `No fue posible conectar con ${label}. Comprueba los emuladores locales.`;
  }
  return `No se pudieron cargar ${label}.`;
}

function InventoryManager({ userId, refreshSignal = 0, readOnly = false }) {
  const [items, setItems] = useState([]);
  const [areas, setAreas] = useState([]);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [inventorySettings, setInventorySettings] = useState(
    DEFAULT_INVENTORY_SETTINGS
  );
  const [tipoFiltro, setTipoFiltro] = useState("todos");
  const [areaFiltro, setAreaFiltro] = useState("todas");
  const [categoriaFiltro, setCategoriaFiltro] = useState("todas");
  const [estadoFiltro, setEstadoFiltro] = useState("activos");
  const [busqueda, setBusqueda] = useState("");
  const [unidadPersonalizada, setUnidadPersonalizada] = useState("");
  const [unidadOtroActiva, setUnidadOtroActiva] = useState(false);
  const [detailItem, setDetailItem] = useState(null);
  const [catalogDialogOpen, setCatalogDialogOpen] = useState(false);
  const [customCategoryActive, setCustomCategoryActive] = useState(false);
  const [customCategoryName, setCustomCategoryName] = useState("");
  const [catalogRetrySignal, setCatalogRetrySignal] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState({
    areas: Boolean(userId),
    categories: Boolean(userId),
  });
  const [catalogLoadErrors, setCatalogLoadErrors] = useState({
    areas: "",
    categories: "",
  });
  const createRequestIdRef = React.useRef("");
  const saveInFlightRef = React.useRef(false);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const unsubscribe = subscribeToInventory(
      userId,
      (data) => {
        setItems(data);
        setLoading(false);
      },
      (err) => {
        console.error("Error al cargar inventario:", err);
        setError("No se pudo cargar el inventario.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;
    let active = true;
    getBusinessSettings(userId, "inventario")
      .then((settings) => active && setInventorySettings(settings))
      .catch((settingsError) => {
        if (import.meta.env.DEV) {
          console.error(
            "No se pudieron cargar las preferencias de inventario:",
            settingsError
          );
        }
      });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setCatalogLoading({ areas: false, categories: false });
      return undefined;
    }

    setCatalogLoading({ areas: true, categories: true });
    setCatalogLoadErrors({ areas: "", categories: "" });

    const unsubscribeAreas = subscribeToInventoryAreas(
      userId,
      (data) => {
        setAreas(data);
        setCatalogLoading((current) => ({ ...current, areas: false }));
        setCatalogLoadErrors((current) => ({ ...current, areas: "" }));
      },
      (catalogError) => {
        console.error("Error al cargar áreas de inventario:", {
          code: catalogError?.code || "unknown",
          message: catalogError?.message || "unknown",
        });
        setCatalogLoading((current) => ({ ...current, areas: false }));
        setCatalogLoadErrors((current) => ({
          ...current,
          areas: getCatalogLoadErrorMessage("areas", catalogError),
        }));
      }
    );
    const unsubscribeCategories = subscribeToInventoryCategories(
      userId,
      (data) => {
        setCategories(data);
        setCatalogLoading((current) => ({ ...current, categories: false }));
        setCatalogLoadErrors((current) => ({ ...current, categories: "" }));
      },
      (catalogError) => {
        console.error("Error al cargar categorías de inventario:", {
          code: catalogError?.code || "unknown",
          message: catalogError?.message || "unknown",
        });
        setCatalogLoading((current) => ({ ...current, categories: false }));
        setCatalogLoadErrors((current) => ({
          ...current,
          categories: getCatalogLoadErrorMessage("categories", catalogError),
        }));
      }
    );

    return () => {
      unsubscribeAreas();
      unsubscribeCategories();
    };
  }, [catalogRetrySignal, userId]);

  const catalogIsLoading = catalogLoading.areas || catalogLoading.categories;
  const catalogHasLoadError = Boolean(
    catalogLoadErrors.areas || catalogLoadErrors.categories
  );
  const catalogReady = !catalogIsLoading && !catalogHasLoadError;

  useEffect(() => {
    if (!userId || refreshSignal === 0) return;

    let active = true;
    getInventoryItems(userId)
      .then((data) => {
        if (active) {
          setItems(data);
        }
      })
      .catch((err) => {
        console.error("Error al recargar inventario:", err);
        if (active) {
          setError("No se pudo recargar el inventario después de importar.");
        }
      });

    return () => {
      active = false;
    };
  }, [refreshSignal, userId]);

  const activeAreas = useMemo(
    () => areas.filter((area) => (area.estado || "activo") === "activo"),
    [areas]
  );
  const formCategories = useMemo(
    () => getCategoriesForArea(categories, form.areaId),
    [categories, form.areaId]
  );
  const filterCategories = useMemo(
    () =>
      areaFiltro === "todas" || areaFiltro === "pendientes"
        ? []
        : getCategoriesForArea(categories, areaFiltro, { activeOnly: false }),
    [areaFiltro, categories]
  );

  const filteredItems = useMemo(() => {
    const q = busqueda.trim().toLowerCase();

    return items.filter((item) => {
      const estado = item.estado || "activo";
      if (estadoFiltro === "activos" && estado !== "activo") return false;
      if (estadoFiltro === "inactivos" && estado !== "inactivo") return false;
      if (estadoFiltro === "eliminados" && estado !== "eliminado") return false;
      if (tipoFiltro !== "todos" && item.tipoItem !== tipoFiltro) return false;
      if (areaFiltro === "pendientes" && item.areaId) return false;
      if (
        areaFiltro !== "todas" &&
        areaFiltro !== "pendientes" &&
        item.areaId !== areaFiltro
      ) {
        return false;
      }
      if (categoriaFiltro !== "todas" && item.categoriaId !== categoriaFiltro) {
        return false;
      }
      if (!q) return true;

      const text = `${item.codigoInterno || ""} ${item.sku || ""} ${
        item.nombre || ""
      } ${item.marca || ""} ${item.modelo || ""} ${getInventoryAreaLabel(
        item,
        areas
      )} ${getInventoryCategoryLabel(item, categories)} ${
        item.descripcion || ""
      }`.toLowerCase();
      return text.includes(q);
    });
  }, [
    areaFiltro,
    areas,
    busqueda,
    categoriaFiltro,
    categories,
    estadoFiltro,
    items,
    tipoFiltro,
  ]);

  const lowStockCount = useMemo(() => {
    if (!inventorySettings.alertasStockBajo) return 0;
    return items.filter((item) => {
      if (item.tipoItem !== "producto" || (item.estado || "activo") !== "activo") {
        return false;
      }
      const threshold = Math.max(
        Number(item.stockMinimo || 0),
        Number(inventorySettings.umbralStockBajo || 0)
      );
      return Number(item.stock || 0) <= threshold;
    }).length;
  }, [inventorySettings, items]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setUnidadPersonalizada("");
    setUnidadOtroActiva(false);
    setCustomCategoryActive(false);
    setCustomCategoryName("");
    createRequestIdRef.current = "";
    setError("");
    setSuccess("");
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      if (
        (name === "costoBase" || name === "margenDeseado") &&
        prev.precioInterno === ""
      ) {
        next.precioInterno = "";
      }
      return next;
    });
  };

  const handleAreaChange = (event) => {
    const areaId = event.target.value;
    setCustomCategoryActive(false);
    setCustomCategoryName("");
    setForm((current) => {
      const categoriaId = keepCompatibleCategoryId(
        categories,
        areaId,
        current.categoriaId
      );
      const category = categories.find((item) => item.id === categoriaId);
      return {
        ...current,
        areaId,
        categoriaId,
        categoria: category?.nombre || "",
      };
    });
  };

  const handleCategoryChange = (event) => {
    const categoriaId = event.target.value;
    if (categoriaId === OTHER_CATEGORY_OPTION) {
      setCustomCategoryActive(true);
      setCustomCategoryName("");
      setForm((current) => ({
        ...current,
        categoriaId: "",
        categoria: "",
      }));
      return;
    }
    setCustomCategoryActive(false);
    setCustomCategoryName("");
    const category = categories.find((item) => item.id === categoriaId);
    setForm((current) => ({
      ...current,
      categoriaId,
      categoria: category?.nombre || "",
    }));
  };

  const handleAreaFilterChange = (event) => {
    setAreaFiltro(event.target.value);
    setCategoriaFiltro("todas");
  };

  const handleUnidadChange = (event) => {
    const value = event.target.value;
    if (value === OTHER_OPTION) {
      setUnidadOtroActiva(true);
      const customValue = unidadPersonalizada || "";
      setForm((prev) => ({ ...prev, unidad: customValue }));
      return;
    }

    setUnidadOtroActiva(false);
    setUnidadPersonalizada("");
    setForm((prev) => ({ ...prev, unidad: value }));
  };

  const handleUnidadPersonalizadaChange = (event) => {
    const value = event.target.value;
    setUnidadOtroActiva(true);
    setUnidadPersonalizada(value);
    setForm((prev) => ({ ...prev, unidad: value }));
  };

  const validateForm = () => {
    if (!catalogReady) {
      return "No es posible validar Área y Categoría hasta recuperar el catálogo.";
    }
    if (!form.tipoItem) return "Selecciona el tipo de ítem.";
    if (!form.areaId) return "Selecciona un área.";
    if (customCategoryActive) {
      try {
        buildNewCategoryPayload(form.areaId, customCategoryName);
      } catch (categoryError) {
        return categoryError.message;
      }
      if (
        isDuplicateCategoryName(categories, form.areaId, customCategoryName)
      ) {
        return "Ya existe una categoría con ese nombre dentro del área.";
      }
    } else {
      if (!form.categoriaId) return "Selecciona una categoría.";
      if (!formCategories.some((category) => category.id === form.categoriaId)) {
        return "La categoría debe estar activa y pertenecer al área seleccionada.";
      }
    }
    if (!form.nombre.trim()) return "Ingresa el nombre del ítem.";
    if (!form.unidad.trim()) return "Ingresa la unidad.";
    if (form.costoBase === "") return "Ingresa el costo base.";
    if (form.margenDeseado === "") return "Ingresa el margen deseado.";
    if (!Number.isFinite(Number(form.costoBase))) {
      return "El costo base debe ser numérico.";
    }
    if (!Number.isFinite(Number(form.margenDeseado))) {
      return "El margen deseado debe ser numérico.";
    }
    if (form.precioInterno !== "" && !Number.isFinite(Number(form.precioInterno))) {
      return "El precio interno debe ser numérico.";
    }
    if (form.tipoItem === "producto") {
      if (!form.marca.trim()) return "La marca es obligatoria para productos.";
      if (!form.modelo.trim()) return "El modelo es obligatorio para productos.";
      if (
        !Number.isFinite(Number(form.stock)) ||
        (!inventorySettings.permitirStockNegativo && Number(form.stock) < 0)
      ) {
        return inventorySettings.permitirStockNegativo
          ? "El stock actual debe ser numérico."
          : "El stock actual debe ser un número mayor o igual a cero.";
      }
      if (!Number.isFinite(Number(form.stockMinimo)) || Number(form.stockMinimo) < 0) {
        return "El stock mínimo debe ser un número mayor o igual a cero.";
      }
    }
    return "";
  };

  const buildPayload = (resolvedCategory = null) => {
    const manualPrice = Number(form.precioInterno);
    const hasManualPrice =
      String(form.precioInterno ?? "").trim() !== "" &&
      Number.isFinite(manualPrice) &&
      manualPrice > 0;
    const precioCalculado =
      hasManualPrice
        ? form.precioInterno
        : calcularPrecioInterno(form.costoBase, form.margenDeseado);

    const category =
      resolvedCategory ||
      categories.find((item) => item.id === form.categoriaId);
    const payload = {
      tipoItem: form.tipoItem,
      areaId: form.areaId,
      categoriaId: category?.id || form.categoriaId,
      categoria: category?.nombre || form.categoria.trim(),
      nombre: form.nombre.trim(),
      descripcion: form.descripcion.trim(),
      unidad: form.unidad.trim(),
      costoBase: Number(form.costoBase),
      margenDeseado: Number(form.margenDeseado),
      precioInterno: Number(precioCalculado),
      precioManual: hasManualPrice,
      estado: form.estado,
    };
    if (form.tipoItem === "producto") {
      payload.marca = form.marca.trim();
      payload.modelo = form.modelo.trim();
      payload.stock = Number(form.stock);
      payload.stockMinimo = Number(form.stockMinimo);
      payload.codigoBarras = form.codigoBarras.trim();
    }
    return payload;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saveInFlightRef.current) return;
    setError("");
    setSuccess("");

    if (!userId) {
      setError("Debes iniciar sesión para administrar inventario.");
      return;
    }

    const validationMessage = validateForm();
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    try {
      saveInFlightRef.current = true;
      setSaving(true);
      const originalItem = editingId
        ? items.find((item) => item.id === editingId)
        : null;
      if (
        originalItem?.tipoItem === "producto" &&
        form.tipoItem !== "producto" &&
        !window.confirm(
          "Al guardar como Servicio o Actividad se eliminarán marca, modelo y datos de stock de este ítem. ¿Deseas continuar?"
        )
      ) {
        return;
      }
      let resolvedCategory = null;
      if (customCategoryActive) {
        const categoryPayload = buildNewCategoryPayload(
          form.areaId,
          customCategoryName
        );
        const result = await saveInventoryCategory(userId, categoryPayload);
        resolvedCategory = {
          id: result.categoriaId,
          nombre: categoryPayload.nombre,
        };
        setForm((current) => ({
          ...current,
          categoriaId: result.categoriaId,
          categoria: categoryPayload.nombre,
        }));
        setCustomCategoryActive(false);
        setCustomCategoryName("");
      }
      const payload = buildPayload(resolvedCategory);

      let successMessage;
      if (editingId) {
        await updateManagedInventoryItem(userId, editingId, payload, {
          preserveLegacyModel:
            originalItem?.modeloInventarioVersion !== 2 ||
            !originalItem?.codigoInterno,
          allowNegativeStock: inventorySettings.permitirStockNegativo,
        });
        successMessage = "Ítem actualizado correctamente.";
      } else {
        if (!createRequestIdRef.current) {
          createRequestIdRef.current = createInventoryRequestId();
        }
        const result = await createManagedInventoryItem(
          userId,
          payload,
          createRequestIdRef.current
        );
        successMessage = `Ítem creado con código ${result.codigoInterno}.`;
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      setUnidadPersonalizada("");
      setUnidadOtroActiva(false);
      setCustomCategoryActive(false);
      setCustomCategoryName("");
      createRequestIdRef.current = "";
      setSuccess(successMessage);
    } catch (err) {
      console.error("Error al guardar ítem:", err);
      setError(err.message || "No se pudo guardar el ítem.");
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  };

  const handleEdit = (item) => {
    const unidad = item.unidad || "";
    const manualPriceActive = hasManualPriceOverride(item);
    const compatibleCategoryId = keepCompatibleCategoryId(
      categories,
      item.areaId,
      item.categoriaId
    );

    setEditingId(item.id);
    setForm({
      ...EMPTY_FORM,
      nombre: item.nombre || "",
      tipoItem: item.tipoItem || "",
      areaId: item.areaId || "",
      categoriaId: compatibleCategoryId,
      categoria: item.categoria || "",
      descripcion: item.descripcion || "",
      unidad,
      costoBase: item.costoBase ?? item.precio ?? "",
      margenDeseado: item.margenDeseado ?? 0,
      precioInterno: manualPriceActive ? item.precioInterno ?? item.precio ?? "" : "",
      marca: item.marca || "",
      modelo: item.modelo || "",
      stock: item.stock ?? "0",
      stockMinimo: item.stockMinimo ?? "0",
      codigoBarras: item.codigoBarras || "",
      estado: item.estado || "activo",
    });
    setUnidadPersonalizada(unidad && !findStandardUnit(unidad) ? unidad : "");
    setUnidadOtroActiva(Boolean(unidad && !findStandardUnit(unidad)));
    setCustomCategoryActive(false);
    setCustomCategoryName("");
    createRequestIdRef.current = "";
    setError("");
    setSuccess("");
  };

  const handleDeactivate = async (item) => {
    setError("");
    setSuccess("");
    try {
      await deactivateInventoryItem(userId, item.id);
      setSuccess("Ítem desactivado. Puedes verlo con el filtro de inactivos.");
      if (editingId === item.id) resetForm();
    } catch (err) {
      console.error("Error al desactivar ítem:", err);
      setError("No se pudo desactivar el ítem.");
    }
  };

  const handleReactivate = async (item) => {
    setError("");
    setSuccess("");
    try {
      await reactivateInventoryItem(userId, item.id);
      setSuccess("Ítem reactivado correctamente.");
    } catch (err) {
      console.error("Error al reactivar ítem:", err);
      setError("No se pudo reactivar el ítem.");
    }
  };

  const manualPriceValue = Number(form.precioInterno);
  const hasValidManualPrice =
    String(form.precioInterno ?? "").trim() !== "" &&
    Number.isFinite(manualPriceValue) &&
    manualPriceValue > 0;
  const previewPrice = hasValidManualPrice
    ? manualPriceValue
    : calcularPrecioInterno(form.costoBase, form.margenDeseado);
  const grossProfitability = hasValidManualPrice
    ? calculateGrossProfitability(form.costoBase, manualPriceValue)
    : null;
  const grossProfitabilityStyle = grossProfitability
    ? getProfitabilityStyle(grossProfitability.gananciaBruta)
    : null;
  const unidadSelectValue = unidadOtroActiva
    ? OTHER_OPTION
    : getUnitSelectValue(form.unidad);

  return (
    <section className="erp-page" style={styles.wrapper}>
      <style>
        {`
          .inventory-basic-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .inventory-product-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .inventory-valuation-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .inventory-form-field--full {
            grid-column: 1 / -1;
          }

          .inventory-catalog-item > :first-child {
            min-width: 0;
            overflow-wrap: anywhere;
          }

          @media (max-width: 1100px) {
            .inventory-product-grid,
            .inventory-valuation-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .inventory-valuation-result {
              grid-column: 1 / -1;
            }
          }

          @media (max-width: 640px) {
            .inventory-basic-grid,
            .inventory-product-grid,
            .inventory-valuation-grid {
              grid-template-columns: minmax(0, 1fr);
            }

            .inventory-form-field--full,
            .inventory-valuation-result {
              grid-column: 1 / -1;
            }

            .inventory-form-submit {
              width: 100%;
            }

            .inventory-catalog-item {
              align-items: flex-start !important;
              flex-direction: column;
            }

            .inventory-catalog-item-actions {
              width: 100%;
            }

            .inventory-catalog-manage-button {
              width: 100%;
            }
          }
        `}
      </style>
      <div className="erp-page-header" style={styles.header}>
        <div className="erp-page-header__content">
          <span style={styles.eyebrow}>Inventario</span>
          <h2 style={styles.title}>Productos, servicios y actividades</h2>
          <p style={styles.subtitle}>
            Registra los ítems que ValoraCloud usará para valorar proyectos y
            preparar cotizaciones.
          </p>
        </div>
      </div>

      {inventorySettings.alertasStockBajo && (
        <p style={styles.stockNotice} role="status">
          {lowStockCount === 0
            ? "No hay productos con stock bajo."
            : `${lowStockCount} producto${lowStockCount === 1 ? "" : "s"} requiere${lowStockCount === 1 ? "" : "n"} atención por stock bajo.`}
        </p>
      )}

      {!userId && (
        <p role="alert" style={styles.errorText}>Debes iniciar sesión para ver inventario.</p>
      )}

      {userId && !readOnly && (
        <div className="erp-panel" style={styles.catalogToolbar}>
          <div style={styles.catalogToolbarText}>
            <strong>Catálogo de clasificación</strong>
            <span>
              {areas.length} áreas · {categories.length} categorías
            </span>
          </div>
          <button
            type="button"
            className="inventory-catalog-manage-button"
            style={styles.secondaryButton}
            onClick={() => setCatalogDialogOpen(true)}
          >
            Administrar áreas y categorías
          </button>
        </div>
      )}

      {readOnly && (
        <p style={styles.readOnlyNotice} role="status">
          Puedes buscar, filtrar y consultar el detalle. Las operaciones de
          escritura están bloqueadas en este modo.
        </p>
      )}

      <ResponsiveDialog
        open={catalogDialogOpen}
        onClose={() => setCatalogDialogOpen(false)}
        eyebrow="Inventario"
        title="Administrar áreas y categorías"
        description="Crea y mantiene el catálogo sin ocupar espacio permanente en Inventario."
        size="large"
      >
        <InventoryCatalogManager
          areas={areas}
          businessId={userId}
          categories={categories}
          loadErrors={catalogLoadErrors}
          loading={catalogIsLoading}
          onRetry={() => setCatalogRetrySignal((value) => value + 1)}
        />
      </ResponsiveDialog>

      {!readOnly && (
      <form className="erp-panel" onSubmit={handleSubmit} style={styles.formCard}>
        <div style={styles.formHeader}>
          <div>
            <h3 style={styles.formTitle}>
              {editingId ? "Editar ítem" : "Crear ítem"}
            </h3>
          </div>
          {editingId && (
            <button type="button" style={styles.secondaryButton} onClick={resetForm}>
              Cancelar edición
            </button>
          )}
        </div>

        <div style={styles.formSections}>
          <section style={styles.formSection}>
            <div style={styles.sectionHeader}>
              <h4 style={styles.sectionTitle}>Datos del ítem</h4>
            </div>

            <div className="inventory-basic-grid" style={styles.formGrid}>
              <label style={styles.field}>
                <span style={styles.label}>Tipo de ítem</span>
                <select
                  name="tipoItem"
                  value={form.tipoItem}
                  onChange={handleChange}
                  required
                  style={styles.input}
                >
                  <option value="" disabled>
                    Selecciona un tipo
                  </option>
                  <option value="producto">Producto</option>
                  <option value="servicio">Servicio</option>
                  <option value="actividad">Actividad</option>
                </select>
              </label>

              <label style={styles.field}>
                <span style={styles.label}>Área</span>
                <select
                  name="areaId"
                  value={form.areaId}
                  onChange={handleAreaChange}
                  required
                  style={styles.input}
                >
                  <option value="" disabled>
                    Selecciona un área
                  </option>
                  {activeAreas.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.nombre}
                    </option>
                  ))}
                </select>
              </label>

              <label style={styles.field}>
                <span style={styles.label}>Categoría</span>
                <select
                  name="categoriaId"
                  value={
                    customCategoryActive
                      ? OTHER_CATEGORY_OPTION
                      : form.categoriaId
                  }
                  onChange={handleCategoryChange}
                  disabled={!form.areaId}
                  required
                  style={styles.input}
                >
                  <option value="" disabled>
                    {form.areaId
                      ? "Selecciona una categoría"
                      : "Selecciona primero un área"}
                  </option>
                  {formCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.nombre}
                    </option>
                  ))}
                  <option value={OTHER_CATEGORY_OPTION}>Otra categoría…</option>
                </select>
              </label>

              {customCategoryActive && (
                <label style={styles.field}>
                  <span style={styles.label}>Nueva categoría</span>
                  <input
                    value={customCategoryName}
                    onChange={(event) => setCustomCategoryName(event.target.value)}
                    required
                    maxLength={80}
                    placeholder="Escribe el nombre real"
                    style={styles.input}
                  />
                  <span style={styles.fieldHint}>
                    Se creará dentro del Área seleccionada y quedará disponible
                    para usos posteriores.
                  </span>
                </label>
              )}

              <label className="inventory-form-field--full" style={styles.field}>
                <span style={styles.label}>Nombre</span>
                <input
                  name="nombre"
                  value={form.nombre}
                  onChange={handleChange}
                  required
                  placeholder="Escribe el nombre del producto, servicio o actividad"
                  style={styles.input}
                />
              </label>

              <label style={styles.field}>
                <span style={styles.label}>Unidad</span>
                <select
                  name="unidad"
                  value={unidadSelectValue}
                  onChange={handleUnidadChange}
                  required
                  style={styles.input}
                >
                  <option value="" disabled>
                    Selecciona una unidad
                  </option>
                  {UNIT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                  <option value={OTHER_OPTION}>Otro</option>
                </select>
              </label>

              <div style={styles.codeField} role="status" aria-live="polite">
                <span style={styles.label}>Código interno</span>
                <strong style={styles.codeValue}>
                  {editingId
                    ? items.find((item) => item.id === editingId)?.codigoInterno ||
                      items.find((item) => item.id === editingId)?.sku ||
                      "Registro heredado sin código"
                    : "Se asignará al guardar"}
                </strong>
              </div>

              {unidadSelectValue === OTHER_OPTION && (
                <label className="inventory-form-field--full" style={styles.field}>
                  <span style={styles.label}>Unidad personalizada</span>
                  <input
                    value={unidadPersonalizada}
                    onChange={handleUnidadPersonalizadaChange}
                    required
                    placeholder="Escribe una unidad personalizada"
                    style={styles.input}
                  />
                </label>
              )}

              {editingId && (
                <label style={styles.field}>
                  <span style={styles.label}>Estado</span>
                  <select
                    name="estado"
                    value={form.estado}
                    onChange={handleChange}
                    style={styles.input}
                  >
                    <option value="activo">Activo</option>
                    <option value="inactivo">Inactivo</option>
                    {form.estado === "eliminado" && (
                      <option value="eliminado">Eliminado</option>
                    )}
                  </select>
                </label>
              )}

              {editingId && (!form.areaId || !form.categoriaId) && (
                <p className="inventory-form-field--full" style={styles.legacyNotice}>
                  Este registro heredado conserva su categoría anterior. Selecciona un
                  área y una categoría activas para incorporarlo al nuevo modelo.
                </p>
              )}
            </div>
          </section>

          {form.tipoItem === "producto" && (
            <section style={styles.formSection}>
              <div style={styles.sectionHeader}>
                <h4 style={styles.sectionTitle}>Datos del producto</h4>
              </div>
              <div className="inventory-product-grid" style={styles.formGrid}>
                <label style={styles.field}>
                  <span style={styles.label}>Marca</span>
                  <input
                    name="marca"
                    value={form.marca}
                    onChange={handleChange}
                    required
                    placeholder="Ej.: Hikvision"
                    style={styles.input}
                  />
                </label>
                <label style={styles.field}>
                  <span style={styles.label}>Modelo</span>
                  <input
                    name="modelo"
                    value={form.modelo}
                    onChange={handleChange}
                    required
                    placeholder="Ej.: DS-2CD1043G2"
                    style={styles.input}
                  />
                </label>
                <label style={styles.field}>
                  <span style={styles.label}>Código de barras</span>
                  <input
                    name="codigoBarras"
                    value={form.codigoBarras}
                    onChange={handleChange}
                    placeholder="Opcional"
                    style={styles.input}
                  />
                </label>
                <label style={styles.field}>
                  <span style={styles.label}>Stock actual</span>
                  <input
                    name="stock"
                    type="number"
                    min="0"
                    step="1"
                    value={form.stock}
                    onChange={handleChange}
                    required
                    style={styles.input}
                  />
                </label>
                <label style={styles.field}>
                  <span style={styles.label}>Stock mínimo</span>
                  <input
                    name="stockMinimo"
                    type="number"
                    min="0"
                    step="1"
                    value={form.stockMinimo}
                    onChange={handleChange}
                    required
                    style={styles.input}
                  />
                </label>
              </div>
            </section>
          )}

          <section style={styles.formSection}>
            <div style={styles.sectionHeader}>
              <h4 style={styles.sectionTitle}>Precio</h4>
            </div>

            <div
              className="inventory-valuation-grid"
              style={{ ...styles.formGrid, ...styles.priceGrid }}
            >
              <label style={{ ...styles.field, ...styles.priceField }}>
                <span style={styles.label}>Costo base unitario (CLP)</span>
                <input
                  name="costoBase"
                  type="number"
                  min="0"
                  value={form.costoBase}
                  onChange={handleChange}
                  required
                  placeholder="Escribe el costo base en CLP"
                  style={styles.input}
                />
              </label>

              <label style={{ ...styles.field, ...styles.priceField }}>
                <span style={styles.label}>Margen deseado (%)</span>
                <input
                  name="margenDeseado"
                  type="number"
                  value={form.margenDeseado}
                  onChange={handleChange}
                  required
                  placeholder="Escribe el porcentaje de margen"
                  style={styles.input}
                />
              </label>

              <div
                className="inventory-valuation-result"
                style={styles.calculatedPriceBox}
              >
                <span style={styles.label}>Precio interno estimado</span>
                <strong style={styles.calculatedPrice}>
                  {previewPrice !== "" && Number.isFinite(previewPrice)
                    ? formatCLP(previewPrice)
                    : formatCLP(0)}
                </strong>
                <label style={styles.overrideField}>
                  <span style={styles.overrideLabel}>Ajuste manual opcional</span>
                  <input
                    name="precioInterno"
                    type="number"
                    min="0"
                    value={form.precioInterno}
                    onChange={handleChange}
                    placeholder="Deja vacío para calcular"
                    style={styles.input}
                  />
                </label>
                {grossProfitability && (
                  <div
                    style={{
                      ...styles.profitabilityBlock,
                      ...grossProfitabilityStyle,
                    }}
                  >
                    <span style={styles.profitabilityMain}>
                      Margen bruto estimado:{" "}
                      {formatPercent(grossProfitability.margenBrutoEstimado, 1)}
                    </span>
                    <span style={styles.profitabilitySecondary}>
                      Ganancia bruta estimada:{" "}
                      {formatSignedCLP(grossProfitability.gananciaBruta)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section style={styles.formSection}>
            <div style={styles.sectionHeader}>
              <h4 style={styles.sectionTitle}>Descripción</h4>
            </div>

            <label style={styles.field}>
              <textarea
                aria-label="Descripción del ítem"
                name="descripcion"
                value={form.descripcion}
                onChange={handleChange}
                rows={3}
                placeholder="Describe las características, alcance o condiciones del ítem"
                style={styles.textarea}
              />
            </label>
          </section>
        </div>

        {error && <p role="alert" style={styles.errorText}>{error}</p>}
        {success && <p role="status" style={styles.successText}>{success}</p>}

        <button
          type="submit"
          className="inventory-form-submit"
          style={styles.primaryButton}
          disabled={saving || !catalogReady}
        >
          {saving
            ? "Guardando..."
            : editingId
              ? "Actualizar ítem"
              : "Guardar ítem"}
        </button>
      </form>
      )}

      <div className="erp-panel" style={styles.listCard}>
        <div className="erp-filters" style={styles.filters}>
          <label className="erp-field">
            <span>Buscar ítem</span>
            <input
              className="erp-control"
              value={busqueda}
              onChange={(event) => setBusqueda(event.target.value)}
              placeholder="Código, nombre, marca, modelo, área o categoría"
              style={styles.searchInput}
            />
          </label>
          <label className="erp-field">
            <span>Tipo</span>
            <select
              className="erp-control"
              value={tipoFiltro}
              onChange={(event) => setTipoFiltro(event.target.value)}
              style={styles.filterSelect}
            >
              <option value="todos">Todos los tipos</option>
              <option value="producto">Producto</option>
              <option value="servicio">Servicio</option>
              <option value="actividad">Actividad</option>
            </select>
          </label>
          <label className="erp-field">
            <span>Área</span>
            <select
              className="erp-control"
              value={areaFiltro}
              onChange={handleAreaFilterChange}
              style={styles.filterSelect}
            >
              <option value="todas">Todas las áreas</option>
              <option value="pendientes">Área pendiente (heredados)</option>
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="erp-field">
            <span>Categoría</span>
            <select
              className="erp-control"
              value={categoriaFiltro}
              onChange={(event) => setCategoriaFiltro(event.target.value)}
              disabled={areaFiltro === "todas" || areaFiltro === "pendientes"}
              style={styles.filterSelect}
            >
              <option value="todas">
                {areaFiltro === "todas" || areaFiltro === "pendientes"
                  ? "Selecciona un área"
                  : "Todas las categorías"}
              </option>
              {filterCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="erp-field">
            <span>Estado</span>
            <select
              className="erp-control"
              value={estadoFiltro}
              onChange={(event) => setEstadoFiltro(event.target.value)}
              style={styles.filterSelect}
            >
              <option value="activos">Activos</option>
              <option value="inactivos">Inactivos</option>
              <option value="eliminados">Eliminados</option>
              <option value="todos">Todos</option>
            </select>
          </label>
        </div>

        {loading ? (
          <p style={styles.emptyText}>Cargando inventario...</p>
        ) : filteredItems.length === 0 ? (
          <div style={styles.emptyState}>
            <h3 style={styles.emptyTitle}>No hay ítems para mostrar</h3>
            <p style={styles.emptyText}>
              Crea tu primer producto, servicio o actividad para empezar a
              valorar proyectos.
            </p>
          </div>
        ) : (
          <>
          <div className="erp-table-region erp-desktop-only" style={styles.tableWrapper}>
            <table className="erp-table" style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Código</th>
                  <th style={styles.th}>Tipo</th>
                  <th style={styles.th}>Área</th>
                  <th style={styles.th}>Categoría</th>
                  <th style={styles.th}>Ítem</th>
                  <th style={styles.th}>Marca / modelo</th>
                  <th style={styles.th}>Stock</th>
                  <th style={styles.th}>Estado</th>
                  <th style={styles.th}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td style={styles.tdCode}>
                      {item.codigoInterno || item.sku || "—"}
                    </td>
                    <td style={styles.tdMuted}>{tipoLabels[item.tipoItem] || item.tipoItem}</td>
                    <td style={styles.tdMuted}>
                      {getInventoryAreaLabel(item, areas)}
                    </td>
                    <td style={styles.tdMuted}>
                      {getInventoryCategoryLabel(item, categories)}
                    </td>
                    <td style={styles.td}>
                      <strong>{item.nombre}</strong>
                      {item.descripcion && (
                        <span style={styles.itemDescription}>
                          {item.descripcion}
                        </span>
                      )}
                    </td>
                    <td style={styles.tdMuted}>
                      {item.tipoItem === "producto"
                        ? [item.marca, item.modelo].filter(Boolean).join(" / ") || "—"
                        : "No aplica"}
                    </td>
                    <td style={styles.tdMuted}>
                      {item.tipoItem === "producto" ? Number(item.stock || 0) : "No aplica"}
                    </td>
                    <td style={styles.td}>
                      <span
                        style={{
                          ...styles.statusBadge,
                          ...(item.estado === "eliminado"
                            ? styles.statusDeleted
                            : item.estado === "inactivo"
                              ? styles.statusInactive
                              : styles.statusActive),
                        }}
                      >
                        {estadoLabels[item.estado || "activo"] || "Activo"}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <InventoryItemActions
                        item={item}
                        readOnly={readOnly}
                        onView={() => setDetailItem(item)}
                        onEdit={handleEdit}
                        onDeactivate={handleDeactivate}
                        onReactivate={handleReactivate}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <InventoryCards
            items={filteredItems}
            areas={areas}
            categories={categories}
            onView={setDetailItem}
          />
          </>
        )}
      </div>

      <ResponsiveDialog
        open={Boolean(detailItem)}
        onClose={() => setDetailItem(null)}
        eyebrow="Inventario"
        title={detailItem?.nombre || "Detalle de ítem"}
        description={
          detailItem?.codigoInterno ||
          detailItem?.sku ||
          "Registro heredado sin código interno"
        }
        footer={detailItem ? (
          <InventoryItemActions
            item={detailItem}
            hideView
            readOnly={readOnly}
            onEdit={(item) => {
              setDetailItem(null);
              handleEdit(item);
            }}
            onDeactivate={(item) => {
              setDetailItem(null);
              handleDeactivate(item);
            }}
            onReactivate={(item) => {
              setDetailItem(null);
              handleReactivate(item);
            }}
          />
        ) : null}
      >
        {detailItem && (
          <>
            <div style={styles.detailGrid}>
              <div style={styles.detailField}>
                <span style={styles.detailLabel}>Tipo</span>
                <strong style={styles.detailValue}>
                  {tipoLabels[detailItem.tipoItem] || detailItem.tipoItem || "-"}
                </strong>
              </div>
              <div style={styles.detailField}>
                <span style={styles.detailLabel}>Área</span>
                <strong style={styles.detailValue}>
                  {getInventoryAreaLabel(detailItem, areas)}
                </strong>
              </div>
              <div style={styles.detailField}>
                <span style={styles.detailLabel}>Categoría</span>
                <strong style={styles.detailValue}>
                  {getInventoryCategoryLabel(detailItem, categories)}
                </strong>
              </div>
              <div style={styles.detailField}>
                <span style={styles.detailLabel}>Unidad</span>
                <strong style={styles.detailValue}>{detailItem.unidad || "-"}</strong>
              </div>
              <div style={styles.detailField}>
                <span style={styles.detailLabel}>Costo base</span>
                <strong style={styles.detailValue}>
                  {formatCLP(detailItem.costoBase)}
                </strong>
              </div>
              <div style={styles.detailField}>
                <span style={styles.detailLabel}>Margen deseado</span>
                <strong style={styles.detailValue}>
                  {Number(detailItem.margenDeseado || 0)}%
                </strong>
              </div>
              <div style={styles.detailField}>
                <span style={styles.detailLabel}>Precio interno</span>
                <strong style={styles.detailPrice}>
                  {formatCLP(detailItem.precioInterno)}
                </strong>
              </div>
              <div style={styles.detailField}>
                <span style={styles.detailLabel}>Estado</span>
                <span
                  style={{
                    ...styles.statusBadge,
                    ...(detailItem.estado === "eliminado"
                      ? styles.statusDeleted
                      : detailItem.estado === "inactivo"
                        ? styles.statusInactive
                        : styles.statusActive),
                  }}
                >
                  {estadoLabels[detailItem.estado || "activo"] || "Activo"}
                </span>
              </div>
              <div style={styles.detailField}>
                <span style={styles.detailLabel}>Código interno</span>
                <strong style={styles.detailCode}>
                  {detailItem.codigoInterno || detailItem.sku || "—"}
                </strong>
              </div>
              {detailItem.tipoItem === "producto" && (
                <>
                  <div style={styles.detailField}>
                    <span style={styles.detailLabel}>Marca / modelo</span>
                    <strong style={styles.detailValue}>
                      {[detailItem.marca, detailItem.modelo]
                        .filter(Boolean)
                        .join(" / ") || "—"}
                    </strong>
                  </div>
                  <div style={styles.detailField}>
                    <span style={styles.detailLabel}>Stock actual / mínimo</span>
                    <strong style={styles.detailValue}>
                      {Number(detailItem.stock || 0)} / {Number(detailItem.stockMinimo || 0)}
                    </strong>
                  </div>
                  <div style={styles.detailField}>
                    <span style={styles.detailLabel}>Código de barras</span>
                    <strong style={styles.detailCode}>
                      {detailItem.codigoBarras || "—"}
                    </strong>
                  </div>
                </>
              )}
              <div style={styles.detailField}>
                <span style={styles.detailLabel}>Creado</span>
                <strong style={styles.detailValue}>
                  {formatFirestoreDate(detailItem.creadoEn)}
                </strong>
              </div>
              <div style={styles.detailField}>
                <span style={styles.detailLabel}>Actualizado</span>
                <strong style={styles.detailValue}>
                  {formatFirestoreDate(detailItem.actualizadoEn)}
                </strong>
              </div>
            </div>

            <div style={styles.descriptionBlock}>
              <span style={styles.detailLabel}>Descripcion</span>
              <p style={styles.descriptionText}>
                {detailItem.descripcion || "Sin descripcion registrada."}
              </p>
            </div>
          </>
        )}
      </ResponsiveDialog>
    </section>
  );
}

function InventoryCards({ items, areas, categories, onView }) {
  return (
    <div className="erp-card-list erp-mobile-only" aria-label="Ítems de inventario">
      {items.map((item) => (
        <article className="erp-record-card" key={item.id}>
          <div className="inventory-card-header" style={styles.inventoryCardHeader}>
            <div style={styles.imagePlaceholder} aria-label="Sin imagen disponible">
              <AppIcon icon={PackageOpen} size={22} />
              <span>Sin imagen</span>
            </div>
            <div style={styles.inventoryCardHeading}>
              <h3 className="erp-record-card__title">{item.nombre || "Ítem sin nombre"}</h3>
              <p className="erp-record-card__subtitle">
                {item.codigoInterno || item.sku || "Registro heredado sin código"}
              </p>
            </div>
            <InventoryStatusBadge item={item} />
          </div>
          <dl className="erp-meta-grid">
            <div className="erp-meta">
              <dt className="erp-meta__label">Tipo</dt>
              <dd className="erp-meta__value">{tipoLabels[item.tipoItem] || item.tipoItem || "-"}</dd>
            </div>
            <div className="erp-meta">
              <dt className="erp-meta__label">Área</dt>
              <dd className="erp-meta__value">
                {getInventoryAreaLabel(item, areas)}
              </dd>
            </div>
            <div className="erp-meta">
              <dt className="erp-meta__label">Categoría</dt>
              <dd className="erp-meta__value">
                {getInventoryCategoryLabel(item, categories)}
              </dd>
            </div>
            {item.tipoItem === "producto" && (
              <>
                <div className="erp-meta">
                  <dt className="erp-meta__label">Marca / modelo</dt>
                  <dd className="erp-meta__value">
                    {[item.marca, item.modelo].filter(Boolean).join(" / ") || "—"}
                  </dd>
                </div>
                <div className="erp-meta">
                  <dt className="erp-meta__label">Stock</dt>
                  <dd className="erp-meta__value">{Number(item.stock || 0)}</dd>
                </div>
              </>
            )}
          </dl>
          <button
            type="button"
            aria-haspopup="dialog"
            style={styles.mobilePrimaryButton}
            onClick={() => onView(item)}
          >
            Ver detalle
          </button>
        </article>
      ))}
    </div>
  );
}

function InventoryStatusBadge({ item }) {
  return (
    <span
      style={{
        ...styles.statusBadge,
        ...(item.estado === "eliminado"
          ? styles.statusDeleted
          : item.estado === "inactivo"
            ? styles.statusInactive
            : styles.statusActive),
      }}
    >
      {estadoLabels[item.estado || "activo"] || "Activo"}
    </span>
  );
}

function InventoryItemActions({
  item,
  hideView = false,
  readOnly = false,
  onView,
  onEdit,
  onDeactivate,
  onReactivate,
}) {
  const estado = item.estado || "activo";

  return (
    <div className="erp-actions" style={styles.actions}>
      {!hideView && (
        <button type="button" aria-haspopup="dialog" style={styles.smallButton} onClick={onView}>
          Ver detalle
        </button>
      )}
      {!readOnly && estado !== "eliminado" && (
          <button type="button" style={styles.smallButton} onClick={() => onEdit(item)}>
            Editar
          </button>
      )}
      {!readOnly && (estado === "activo" ? (
        <button type="button" style={styles.warningButton} onClick={() => onDeactivate(item)}>
          Desactivar
        </button>
      ) : (
        <button type="button" style={styles.successButton} onClick={() => onReactivate(item)}>
          Reactivar
        </button>
      ))}
    </div>
  );
}

const styles = {
  wrapper: {
    display: "grid",
    gap: "18px",
    minWidth: 0,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
  },
  eyebrow: {
    color: "#0f766e",
    fontSize: "13px",
    fontWeight: 800,
    textTransform: "uppercase",
  },
  title: {
    margin: "4px 0 6px",
    fontSize: "24px",
  },
  subtitle: {
    margin: 0,
    color: "#64748b",
    lineHeight: 1.5,
  },
  catalogToolbar: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    justifyContent: "space-between",
    padding: "12px 14px",
  },
  catalogToolbarText: {
    color: "#334155",
    display: "grid",
    fontSize: "13px",
    gap: "2px",
  },
  readOnlyNotice: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: "4px",
    color: "#78350f",
    fontSize: "13px",
    lineHeight: 1.45,
    margin: 0,
    padding: "10px 12px",
  },
  stockNotice: {
    background: "#f0fdfa",
    border: "1px solid #99f6e4",
    borderRadius: "4px",
    color: "#115e59",
    fontSize: "13px",
    lineHeight: 1.45,
    margin: 0,
    padding: "10px 12px",
  },
  formCard: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "4px",
    minWidth: 0,
    padding: "20px",
  },
  formHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    marginBottom: "16px",
  },
  formTitle: {
    margin: 0,
    fontSize: "18px",
  },
  formSections: {
    display: "grid",
    gap: "22px",
  },
  formSection: {
    display: "grid",
    gap: "12px",
    minWidth: 0,
  },
  sectionHeader: {
    display: "grid",
    gap: "4px",
  },
  sectionTitle: {
    color: "#0f172a",
    fontSize: "14px",
    fontWeight: 800,
    margin: 0,
  },
  formGrid: {
    display: "grid",
    gap: "14px",
  },
  priceGrid: {
    alignItems: "start",
  },
  field: {
    display: "grid",
    gap: "6px",
    minWidth: 0,
  },
  priceField: {
    alignSelf: "start",
  },
  fieldFull: {
    display: "grid",
    gap: "6px",
    gridColumn: "1 / -1",
    minWidth: 0,
  },
  label: {
    color: "#334155",
    fontSize: "13px",
    fontWeight: 700,
  },
  labelRow: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
  },
  fieldMeta: {
    color: "#64748b",
    fontSize: "13px",
    fontWeight: 600,
  },
  fieldHint: {
    color: "#64748b",
    fontSize: "12px",
    lineHeight: 1.4,
  },
  codeField: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "4px",
    display: "grid",
    gap: "6px",
    minHeight: "40px",
    padding: "9px 11px",
  },
  codeValue: {
    color: "#0f172a",
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: "13px",
    overflowWrap: "anywhere",
  },
  legacyNotice: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: "4px",
    color: "#78350f",
    fontSize: "13px",
    lineHeight: 1.45,
    margin: 0,
    padding: "9px 11px",
  },
  input: {
    boxSizing: "border-box",
    maxWidth: "100%",
    width: "100%",
    border: "1px solid #cbd5e1",
    borderRadius: "4px",
    fontSize: "13px",
    minHeight: "40px",
    padding: "10px 11px",
    color: "#111827",
    background: "#ffffff",
  },
  textarea: {
    boxSizing: "border-box",
    maxWidth: "100%",
    width: "100%",
    border: "1px solid #cbd5e1",
    borderRadius: "4px",
    fontSize: "13px",
    padding: "10px 11px",
    color: "#111827",
    background: "#ffffff",
    resize: "vertical",
  },
  calculatedPriceBox: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "4px",
    boxSizing: "border-box",
    display: "grid",
    gap: "4px",
    maxWidth: "100%",
    minWidth: 0,
    padding: "9px 10px",
    width: "100%",
  },
  calculatedPrice: {
    color: "#0f172a",
    fontSize: "18px",
    lineHeight: 1.2,
  },
  overrideField: {
    display: "grid",
    gap: "4px",
    marginTop: "4px",
  },
  overrideLabel: {
    color: "#64748b",
    fontSize: "13px",
    fontWeight: 800,
    textTransform: "uppercase",
  },
  profitabilityBlock: {
    borderRadius: "4px",
    display: "grid",
    gap: "2px",
    marginTop: "2px",
    padding: "5px 6px",
  },
  profitabilityMain: {
    fontSize: "13px",
    fontWeight: 800,
    lineHeight: 1.3,
  },
  profitabilitySecondary: {
    fontSize: "13px",
    fontWeight: 700,
    lineHeight: 1.25,
    opacity: 0.86,
  },
  profitabilityPositive: {
    background: "#ecfdf5",
    border: "1px solid #bbf7d0",
    color: "#047857",
  },
  profitabilityNegative: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
  },
  profitabilityNeutral: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    color: "#475569",
  },
  helpText: {
    color: "#475569",
    fontSize: "14px",
    margin: "14px 0 0",
  },
  errorText: {
    color: "#b91c1c",
    fontSize: "14px",
    margin: "12px 0 0",
  },
  successText: {
    color: "#047857",
    fontSize: "14px",
    margin: "12px 0 0",
  },
  primaryButton: {
    marginTop: "16px",
    border: 0,
    borderRadius: "4px",
    background: "#0f766e",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 800,
    minHeight: "40px",
    padding: "11px 16px",
  },
  secondaryButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "4px",
    background: "#ffffff",
    color: "#334155",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 700,
    minHeight: "40px",
    padding: "9px 12px",
  },
  listCard: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "4px",
    minWidth: 0,
    padding: "14px",
  },
  filters: {
    display: "grid",
    gap: "10px",
    marginBottom: "12px",
  },
  searchInput: {
    border: "1px solid #cbd5e1",
    borderRadius: "4px",
    fontSize: "13px",
    minWidth: 0,
    padding: "8px 10px",
  },
  filterSelect: {
    border: "1px solid #cbd5e1",
    borderRadius: "4px",
    color: "#334155",
    fontSize: "13px",
    padding: "8px 10px",
    background: "#ffffff",
  },
  tableWrapper: {
    overflowX: "auto",
    border: "1px solid #e5e7eb",
    borderRadius: "4px",
    minWidth: 0,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "13px",
    minWidth: "1160px",
  },
  th: {
    background: "#f9fafb",
    borderBottom: "1px solid #e5e7eb",
    color: "#667085",
    fontSize: "13px",
    fontWeight: 800,
    padding: "7px 10px",
    textAlign: "left",
    textTransform: "uppercase",
  },
  td: {
    borderBottom: "1px solid #eef2f7",
    color: "#111827",
    fontSize: "13px",
    padding: "7px 10px",
    verticalAlign: "middle",
  },
  tdMuted: {
    borderBottom: "1px solid #eef2f7",
    color: "#64748b",
    fontSize: "13px",
    padding: "7px 10px",
    verticalAlign: "middle",
  },
  tdPrice: {
    borderBottom: "1px solid #eef2f7",
    color: "#0f172a",
    fontSize: "13px",
    fontWeight: 800,
    padding: "7px 10px",
    verticalAlign: "middle",
  },
  tdCode: {
    borderBottom: "1px solid #eef2f7",
    color: "#0f172a",
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: "13px",
    fontWeight: 700,
    padding: "7px 10px",
    verticalAlign: "middle",
    whiteSpace: "nowrap",
  },
  itemMeta: {
    color: "#475569",
    display: "block",
    fontSize: "13px",
    fontWeight: 600,
    marginTop: "2px",
  },
  itemDescription: {
    color: "#64748b",
    display: "block",
    fontSize: "13px",
    marginTop: "3px",
    maxWidth: "320px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  statusBadge: {
    borderRadius: "999px",
    display: "inline-block",
    fontSize: "13px",
    fontWeight: 700,
    lineHeight: 1,
    padding: "4px 7px",
  },
  statusActive: {
    background: "#f0fdf4",
    border: "1px solid #dcfce7",
    color: "#166534",
  },
  statusInactive: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    color: "#92400e",
  },
  statusDeleted: {
    background: "#fef2f2",
    border: "1px solid #fee2e2",
    color: "#991b1b",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "5px",
  },
  smallButton: {
    border: "1px solid #d0d5dd",
    borderRadius: "4px",
    background: "#ffffff",
    color: "#344054",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 600,
    minHeight: "36px",
    padding: "6px 8px",
  },
  warningButton: {
    border: "1px solid #fde68a",
    borderRadius: "4px",
    background: "#fffdf5",
    color: "#92400e",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 600,
    minHeight: "36px",
    padding: "6px 8px",
  },
  successButton: {
    border: "1px solid #99f6e4",
    borderRadius: "4px",
    background: "#f7fffd",
    color: "#0f766e",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 600,
    minHeight: "36px",
    padding: "6px 8px",
  },
  emptyState: {
    border: "1px dashed #cbd5e1",
    borderRadius: "4px",
    padding: "28px",
    textAlign: "center",
  },
  emptyTitle: {
    margin: "0 0 6px",
  },
  emptyText: {
    color: "#64748b",
    margin: 0,
  },
  inventoryCardHeader: {
    alignItems: "flex-start",
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "58px minmax(0, 1fr) auto",
    minWidth: 0,
  },
  inventoryCardHeading: {
    minWidth: 0,
  },
  imagePlaceholder: {
    alignItems: "center",
    aspectRatio: "1",
    background: "#f1f5f9",
    border: "1px solid #e2e8f0",
    borderRadius: "4px",
    color: "#64748b",
    display: "flex",
    flexDirection: "column",
    fontSize: "13px",
    gap: "2px",
    justifyContent: "center",
    lineHeight: 1,
    textAlign: "center",
  },
  mobilePrimaryButton: {
    background: "#0f766e",
    border: 0,
    borderRadius: "4px",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 800,
    minHeight: "40px",
    padding: "9px 12px",
    width: "100%",
  },
  detailGrid: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  },
  detailField: {
    background: "#f8fafc",
    border: "1px solid #eef2f7",
    borderRadius: "4px",
    padding: "10px",
  },
  detailLabel: {
    color: "#64748b",
    display: "block",
    fontSize: "13px",
    fontWeight: 800,
    marginBottom: "4px",
    textTransform: "uppercase",
  },
  detailValue: {
    color: "#111827",
    display: "block",
    fontSize: "13px",
    fontWeight: 700,
  },
  detailCode: {
    color: "#111827",
    display: "block",
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: "13px",
    fontWeight: 700,
    overflowWrap: "anywhere",
  },
  detailPrice: {
    color: "#0f172a",
    display: "block",
    fontSize: "14px",
    fontWeight: 800,
  },
  descriptionBlock: {
    borderTop: "1px solid #eef2f7",
    marginTop: "16px",
    paddingTop: "14px",
  },
  descriptionText: {
    color: "#334155",
    fontSize: "14px",
    lineHeight: 1.55,
    margin: 0,
    whiteSpace: "pre-wrap",
  },
};

export default InventoryManager;

