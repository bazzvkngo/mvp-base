import React from "react";
import ResponsiveDialog from "../ui/ResponsiveDialog";
import Button from "../ui/Button";
import {
  FINANCIAL_STATUSES,
  FINANCIAL_TYPES,
  PAYMENT_METHODS,
  getFinancialCategories,
  getSantiagoDateKey,
} from "../../domain/financialMovement.mjs";
import {getCurrencyPluralName} from "../../domain/businessCatalog.js";
import {userErrorMessage} from "../../domain/userFacingError.mjs";
import useBusinessFormat from "../../hooks/useBusinessFormat";

const EMPTY_FORM = {
  type: "income",
  status: "paid",
  amount: "",
  date: "",
  concept: "",
  categoryId: "sales",
  paymentMethodId: "bank_transfer",
  counterpartyName: "",
  reference: "",
  note: "",
  sourceType: "manual",
  sourceId: "",
};

function toFormValue(movement, preferredType) {
  const type = movement?.type || preferredType || EMPTY_FORM.type;
  return {
    ...EMPTY_FORM,
    ...movement,
    type,
    amount: movement?.amount ? String(movement.amount) : "",
    date: movement?.date || getSantiagoDateKey(),
    categoryId:
      movement?.categoryId || getFinancialCategories(type)[0]?.id || "",
  };
}

function FinancialMovementDialog({
  movement,
  onClose,
  onSave,
  open,
  preferredType = "income",
}) {
  const { currency, amountDecimals } = useBusinessFormat();
  // Paso del monto (SPEC 036): "1" con 0 decimales (como siempre), "0.01" con 2. Es el paso y el mínimo del campo.
  const moneyStep = amountDecimals > 0 ? String(10 ** -amountDecimals) : "1";
  const [form, setForm] = React.useState(() =>
    toFormValue(movement, preferredType)
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const conceptRef = React.useRef(null);
  const formId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    setForm(toFormValue(movement, preferredType));
    setSaving(false);
    setError("");
  }, [movement, open, preferredType]);

  const updateField = (name, value) => {
    setForm((current) => {
      if (name !== "type") return { ...current, [name]: value };
      return {
        ...current,
        type: value,
        categoryId: getFinancialCategories(value)[0]?.id || "",
      };
    });
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({ ...form, amount: Number(form.amount) });
      onClose();
    } catch (saveError) {
      setError(userErrorMessage(saveError, "No pudimos guardar el movimiento."));
    } finally {
      setSaving(false);
    }
  };

  const categories = getFinancialCategories(form.type);
  const counterpartyLabel = form.type === "income" ? "Cliente (opcional)" : "Proveedor (opcional)";

  return (
    <ResponsiveDialog
      open={open}
      onClose={saving ? undefined : onClose}
      initialFocusRef={conceptRef}
      title={movement ? "Editar movimiento" : "Registrar movimiento"}
      description={`Los montos se registran en ${getCurrencyPluralName(currency)} y los pendientes no afectan el resultado neto.`}
      eyebrow="Finanzas"
      size="large"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            {saving ? "Guardando..." : movement ? "Guardar cambios" : "Registrar movimiento"}
          </Button>
        </>
      }
    >
      <form id={formId} className="financial-movement-form" onSubmit={submit}>
        {error && <p className="financial-feedback financial-feedback--error" role="alert">{error}</p>}

        <fieldset className="financial-segmented-field">
          <legend>Tipo de movimiento</legend>
          <div className="financial-segmented-control">
            {FINANCIAL_TYPES.map((type) => (
              <label key={type.id}>
                <input
                  type="radio"
                  name="type"
                  value={type.id}
                  checked={form.type === type.id}
                  onChange={(event) => updateField("type", event.target.value)}
                />
                <span>{type.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="financial-form-grid">
          <label className="erp-field financial-form-grid__wide">
            <span className="erp-field__label">Concepto</span>
            <input
              ref={conceptRef}
              className="erp-control"
              maxLength="160"
              required
              value={form.concept}
              onChange={(event) => updateField("concept", event.target.value)}
              placeholder={form.type === "income" ? "Ej. Servicio de mantención" : "Ej. Compra de insumos"}
            />
          </label>

          <label className="erp-field">
            <span className="erp-field__label">Monto {currency}</span>
            <input
              className="erp-control"
              inputMode={amountDecimals > 0 ? "decimal" : "numeric"}
              min={moneyStep}
              step={moneyStep}
              type="number"
              required
              value={form.amount}
              onChange={(event) => updateField("amount", event.target.value)}
              placeholder="0"
            />
          </label>

          <label className="erp-field">
            <span className="erp-field__label">Fecha</span>
            <input
              className="erp-control"
              type="date"
              required
              value={form.date}
              onChange={(event) => updateField("date", event.target.value)}
            />
          </label>

          <label className="erp-field">
            <span className="erp-field__label">Estado</span>
            <select
              className="erp-control"
              value={form.status}
              onChange={(event) => updateField("status", event.target.value)}
            >
              {FINANCIAL_STATUSES.map((status) => (
                <option key={status.id} value={status.id}>{status.label}</option>
              ))}
            </select>
          </label>

          <label className="erp-field">
            <span className="erp-field__label">Categoría</span>
            <select
              className="erp-control"
              value={form.categoryId}
              onChange={(event) => updateField("categoryId", event.target.value)}
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.label}</option>
              ))}
            </select>
          </label>

          <label className="erp-field">
            <span className="erp-field__label">Método de pago</span>
            <select
              className="erp-control"
              value={form.paymentMethodId}
              onChange={(event) => updateField("paymentMethodId", event.target.value)}
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method.id} value={method.id}>{method.label}</option>
              ))}
            </select>
          </label>

          <label className="erp-field">
            <span className="erp-field__label">{counterpartyLabel}</span>
            <input
              className="erp-control"
              maxLength="160"
              value={form.counterpartyName}
              onChange={(event) => updateField("counterpartyName", event.target.value)}
              placeholder={form.type === "income" ? "Nombre del cliente" : "Nombre del proveedor"}
            />
          </label>

          <label className="erp-field">
            <span className="erp-field__label">Referencia (opcional)</span>
            <input
              className="erp-control"
              maxLength="120"
              value={form.reference}
              onChange={(event) => updateField("reference", event.target.value)}
              placeholder="Folio, comprobante u orden"
            />
          </label>

          <label className="erp-field financial-form-grid__wide">
            <span className="erp-field__label">Nota (opcional)</span>
            <textarea
              className="erp-control financial-form-textarea"
              maxLength="500"
              rows="3"
              value={form.note}
              onChange={(event) => updateField("note", event.target.value)}
            />
          </label>
        </div>
      </form>
    </ResponsiveDialog>
  );
}

export default FinancialMovementDialog;
