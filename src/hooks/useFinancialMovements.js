import { useEffect, useMemo, useState } from "react";
import { getFinancialSummary } from "../domain/financialMovement.mjs";
import { subscribeToFinancialMovements } from "../services/financialService";
import useBusinessFormat from "./useBusinessFormat";

export default function useFinancialMovements(
  businessId,
  range,
  { type = "", status = "" } = {}
) {
  const [state, setState] = useState({
    items: [],
    loading: Boolean(businessId),
    error: "",
  });
  const start = range?.start || "";
  const end = range?.end || "";

  useEffect(() => {
    if (!businessId || !start || !end) {
      setState({ items: [], loading: false, error: "" });
      return undefined;
    }

    setState({ items: [], loading: true, error: "" });
    return subscribeToFinancialMovements(
      businessId,
      { start, end, type, status },
      (items) => setState({ items, loading: false, error: "" }),
      (error) => {
        if (import.meta.env.DEV) {
          console.error("No se pudieron cargar los movimientos financieros:", error);
        }
        setState({
          items: [],
          loading: false,
          error:
            error?.code === "failed-precondition"
              ? "La consulta financiera requiere desplegar sus índices de Firestore."
              : "No pudimos cargar los movimientos financieros.",
        });
      }
    );
  }, [businessId, end, start, status, type]);

  // Las sumas usan los decimales de cálculo de la moneda del negocio (SPEC 036): con 0, la suma de siempre.
  const { amountDecimals } = useBusinessFormat();
  const summary = useMemo(
    () => getFinancialSummary(state.items, amountDecimals),
    [amountDecimals, state.items]
  );
  return { ...state, summary };
}
