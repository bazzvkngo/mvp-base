import React, {useEffect, useMemo, useRef, useState} from "react";
import {useLocation, useNavigate, useParams} from "react-router-dom";
import {sileo} from "sileo";
import Button from "../components/ui/Button";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import SupplyTrace from "../components/ui/SupplyTrace";
import {
  calculatePurchaseTotals,
  canManagePurchases,
  getPurchaseDocumentTypeLabel,
  getPurchaseStatusLabel,
  shouldReconcilePurchaseConfirmation,
} from "../domain/purchaseModel.mjs";
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
import {formatDate, formatMoney} from "../utils/formatters";
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
const timestampLabel = (value) => {
  const date = value?.toDate?.() || (value instanceof Date ? value : null);
  return date ? date.toLocaleString("es-CL") : "Fecha registrada en servidor";
};
const hasText = (value) => Boolean(String(value ?? "").trim());
const visibleObservation = (value, purchase) => {
  const observation = String(value || "").trim();
  const generated = purchase?.recepcionNumero ? `Originada desde ${purchase.recepcionNumero}` : "";
  const normalized = observation.toLocaleLowerCase("es-CL");
  if (generated && normalized === generated.toLocaleLowerCase("es-CL")) return "";
  return /^originada desde recepci[oó]n$/.test(normalized) ? "" : observation;
};

