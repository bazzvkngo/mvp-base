import React, {useEffect, useMemo, useRef, useState} from "react";
import {useLocation, useNavigate, useParams} from "react-router-dom";
import {FileUp, Printer} from "lucide-react";
import {addInventoryItemToLines, catalogEntryFromInventoryItem, sumQuantitiesByItem} from "../domain/inventoryLineAdd.mjs";
import {adaptDocumentAmountDecimals, resolveDocumentTaxRate} from "../domain/localization.mjs";
import {useBusinessMoney} from "../hooks/useBusinessFormat";
import {sileo} from "sileo";
import Button from "../components/ui/Button";
import InventoryCatalogDialog from "../components/ui/InventoryCatalogDialog";
import LoadingState from "../components/ui/LoadingState";
import Notice from "../components/ui/Notice";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import SupplyTrace from "../components/ui/SupplyTrace";
import {
  calculatePurchaseTotals,
  canManagePurchases,
  getPurchaseDocumentTypeLabel,
  getPurchaseStockSemantics,
  getPurchaseStatusLabel,
  shouldReconcilePurchaseConfirmation,
} from "../domain/purchaseModel.mjs";
import PurchaseDetailView from "../features/purchases/PurchaseDetailView";
import PurchaseDocumentImportDialog from "../features/purchases/PurchaseDocumentImportDialog";
import PurchaseItemsEditor from "../features/purchases/PurchaseItemsEditor";
import PurchaseProviderSelector from "../features/purchases/PurchaseProviderSelector";
import PurchasePrintView from "../features/purchases/PurchasePrintView";
import PurchaseSummaryPanel from "../features/purchases/PurchaseSummaryPanel";
import {getCompanyProfile} from "../services/companyService";
import {findActiveProductByBarcode, getInventoryItems} from "../services/inventoryService";
import {listarProveedores} from "../services/providerService";
import {
  actualizarCompraBorrador,
  cancelarCompraBorrador,
  confirmarCompra,
  crearCompra,
  createPurchaseRequestId,
  obtenerCompra,
} from "../services/purchaseService";
import {getCountryFormCopy} from "../domain/countryFormCopy.mjs";
import {getFiscalIdentifierLabel} from "../domain/fiscalIdentifier.mjs";
import {formatDate, formatMoney} from "../utils/formatters";
import "../features/purchases/purchases.css";
import {userErrorMessage} from "../domain/userFacingError.mjs";

