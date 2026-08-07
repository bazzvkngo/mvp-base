import React, {useEffect, useMemo, useRef, useState} from "react";
import {useLocation, useNavigate, useParams} from "react-router-dom";
import {calculatePurchaseTotals, canManagePurchases} from "../domain/purchaseModel.mjs";
import ProviderSelector from "../features/purchaseOrders/ProviderSelector";
import PurchaseCatalogDialog from "../features/purchases/PurchaseCatalogDialog";
import PurchaseItemsEditor from "../features/purchases/PurchaseItemsEditor";
import PurchasePrintView from "../features/purchases/PurchasePrintView";
import PurchaseSummaryPanel from "../features/purchases/PurchaseSummaryPanel";
import {getCompanyProfile} from "../services/companyService";
import {getInventoryItems} from "../services/inventoryService";
import {listarProveedores} from "../services/providerService";
import {
  actualizarCompraBorrador,
  cancelarCompraBorrador,
  confirmarCompra,
  crearCompra,
  createPurchaseRequestId,
  obtenerCompra,
} from "../services/purchaseService";
import "../features/purchases/purchases.css";

const EMPTY_TOTALS = {subtotal: 0, descuentoTotal: 0, neto: 0, iva: 0, total: 0};
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
});
const lineId = () => `linea-${globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

export default function NewPurchasePage({businessId, role}) {
  const {compraId} = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(emptyDraft);
  const [purchase, setPurchase] = useState(null);
  const [providers, setProviders] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [company, setCompany] = useState(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState(() => location.state?.message || "");
  const createId = useRef(createPurchaseRequestId("purchase-create"));
  const confirmId = useRef(createPurchaseRequestId("purchase-confirm"));
  const canManage = canManagePurchases(role);
  const readOnly = !canManage || Boolean(purchase && purchase.estado !== "borrador");
  const referencesLocked = Boolean(purchase?.ordenCompraId);

  useEffect(() => {
    if (location.state?.message) setMessage(location.state.message);
  }, [location.state?.message]);

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
        });
      }
    }).catch((error) => {
      if (active) setMessage(error.message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [businessId, compraId]);

  const totals = useMemo(() => {
    try {
      return draft.items.length ? calculatePurchaseTotals(draft.items) : EMPTY_TOTALS;
    } catch {
      return EMPTY_TOTALS;
    }
  }, [draft.items]);

  const printable = useMemo(() => ({
    ...(purchase || {}),
    ...draft,
    numero: purchase?.numero || "Compra por asignar",
    proveedorSnapshot: purchase?.proveedorId === draft.proveedorId
      ? purchase.proveedorSnapshot
      : providers.find((provider) => provider.proveedorId === draft.proveedorId) || {},
    ...totals,
  }), [draft, providers, purchase, totals]);

  const addItem = (item) => setDraft((current) => ({
    ...current,
    items: [...current.items, {
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
    }],
  }));

  const persist = async () => purchase
    ? (await actualizarCompraBorrador(businessId, purchase.id, draft)).compra
    : (await crearCompra(businessId, draft, {requestId: createId.current})).compra;

  const save = async () => {
    setProcessing(true);
    setMessage("");
    try {
      const stored = await persist();
      setPurchase(stored);
      createId.current = createPurchaseRequestId("purchase-create");
      setMessage("Borrador guardado.");
      if (!compraId) {
        navigate(`/compras/${stored.id}/editar`, {
          replace: true,
          state: {message: "Borrador guardado."},
        });
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setProcessing(false);
    }
  };

  const confirm = async () => {
    if (!globalThis.confirm(
      "Al confirmar la compra se actualizará el stock de los productos incluidos. Esta acción no podrá editarse posteriormente."
    )) return;
    setProcessing(true);
    setMessage("");
    try {
      const stored = await persist();
      const result = await confirmarCompra(businessId, stored.id, {
        requestId: confirmId.current,
      });
      confirmId.current = createPurchaseRequestId("purchase-confirm");
      setPurchase(result.compra);
      const success = result.productosActualizados
        ? "Compra confirmada. El inventario fue actualizado."
        : "Compra confirmada.";
      setMessage(success);
      navigate(`/compras/${stored.id}`, {replace: true, state: {message: success}});
    } catch (error) {
      setMessage(error.message);
    } finally {
      setProcessing(false);
    }
  };

  const cancel = async () => {
    if (!purchase || !globalThis.confirm("¿Cancelar este borrador de compra?")) return;
    setProcessing(true);
    try {
      const result = await cancelarCompraBorrador(businessId, purchase.id);
      setPurchase(result.compra);
      setMessage("Compra cancelada.");
      navigate(`/compras/${purchase.id}`, {
        replace: true,
        state: {message: "Compra cancelada."},
      });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setProcessing(false);
    }
  };

  if (loading) return <p className="muted">Cargando compra...</p>;

  return (
    <main className="po-workspace">
      <header className="po-header no-print">
        <div className="po-header__copy">
          <span className="po-kicker">Compra</span>
          <div className="po-header__title-row">
            <h1>{purchase ? "Compra" : "Nueva compra"}</h1>
            <span className={`po-status po-status--${purchase?.estado || "borrador"}`}>
              {purchase?.estado || "Borrador"}
            </span>
          </div>
          <div className="po-header__meta">
            <strong>{purchase?.numero || "Compra por asignar"}</strong>
            <span>{draft.fechaCompra}</span>
          </div>
        </div>
        <div className="po-header__actions">
          <button type="button" className="po-button po-button--secondary" onClick={() => navigate("/compras")}>
            Volver al historial
          </button>
          {purchase && (
            <button type="button" className="po-button po-button--secondary" onClick={() => window.print()}>
              Imprimir
            </button>
          )}
        </div>
      </header>
      {message && <p className="po-message no-print">{message}</p>}
      {purchase?.ordenCompraNumero && (
        <div className="purchase-origin no-print">
          <strong>Originada desde {purchase.ordenCompraNumero}</strong>
          <button type="button" className="po-button po-button--secondary" onClick={() => navigate(`/ordenes-compra/${purchase.ordenCompraId}`)}>
            Ver orden
          </button>
        </div>
      )}
      {purchase?.estado === "confirmada" && purchase.stockAplicado &&
        purchase.items.some((item) => item.tipoItem === "producto") && (
        <p className="purchase-stock-note no-print">Stock aplicado al confirmar esta compra.</p>
      )}
      <div className="no-print">
        <ProviderSelector
          disabled={readOnly || referencesLocked}
          onChange={(proveedorId) => setDraft((current) => ({...current, proveedorId}))}
          originalSnapshot={purchase?.proveedorSnapshot}
          providers={providers}
          value={draft.proveedorId}
        />
        <div className="po-layout">
          <div className="po-main">
            <PurchaseItemsEditor
              disabled={readOnly}
              items={draft.items}
              onChange={(items) => setDraft((current) => ({...current, items}))}
              onOpenCatalog={() => setCatalogOpen(true)}
              readOnly={Boolean(readOnly && purchase)}
              referencesLocked={referencesLocked}
            />
            <details className="po-panel po-details" open>
              <summary>
                <span><strong>Documento</strong><small>{draft.numeroDocumentoProveedor || "Sin documento asociado"}</small></span>
                <span className="po-details__indicator" aria-hidden="true" />
              </summary>
              {readOnly ? (
                <dl className="po-line__readonly">
                  <div><dt>Tipo</dt><dd>{draft.tipoDocumento}</dd></div>
                  <div><dt>Número</dt><dd>{draft.numeroDocumentoProveedor || "—"}</dd></div>
                  <div><dt>Fecha compra</dt><dd>{draft.fechaCompra}</dd></div>
                  <div><dt>Fecha documento</dt><dd>{draft.fechaDocumento || "—"}</dd></div>
                </dl>
              ) : (
                <div className="purchase-document-grid">
                  <label>Tipo de documento
                    <select value={draft.tipoDocumento} onChange={(event) => setDraft({...draft, tipoDocumento: event.target.value})}>
                      <option value="factura">Factura</option><option value="boleta">Boleta</option>
                      <option value="otro">Nota / Otro</option><option value="sin_documento">Sin documento</option>
                    </select>
                  </label>
                  <label>Número documento proveedor
                    <input value={draft.numeroDocumentoProveedor} onChange={(event) => setDraft({...draft, numeroDocumentoProveedor: event.target.value})} />
                  </label>
                  <label>Fecha compra
                    <input type="date" value={draft.fechaCompra} onChange={(event) => setDraft({...draft, fechaCompra: event.target.value})} />
                  </label>
                  <label>Fecha documento
                    <input type="date" value={draft.fechaDocumento} onChange={(event) => setDraft({...draft, fechaDocumento: event.target.value})} />
                  </label>
                </div>
              )}
            </details>
            <details className="po-panel po-details">
              <summary>
                <span><strong>Condiciones y observaciones</strong><small>{draft.condicionesPago || draft.observaciones || "Sin información adicional"}</small></span>
                <span className="po-details__indicator" aria-hidden="true" />
              </summary>
              {readOnly ? (
                <div className="purchase-document-grid">
                  <p><strong>Condiciones</strong><br />{draft.condicionesPago || "—"}</p>
                  <p><strong>Observaciones</strong><br />{draft.observaciones || "—"}</p>
                </div>
              ) : (
                <div className="purchase-document-grid">
                  <label className="purchase-field-wide">Condiciones de pago
                    <textarea value={draft.condicionesPago} onChange={(event) => setDraft({...draft, condicionesPago: event.target.value})} />
                  </label>
                  <label className="purchase-field-wide">Observaciones
                    <textarea value={draft.observaciones} onChange={(event) => setDraft({...draft, observaciones: event.target.value})} />
                  </label>
                </div>
              )}
            </details>
            <details className="po-panel po-details">
              <summary>
                <span><strong>Vista previa imprimible</strong><small>Documento listo para impresión</small></span>
                <span className="po-details__indicator" aria-hidden="true" />
              </summary>
              <PurchasePrintView company={company} purchase={printable} />
            </details>
          </div>
          <PurchaseSummaryPanel
            disabled={readOnly}
            onCancel={purchase ? cancel : null}
            onConfirm={confirm}
            onSave={save}
            processing={processing}
            totals={totals}
          />
        </div>
      </div>
      <div className="print-only"><PurchasePrintView company={company} purchase={printable} /></div>
      <PurchaseCatalogDialog
        items={inventory}
        onAdd={addItem}
        onClose={() => setCatalogOpen(false)}
        open={catalogOpen}
      />
    </main>
  );
}