function PurchaseProviderSnapshot({provider = {}}) {
  const fiscalId = provider.identificadorFiscalValor || provider.rut;
  const details = [
    [provider.identificadorFiscalTipo || "RUT", fiscalId],
    ["Giro", provider.giro],
    ["Contacto", provider.personaContacto],
    ["Correo", provider.email],
    ["Teléfono", provider.telefono],
    ["Dirección", provider.direccion],
    ["Condiciones", provider.condicionesPago],
  ].filter(([, value]) => hasText(value));
  return <section className="po-panel purchase-provider-card"><header><span className="po-kicker">Proveedor</span><h2>{provider.razonSocial || "Proveedor histórico"}</h2><small>Snapshot histórico conservado</small></header>{details.length > 0 && <dl>{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}</section>;
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
  const [providers, setProviders] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [company, setCompany] = useState(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [actionDialog, setActionDialog] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");
  const createId = useRef(createPurchaseRequestId("purchase-create"));
  const confirmId = useRef(createPurchaseRequestId("purchase-confirm"));
  const pendingConfirmationPurchaseId = useRef("");
  const canManage = canManagePurchases(role);
  const readOnly = !canManage || Boolean(purchase && purchase.estado !== "borrador");
  const referencesLocked = Boolean(purchase?.ordenCompraId || purchase?.recepcionId);

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
      return draft.items.length ? calculatePurchaseTotals(draft.items, {
        tasaIva: purchase?.tasaIva ?? Number(company?.impuestoPredeterminadoTasa ?? 19) / 100,
      }) : EMPTY_TOTALS;
    } catch {
      return EMPTY_TOTALS;
    }
  }, [company?.impuestoPredeterminadoTasa, draft.items, purchase?.tasaIva]);

  const printable = useMemo(() => ({
    ...(purchase || {}),
    ...draft,
    numero: purchase?.numero || "Compra por asignar",
    paisCodigo: purchase?.paisCodigo || company?.paisCodigo || "CL",
    moneda: purchase?.moneda || company?.monedaCodigo || "CLP",
    locale: purchase?.locale || company?.locale || "es-CL",
    impuestoNombre: purchase?.impuestoNombre || company?.impuestoPredeterminadoNombre || "IVA",
    tasaIva: purchase?.tasaIva ?? Number(company?.impuestoPredeterminadoTasa ?? 19) / 100,
    proveedorSnapshot: purchase?.proveedorId === draft.proveedorId
      ? purchase.proveedorSnapshot
      : providers.find((provider) => provider.proveedorId === draft.proveedorId) || {},
    ...totals,
  }), [company, draft, providers, purchase, totals]);
  const money = (value) => formatMoney(value, printable.moneda, printable.locale);

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
      setMessage(error.message);
      sileo.error({title: "No se pudo guardar la compra", description: error.message});
    } finally {
      setProcessing(false);
    }
  };

  const confirm = async () => {
    setActionDialog("");
    setProcessing(true);
    setMessage("");
    let stored = purchase;
    try {
      if (!stored || pendingConfirmationPurchaseId.current !== stored.id) {
        stored = await persist();
        setPurchase(stored);
      }
    } catch (error) {
      setMessage(error.message);
      sileo.error({title: "No se pudo preparar la compra", description: error.message});
      setProcessing(false);
      return;
    }
    pendingConfirmationPurchaseId.current = stored.id;
    const finishConfirmation = (confirmed, productsUpdated) => {
      pendingConfirmationPurchaseId.current = "";
      confirmId.current = createPurchaseRequestId("purchase-confirm");
      setPurchase(confirmed);
      navigate(`/compras/${confirmed.id}`, {
        replace: true,
        state: {
          message: "Compra confirmada",
          description: productsUpdated
            ? "Compra histórica confirmada con su comportamiento de stock original."
            : "Documento económico confirmado. No se modificó stock.",
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
        setMessage(error.message);
        sileo.error({title: "No se pudo confirmar la compra", description: error.message});
      } else {
        try {
          const authoritative = await obtenerCompra(businessId, stored.id);
          if (authoritative?.estado === "confirmada" || authoritative?.stockAplicado === true) {
            finishConfirmation(authoritative);
          } else {
            if (authoritative) setPurchase(authoritative);
            setMessage(error.message);
            sileo.error({title: "No se pudo confirmar la compra", description: "La compra continúa preparada. Puedes reintentar con seguridad."});
          }
        } catch {
          setMessage(error.message);
          sileo.error({title: "No se pudo verificar la confirmación", description: "Recarga la compra antes de volver a intentarlo."});
        }
      }
    } finally {
      setProcessing(false);
    }
  };

  const cancel = async () => {
    if (!purchase) return;
    setActionDialog("");
    setProcessing(true);
    try {
      const result = await cancelarCompraBorrador(businessId, purchase.id);
      setPurchase(result.compra);
      setMessage("Compra cancelada.");
      navigate(`/compras/${purchase.id}`, {
        replace: true,
        state: {message: "Compra cancelada", description: `${purchase.numero} quedó cancelada sin modificar stock.`},
      });
    } catch (error) {
      setMessage(error.message);
      sileo.error({title: "No se pudo cancelar la compra", description: error.message});
    } finally {
      setProcessing(false);
    }
  };

  const changeDocumentType = (tipoDocumento) => setDraft((current) => ({
    ...current,
    tipoDocumento,
    ...(tipoDocumento === "sin_documento" ? {numeroDocumentoProveedor: "", fechaDocumento: ""} : {}),
  }));

  if (loading) return <p className="muted">Cargando compra...</p>;

  return (
    <main className="po-workspace">
      <header className="po-header no-print">
        <div className="po-header__copy">
          <span className="po-kicker">Compra</span>
          <div className="po-header__title-row">
            <h1>{purchase ? `Compra ${purchase.numero}` : "Nueva compra"}</h1>
            <span className={`po-status po-status--${purchase?.estado || "borrador"}`}>
              {getPurchaseStatusLabel(purchase?.estado || "borrador")}
            </span>
          </div>
          <div className="po-header__meta">
            <strong>{printable.proveedorSnapshot?.razonSocial || "Proveedor por seleccionar"}</strong>
            <span>{draft.fechaCompra ? formatDate(draft.fechaCompra, printable.locale) : "Sin fecha"} · {money(totals.total)}</span>
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
      {message && <p className="po-message po-message--error no-print">{message}</p>}
      {purchase && <div className="no-print"><SupplyTrace currentType="purchase" purchase={purchase} /></div>}
      {purchase?.registroAutomatico && (
        <section className="po-panel purchase-inventory-trace no-print">
          <header><div><span className="po-kicker">Inventario</span><h2>Trazabilidad de entradas</h2></div><small>Compra registrada {timestampLabel(purchase.registradoEn)}</small></header>
          {purchase.efectosInventario.length > 0 ? <ul className="purchase-movement-list">{purchase.efectosInventario.map((effect) => <li key={effect.movimientoEntradaId}><strong title={effect.nombre}>{effect.nombre}</strong><span>Entrada: {effect.cantidad} {effect.unidad}</span><span>Origen: {purchase.recepcionNumero || "Recepción asociada"}</span>{purchase.estado === "revertida" && <em>Entrada compensada por reversión</em>}</li>)}</ul> : <p className="purchase-empty-copy">Esta compra sólo contiene servicios o actividades; no generó entradas de stock.</p>}
          {purchase.estado === "revertida" && <div className="purchase-reversal-note"><strong>Compra revertida</strong><span>{timestampLabel(purchase.revertidaEn)} · {purchase.reversionMotivo}</span></div>}
        </section>
      )}
      {purchase?.estado === "confirmada" && purchase.stockAplicado &&
        purchase.items.some((item) => item.tipoItem === "producto") && (
        <p className="purchase-stock-note no-print">El inventario se actualizó al confirmar esta compra.</p>
      )}
      {purchase?.estado === "revertida" && <p className="purchase-stock-note no-print">La compra permanece en el historial y sus entradas de inventario fueron compensadas cuando correspondía.</p>}
      <div className="no-print">
        {readOnly && purchase ? <PurchaseProviderSnapshot provider={purchase.proveedorSnapshot} /> : <ProviderSelector
          disabled={readOnly || referencesLocked}
          onChange={(proveedorId) => setDraft((current) => ({...current, proveedorId}))}
          originalSnapshot={purchase?.proveedorSnapshot}
          providers={providers}
          value={draft.proveedorId}
        />}
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
                <span><strong>Documento tributario/comercial</strong><small>{draft.tipoDocumento === "sin_documento" ? "Sin documento asociado" : `${getPurchaseDocumentTypeLabel(draft.tipoDocumento)}${draft.numeroDocumentoProveedor ? ` N° ${draft.numeroDocumentoProveedor}` : ""}`}</small></span>
                <span className="po-details__indicator" aria-hidden="true" />
              </summary>
              {readOnly ? (
                <PurchaseDocumentInfo draft={draft} purchase={purchase} money={money} />
              ) : (
                <div className="purchase-document-grid">
                  <label>Tipo de documento
                    <select value={draft.tipoDocumento} onChange={(event) => changeDocumentType(event.target.value)}>
                      <option value="factura">Factura</option><option value="boleta">Boleta</option>
                      <option value="otro">Otro</option><option value="sin_documento">Sin documento</option>
                    </select>
                  </label>
                  {draft.tipoDocumento !== "sin_documento" && <label>Número documento proveedor
                    <input value={draft.numeroDocumentoProveedor} onChange={(event) => setDraft({...draft, numeroDocumentoProveedor: event.target.value})} />
                  </label>}
                  <label>Fecha compra
                    <input type="date" value={draft.fechaCompra} onChange={(event) => setDraft({...draft, fechaCompra: event.target.value})} />
                  </label>
                  {draft.tipoDocumento !== "sin_documento" && <label>Fecha documento
                    <input type="date" value={draft.fechaDocumento} onChange={(event) => setDraft({...draft, fechaDocumento: event.target.value})} />
                  </label>}
                </div>
              )}
            </details>
            <details className="po-panel po-details">
              <summary>
                <span><strong>Condiciones y observaciones</strong><small>{draft.condicionesPago || visibleObservation(draft.observaciones, purchase) || "Sin información adicional"}</small></span>
                <span className="po-details__indicator" aria-hidden="true" />
              </summary>
              {readOnly ? (
                <div className="purchase-notes-grid">
                  {draft.condicionesPago && <section><span>Condiciones de pago</span><p>{draft.condicionesPago}</p></section>}
                  {visibleObservation(draft.observaciones, purchase) && <section><span>Observaciones</span><p>{visibleObservation(draft.observaciones, purchase)}</p></section>}
                  {!draft.condicionesPago && !visibleObservation(draft.observaciones, purchase) && <p className="purchase-empty-copy">No hay condiciones u observaciones adicionales.</p>}
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
                <span><strong>Vista previa imprimible</strong><small>Presentación formal de la compra</small></span>
                <span className="po-details__indicator" aria-hidden="true" />
              </summary>
              <div className="purchase-preview-body"><PurchasePrintView company={company} purchase={printable} /></div>
            </details>
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
      <PurchaseCatalogDialog
        items={inventory}
        onAdd={addItem}
        onClose={() => setCatalogOpen(false)}
        open={catalogOpen}
      />
      <ResponsiveDialog open={actionDialog === "confirm"} onClose={() => !processing && setActionDialog("")} eyebrow="Compra preparada" title="Confirmar compra" description="Al confirmar, se registrará el documento económico del proveedor." size="small" footer={<><Button type="button" variant="secondary" disabled={processing} onClick={() => setActionDialog("")}>Volver</Button><Button type="button" disabled={processing} onClick={confirm}>{processing ? "Confirmando..." : "Confirmar compra"}</Button></>}><p>El stock no cambiará en este paso, porque el inventario se actualiza al confirmar las recepciones.</p></ResponsiveDialog>
      <ResponsiveDialog open={actionDialog === "cancel"} onClose={() => !processing && setActionDialog("")} eyebrow="Más acciones" title="Cancelar compra" description="La compra preparada quedará cancelada y ya no podrá editarse." size="small" footer={<><Button type="button" variant="secondary" disabled={processing} onClick={() => setActionDialog("")}>Volver</Button><Button type="button" variant="danger" disabled={processing} onClick={cancel}>{processing ? "Cancelando..." : "Cancelar compra"}</Button></>}><p>Cancelar una compra preparada no modifica stock.</p></ResponsiveDialog>
    </main>
  );
}