const EMPTY_TOTALS = {subtotal: 0, descuentoTotal: 0, neto: 0, montoExento: 0, iva: 0, total: 0};
const today = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Santiago",
}).format(new Date());
const emptyDraft = () => ({
  proveedorId: "",
  fechaCompra: today(),
  fechaDocumento: "",
  tipoDocumento: "sin_documento",
  numeroDocumentoProveedor: "",
  condicionesPago: "",
  observaciones: "",
  items: [],
  documentoOrigen: null,
});
const lineId = () => `linea-${globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const hasText = (value) => Boolean(String(value ?? "").trim());
const PROVIDER_AT_PURCHASE_NOTE = "Datos del proveedor al momento de la compra";
const visibleObservation = (value, purchase) => {
  const observation = String(value || "").trim();
  const generated = purchase?.recepcionNumero ? `Originada desde ${purchase.recepcionNumero}` : "";
  const normalized = observation.toLocaleLowerCase("es-CL");
  if (generated && normalized === generated.toLocaleLowerCase("es-CL")) return "";
  return /^originada desde recepci[oó]n$/.test(normalized) ? "" : observation;
};

function PurchaseProviderSnapshot({countryCode, provider = {}}) {
  const fiscalId = provider.identificadorFiscalValor || provider.rut;
  const details = [
    [provider.identificadorFiscalTipo || getFiscalIdentifierLabel(countryCode || "CL"), fiscalId],
    [getCountryFormCopy(countryCode).businessActivityLabel, provider.giro],
    ["Contacto", provider.personaContacto],
    ["Correo", provider.email],
    ["Teléfono", provider.telefono],
    ["Dirección", provider.direccion],
    ["Condiciones", provider.condicionesPago],
  ].filter(([, value]) => hasText(value));
  return <section className="po-panel purchase-provider-card"><header><span className="po-kicker">Proveedor</span><h2>{provider.razonSocial || "Proveedor histórico"}</h2><small>{PROVIDER_AT_PURCHASE_NOTE}</small></header>{details.length > 0 && <dl>{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}</section>;
}

function PurchaseDocumentInfo({draft, purchase, money}) {
  if (draft.tipoDocumento === "sin_documento") {
    return <p className="purchase-empty-copy">No hay un documento asociado a esta compra.</p>;
  }
  const source = purchase?.documentoOrigen || {};
  const values = [
    ["Documento", `${getPurchaseDocumentTypeLabel(draft.tipoDocumento)}${draft.numeroDocumentoProveedor ? ` N° ${draft.numeroDocumentoProveedor}` : ""}`],
    ["Fecha", draft.fechaDocumento ? formatDate(draft.fechaDocumento, purchase?.locale) : ""],
    ["Vencimiento", source.fechaVencimiento ? formatDate(source.fechaVencimiento, purchase?.locale) : ""],
    ["Neto", money(source.neto ?? purchase?.neto)],
    [purchase?.impuestoNombre || "IVA", money(source.impuestoMonto ?? purchase?.iva)],
    ["Total", money(source.total ?? purchase?.total)],
  ].filter(([, value]) => hasText(value));
  return <dl className="purchase-document-summary">{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

export default function NewPurchasePage({businessId, role}) {
  const {compraId} = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(emptyDraft);
  const [purchase, setPurchase] = useState(null);
  // Decimales de cálculo (SPEC 036): una compra guardada usa el `montoDecimales` de su documento (ausente = 0); un
  // borrador que todavía no existe usa los de la moneda del negocio. Con 0 todo se calcula entero, como siempre.
  const businessMoney = useBusinessMoney();
  const documentDecimals = purchase
    ? adaptDocumentAmountDecimals(purchase, purchase.moneda)
    : businessMoney.amountDecimals;
  // Paso de los importes: "any" con 0 decimales (como siempre) y "0.01" con 2. La cantidad no cambia.
  const moneyStep = documentDecimals > 0 ? String(10 ** -documentDecimals) : "any";
  const [providers, setProviders] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [company, setCompany] = useState(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(Boolean(location.state?.openPurchaseImport));
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [actionDialog, setActionDialog] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");
  // Rechazo de la confirmación ({title, message}): se muestra dentro del diálogo "Confirmar compra", que no se cierra solo.
  const [confirmError, setConfirmError] = useState(null);
  const backButtonRef = useRef(null);
  // Rechazo de la cancelación ({title, message}): también dentro de su diálogo, que no se cierra solo.
  const [cancelError, setCancelError] = useState(null);
  const cancelBackRef = useRef(null);
  const createId = useRef(createPurchaseRequestId("purchase-create"));
  const confirmId = useRef(createPurchaseRequestId("purchase-confirm"));
  const pendingConfirmationPurchaseId = useRef("");
  const canManage = canManagePurchases(role);
  const readOnly = !canManage || Boolean(purchase && purchase.estado !== "borrador");
  const referencesLocked = Boolean(purchase?.ordenCompraId || purchase?.recepcionId);
  const stockSemantics = getPurchaseStockSemantics(purchase || {
    modeloCompraVersion: 3,
    stockGestionadoPor: "compra_directa",
  });

  useEffect(() => {
    if (location.state?.message) {
      sileo.success({title: location.state.message, description: location.state?.description});
      navigate(location.pathname, {replace: true, state: {}});
    }
  }, [location.pathname, location.state?.description, location.state?.message, navigate]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      listarProveedores(businessId),
      getInventoryItems(businessId),
      getCompanyProfile(businessId),
      compraId ? obtenerCompra(businessId, compraId) : null,
    ]).then(([providerList, items, profile, stored]) => {
      if (!active) return;
      setProviders(providerList);
      setInventory(items);
      setCompany(profile);
      setPurchase(stored);
      if (compraId && !stored) {
        setMessage("La compra no existe.");
      } else if (stored) {
        setDraft({
          proveedorId: stored.proveedorId,
          fechaCompra: stored.fechaCompra,
          fechaDocumento: stored.fechaDocumento,
          tipoDocumento: stored.tipoDocumento,
          numeroDocumentoProveedor: stored.numeroDocumentoProveedor,
          condicionesPago: stored.condicionesPago,
          observaciones: stored.observaciones,
          items: stored.items,
          documentoOrigen: stored.documentoOrigen,
        });
      }
    }).catch((error) => {
      if (active) setMessage(userErrorMessage(error));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [businessId, compraId]);

  const totals = useMemo(() => {
    // Un documento que ya no se edita muestra sus totales guardados.
    if (readOnly && purchase) {
      return {subtotal: purchase.subtotal, descuentoTotal: purchase.descuentoTotal, neto: purchase.neto, montoExento: purchase.montoExento || 0, iva: purchase.iva, total: purchase.total};
    }
    try {
      // SPEC 023 §5.2: un borrador se guarda con boleta y exentos, y Functions
      // copia la marca vigente de cada producto; la vista previa hace lo mismo.
      const taxIdByItem = new Map(inventory.map((item) => [item.id, item.impuestoId]));
      return draft.items.length ? calculatePurchaseTotals(
        draft.items.map((line) => ({...line, impuestoId: taxIdByItem.get(line.itemId) ?? line.impuestoId})),
        {
          tasaIva: resolveDocumentTaxRate(purchase, company),
          tipoDocumento: draft.tipoDocumento,
          montoDecimales: documentDecimals,
        }
      ) : EMPTY_TOTALS;
    } catch {
      return EMPTY_TOTALS;
    }
  }, [company?.impuestoPredeterminadoTasa, company?.paisCodigo, draft.items, draft.tipoDocumento, inventory, purchase, readOnly]);

  const printable = useMemo(() => ({
    ...(purchase || {}),
    ...draft,
    numero: purchase?.numero || "Compra por asignar",
    paisCodigo: purchase?.paisCodigo || company?.paisCodigo || "CL",
    moneda: purchase?.moneda || company?.monedaCodigo || "CLP",
    locale: purchase?.locale || company?.locale || "es-CL",
    impuestoNombre: purchase?.impuestoNombre || company?.impuestoPredeterminadoNombre || "IVA",
    tasaIva: resolveDocumentTaxRate(purchase, company),
    proveedorSnapshot: purchase?.proveedorId === draft.proveedorId
      ? purchase.proveedorSnapshot
      : providers.find((provider) => provider.proveedorId === draft.proveedorId) || {},
    ...totals,
  }), [company, draft, providers, purchase, totals]);
  const money = (value) => formatMoney(value, printable.moneda, printable.locale);
  const catalogEntries = useMemo(() => inventory.map((item) => catalogEntryFromInventoryItem(item, "costoBase")), [inventory]);
  const catalogAddedQuantities = useMemo(() => sumQuantitiesByItem(draft.items), [draft.items]);

  // Compra no consume stock: sin tope. Suma a una línea limpia (mismo ítem, sin descuento, mismo costo actual) o crea otra.
  const addItem = (item, quantity = 1) => setDraft((current) => ({
    ...current,
    items: addInventoryItemToLines(current.items, item, {
      itemId: item.id,
      quantity,
      priceKey: "costoUnitario",
      createLine: () => ({
        lineaId: lineId(),
        itemId: item.id,
        codigo: item.codigoInterno || item.sku || "",
        nombre: item.nombre,
        descripcion: item.descripcion || "",
        tipoItem: item.tipoItem || "producto",
        unidad: item.unidad || "unidad",
        cantidad: 1,
        costoUnitario: Number(item.costoBase || 0),
        descuentoPct: 0,
      }),
    }).items,
  }));

  // "Escanear producto": el mismo escáner continuo de Venta y Orden de compra; agrega como el diálogo de inventario (cantidad 1).
  const addScannedProduct = async (barcode) => {
    const product = await findActiveProductByBarcode(businessId, barcode);
    if (!product) throw new Error("Producto no encontrado para este código.");
    addItem(product);
    return {key: product.id, label: product.nombre};
  };

  const applyDocumentImport = (imported) => {
    setDraft((current) => ({
      ...current,
      ...imported,
      fechaCompra: imported.fechaCompra || current.fechaCompra,
      observaciones: current.observaciones,
    }));
    setMessage("");
    sileo.success({
      title: "Factura aplicada al borrador",
      description: "Revisa proveedor, líneas y totales. La compra todavía no está confirmada.",
    });
  };

  // El borrador viaja con los decimales con que se calculó, solo para validarlo en el cliente: el servidor decide los
  // suyos con el snapshot del documento y no lee este valor.
  const persist = async () => purchase
    ? (await actualizarCompraBorrador(businessId, purchase.id, {...draft, montoDecimales: documentDecimals})).compra
    : (await crearCompra(businessId, {...draft, montoDecimales: documentDecimals}, {requestId: createId.current})).compra;

  const save = async () => {
    setProcessing(true);
    setMessage("");
    try {
      const stored = await persist();
      setPurchase(stored);
      pendingConfirmationPurchaseId.current = "";
      createId.current = createPurchaseRequestId("purchase-create");
      if (!compraId) {
        navigate(`/compras/${stored.id}/editar`, {
          replace: true,
          state: {message: "Compra preparada", description: `${stored.numero} quedó preparada para confirmar.`},
        });
      } else {
        sileo.success({title: "Compra actualizada", description: `${stored.numero} continúa preparada para confirmar.`});
      }
    } catch (error) {
      sileo.error({title: "No se pudo guardar la compra", description: userErrorMessage(error)});
    } finally {
      setProcessing(false);
    }
  };

  const closeConfirmDialog = () => { setActionDialog(""); setConfirmError(null); };
  // Un fallo reintentable (corte de red) deja "Confirmar compra" habilitado y con el foco; uno definitivo lo deshabilita y el foco pasa a Volver.
  const confirmBlocked = Boolean(confirmError) && !confirmError.retryable;
  useEffect(() => { if (confirmBlocked) backButtonRef.current?.focus(); }, [confirmBlocked]);
  const closeCancelDialog = () => { setActionDialog(""); setCancelError(null); };
  useEffect(() => { if (cancelError) cancelBackRef.current?.focus(); }, [cancelError]);

  const confirm = async () => {
    setConfirmError(null);
    setProcessing(true);
    setMessage("");
    let stored = purchase;
    try {
      if (!stored || pendingConfirmationPurchaseId.current !== stored.id) {
        stored = await persist();
        setPurchase(stored);
      }
    } catch (error) {
      setConfirmError({title: "No se pudo preparar la compra", message: userErrorMessage(error), retryable: shouldReconcilePurchaseConfirmation(error)});
      setProcessing(false);
      return;
    }
    pendingConfirmationPurchaseId.current = stored.id;
    const finishConfirmation = (confirmed, productsUpdated) => {
      pendingConfirmationPurchaseId.current = "";
      confirmId.current = createPurchaseRequestId("purchase-confirm");
      setPurchase(confirmed);
      setActionDialog("");
      navigate(`/compras/${confirmed.id}`, {
        replace: true,
        state: {
          message: "Compra confirmada",
          description: getPurchaseStockSemantics({
            ...confirmed,
            productosActualizados: productsUpdated,
          }).confirmationResultMessage,
        },
      });
    };
    try {
      const result = await confirmarCompra(businessId, stored.id, {
        requestId: confirmId.current,
      });
      finishConfirmation(result.compra, result.productosActualizados);
    } catch (error) {
      if (!shouldReconcilePurchaseConfirmation(error)) {
        pendingConfirmationPurchaseId.current = "";
        setConfirmError({title: "No se pudo confirmar la compra", message: userErrorMessage(error), retryable: false});
      } else {
        try {
          const authoritative = await obtenerCompra(businessId, stored.id);
          if (authoritative?.estado === "confirmada" || authoritative?.stockAplicado === true) {
            finishConfirmation(authoritative);
          } else {
            if (authoritative) setPurchase(authoritative);
            setConfirmError({title: "No se pudo confirmar la compra", message: userErrorMessage(error) + " La compra continúa preparada. Puedes reintentar con seguridad.", retryable: true});
          }
        } catch {
          setConfirmError({title: "No se pudo verificar la confirmación", message: userErrorMessage(error) + " Recarga la compra antes de volver a intentarlo.", retryable: false});
        }
      }
    } finally {
      setProcessing(false);
    }
  };

  const cancel = async () => {
    if (!purchase) return;
    setCancelError(null);
    setProcessing(true);
    try {
      const result = await cancelarCompraBorrador(businessId, purchase.id);
      setPurchase(result.compra);
      setActionDialog("");
      setMessage("Compra cancelada.");
      navigate(`/compras/${purchase.id}`, {
        replace: true,
        state: {message: "Compra cancelada", description: `${purchase.numero} quedó cancelada sin modificar stock.`},
      });
    } catch (error) {
      setCancelError({title: "No se pudo cancelar la compra", message: userErrorMessage(error)});
    } finally {
      setProcessing(false);
    }
  };

  const changeDocumentType = (tipoDocumento) => setDraft((current) => ({
    ...current,
    tipoDocumento,
    ...(tipoDocumento === "sin_documento" ? {numeroDocumentoProveedor: "", fechaDocumento: ""} : {}),
  }));

  if (loading) return <LoadingState variant="page" label="Cargando compra..." />;
  if (purchase && purchase.estado !== "borrador") return <PurchaseDetailView company={company} message={message} printable={printable} purchase={purchase} />;

  const observation = visibleObservation(draft.observaciones, purchase);
  const origin = purchase?.recepcionNumero
    ? `Recepción ${purchase.recepcionNumero}`
    : purchase?.ordenCompraNumero ? `Orden de compra ${purchase.ordenCompraNumero}` : "Compra directa";
  const canImport = !readOnly && !referencesLocked;

  return (
    <main className="po-workspace purchase-workspace">
      {/* Un solo h1 por pantalla: el de la barra superior (navigation.js). Por eso el título va en un <p>. */}
      <header className="ui-doc-head no-print">
        <div className="ui-doc-head__main">
          <button type="button" className="ui-doc-back" onClick={() => navigate("/compras")}>← Compras</button>
          <p className="ui-doc-head__title">{purchase ? `Compra ${purchase.numero}` : "Nueva compra"}</p>
          <span className={`po-status po-status--${purchase?.estado || "borrador"}`}>
            {getPurchaseStatusLabel(purchase?.estado || "borrador")}
          </span>
        </div>
        <div className="ui-doc-head__side">
          <div className="ui-doc-head__meta">
            <span>{draft.fechaCompra ? formatDate(draft.fechaCompra, printable.locale) : "Sin fecha"}</span>
            <span>{origin}</span>
          </div>
          {(purchase || canImport) && (
            <div className="ui-doc-head__actions">
              {canImport && <Button type="button" variant="secondary" icon={FileUp} onClick={() => setImportOpen(true)}>Importar factura</Button>}
              {purchase && <Button type="button" variant="secondary" icon={Printer} onClick={() => window.print()}>Imprimir</Button>}
            </div>
          )}
        </div>
      </header>
      {message && <p className="po-message po-message--error no-print">{message}</p>}
      {purchase && <div className="no-print"><SupplyTrace currentType="purchase" purchase={purchase} /></div>}
      {readOnly && purchase ? (
        <div className="no-print"><PurchaseProviderSnapshot countryCode={purchase.paisCodigo || company?.paisCodigo} provider={purchase.proveedorSnapshot} /></div>
      ) : (
        <section className="ui-step-card no-print" aria-labelledby="purchase-provider-title">
          <h2 id="purchase-provider-title" className="ui-step-title">¿A quién le compras?</h2>
          <PurchaseProviderSelector
            disabled={readOnly || referencesLocked}
            historicalNote={PROVIDER_AT_PURCHASE_NOTE}
            onChange={(proveedorId) => setDraft((current) => ({...current, proveedorId}))}
            originalSnapshot={purchase?.proveedorSnapshot}
            providers={providers}
            value={draft.proveedorId}
          />
        </section>
      )}
      <div className="no-print">
        <div className="po-layout">
          <div className="po-main">
            <PurchaseItemsEditor
              moneyStep={moneyStep}
              disabled={readOnly}
              items={draft.items}
              onChange={(items) => setDraft((current) => ({...current, items}))}
              onOpenCatalog={() => setCatalogOpen(true)}
              onScanProduct={addScannedProduct}
              readOnly={Boolean(readOnly && purchase)}
              referencesLocked={referencesLocked}
            />
            <section className="po-panel purchase-data-panel" aria-labelledby="purchase-document-title">
              <header className="ui-section-head">
                <div><span className="po-kicker">Datos de compra</span><h2 id="purchase-document-title" className="ui-section-head__title">Documento y fechas</h2></div>
              </header>
              {readOnly ? (
                <PurchaseDocumentInfo draft={draft} purchase={purchase} money={money} />
              ) : (
                <div className="purchase-document-grid purchase-data-grid">
                  <label>Tipo de documento
                    <select value={draft.tipoDocumento} onChange={(event) => changeDocumentType(event.target.value)}>
                      <option value="factura">Factura</option><option value="boleta">Boleta</option>
                      <option value="otro">Otro</option><option value="sin_documento">Sin documento</option>
                    </select>
                  </label>
                  {draft.tipoDocumento !== "sin_documento" && <label>Número documento proveedor
                    <input value={draft.numeroDocumentoProveedor} onChange={(event) => setDraft({...draft, numeroDocumentoProveedor: event.target.value})} />
                  </label>}
                  <label>Fecha de compra
                    <input type="date" value={draft.fechaCompra} onChange={(event) => setDraft({...draft, fechaCompra: event.target.value})} />
                  </label>
                  {draft.tipoDocumento !== "sin_documento" && <label>Fecha documento
                    <input type="date" value={draft.fechaDocumento} onChange={(event) => setDraft({...draft, fechaDocumento: event.target.value})} />
                  </label>}
                </div>
              )}
              {!readOnly && draft.documentoOrigen && <div className="purchase-imported-document-summary" role="status">
                <strong>Factura importada y pendiente de confirmación</strong>
                <span>{draft.documentoOrigen.nombreArchivo || "Documento"} · {draft.documentoOrigen.lineasAplicadas || 0} líneas vinculadas</span>
                <dl>
                  {hasText(draft.documentoOrigen.neto) && <div><dt>Neto</dt><dd>{money(draft.documentoOrigen.neto)}</dd></div>}
                  {hasText(draft.documentoOrigen.impuestoMonto) && <div><dt>{hasText(draft.documentoOrigen.impuestoPorcentaje) ? `${printable.impuestoNombre} (${draft.documentoOrigen.impuestoPorcentaje}%)` : printable.impuestoNombre}</dt><dd>{money(draft.documentoOrigen.impuestoMonto)}</dd></div>}
                  {hasText(draft.documentoOrigen.total) && <div><dt>Total</dt><dd>{money(draft.documentoOrigen.total)}</dd></div>}
                </dl>
                {draft.documentoOrigen.coherenciaEstado === "revisar" && <Notice variant="warning" role={null}>Los totales del documento no coinciden con las líneas. Revisa antes de confirmar.</Notice>}
              </div>}
            </section>
            <section className="po-panel purchase-conditions-panel" aria-labelledby="purchase-conditions-title">
              <header className="ui-section-head">
                <div><span className="po-kicker">Condiciones</span><h2 id="purchase-conditions-title" className="ui-section-head__title">Condiciones comerciales</h2></div>
                {!readOnly && <Button type="button" variant="secondary" onClick={() => setConditionsOpen(true)}>Editar condiciones</Button>}
              </header>
              <div className="purchase-conditions-summary">
                <div><strong>Condiciones de pago</strong><p>{draft.condicionesPago || "Sin condiciones informadas."}</p></div>
                {observation && <div><strong>Observaciones</strong><p>{observation}</p></div>}
              </div>
            </section>
            <section className="po-panel purchase-preview-panel" aria-labelledby="purchase-preview-title">
              <header className="ui-section-head">
                <div><span className="po-kicker">Documento</span><h2 id="purchase-preview-title" className="ui-section-head__title">Vista previa imprimible</h2><p className="ui-section-head__hint">Revisa cómo se verá el documento.</p></div>
                <div className="ui-section-head__actions">
                  {previewOpen && purchase && <Button type="button" variant="secondary" onClick={() => window.print()}>Imprimir</Button>}
                  <Button type="button" variant="secondary" aria-expanded={previewOpen} onClick={() => setPreviewOpen((current) => !current)}>{previewOpen ? "Ocultar vista previa" : "Ver vista previa"}</Button>
                </div>
              </header>
              {previewOpen && <div className="purchase-preview-body"><PurchasePrintView company={company} purchase={printable} /></div>}
            </section>
          </div>
          <PurchaseSummaryPanel
            currency={printable.moneda}
            disabled={readOnly}
            isNew={!purchase}
            locale={printable.locale}
            onCancel={purchase ? () => setActionDialog("cancel") : null}
            onConfirm={() => setActionDialog("confirm")}
            onSave={save}
            processing={processing}
            totals={totals}
            taxName={printable.impuestoNombre}
            taxRate={Number(printable.tasaIva || 0) * 100}
          />
        </div>
      </div>
      <div className="print-only"><PurchasePrintView company={company} purchase={printable} /></div>
      <InventoryCatalogDialog
        addedQuantities={catalogAddedQuantities}
        entries={catalogEntries}
        onAdd={addItem}
        onClose={() => setCatalogOpen(false)}
        open={catalogOpen}
        priceLabel="Costo"
      />
      <PurchaseDocumentImportDialog
        businessId={businessId}
        inventory={inventory}
        onApply={applyDocumentImport}
        onClose={() => setImportOpen(false)}
        open={importOpen}
        providers={providers}
        taxName={purchase?.impuestoNombre || company?.impuestoPredeterminadoNombre || "Impuesto"}
      />
      <ResponsiveDialog
        open={conditionsOpen}
        onClose={() => setConditionsOpen(false)}
        eyebrow="Condiciones"
        title="Editar condiciones comerciales"
        description="Agrega las condiciones de pago y observaciones que deben acompañar la compra."
        size="medium"
        footer={<Button type="button" onClick={() => setConditionsOpen(false)}>Listo</Button>}
      >
        <div className="purchase-conditions-form">
          <label>Condiciones de pago<textarea rows="4" value={draft.condicionesPago} onChange={(event) => setDraft({...draft, condicionesPago: event.target.value})} /></label>
          <label>Observaciones<textarea rows="4" value={draft.observaciones} onChange={(event) => setDraft({...draft, observaciones: event.target.value})} /></label>
        </div>
      </ResponsiveDialog>
      <ResponsiveDialog open={actionDialog === "confirm"} onClose={() => !processing && closeConfirmDialog()} eyebrow="Compra preparada" title="Confirmar compra" description="Al confirmar, se registrará el documento económico del proveedor." size="small" footer={<><Button ref={backButtonRef} type="button" variant="secondary" disabled={processing} onClick={closeConfirmDialog}>Volver</Button><Button type="button" loading={processing} disabled={confirmBlocked} onClick={confirm}>{processing ? "Confirmando..." : "Confirmar compra"}</Button></>}>
        <p>{stockSemantics.confirmationMessage}</p>
        {confirmError && <Notice variant="error" className="po-dialog-error" title={confirmError.title}>{confirmError.message}</Notice>}
      </ResponsiveDialog>
      <ResponsiveDialog open={actionDialog === "cancel"} onClose={() => !processing && closeCancelDialog()} eyebrow="Compra preparada" title="Cancelar compra" description="La compra preparada quedará cancelada y ya no podrá editarse." size="small" footer={<><Button ref={cancelBackRef} type="button" variant="secondary" disabled={processing} onClick={closeCancelDialog}>Volver</Button><Button type="button" variant="danger" loading={processing} disabled={Boolean(cancelError)} onClick={cancel}>{processing ? "Cancelando..." : "Cancelar compra"}</Button></>}>
        <p>Cancelar una compra preparada no modifica stock.</p>
        {cancelError && <Notice variant="error" className="po-dialog-error" title={cancelError.title}>{cancelError.message}</Notice>}
      </ResponsiveDialog>
    </main>
  );
}
