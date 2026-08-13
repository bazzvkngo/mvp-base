import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, XCircle } from "lucide-react";
import { useParams } from "react-router-dom";
import { sileo } from "sileo";
import BrandLogo from "../components/BrandLogo";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import QuotePrintView from "../features/quotes/QuotePrintView";
import "../features/quotes/public-quote.css";
import {
  getPublicQuoteProposal,
  respondPublicQuoteProposal,
} from "../services/publicQuoteService";
import { formatCLP, formatDate } from "../utils/formatters";
import { downloadQuotePdf } from "../utils/quotePdf";

const REJECTION_OPTIONS = [
  ["precio", "Precio"],
  ["plazo", "Plazo"],
  ["requerimiento_cambio", "El requerimiento cambió"],
  ["otra_alternativa", "Elegí otra alternativa"],
  ["otro", "Otro"],
  ["no_indica", "Prefiero no indicar"],
];

function PublicQuoteProposalPage() {
  const { token = "" } = useParams();
  const [state, setState] = useState({ loading: true, proposal: null, error: "" });
  const [dialog, setDialog] = useState("");
  const [responding, setResponding] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("no_indica");
  const [rejectionComment, setRejectionComment] = useState("");

  useEffect(() => {
    let active = true;
    setState({ loading: true, proposal: null, error: "" });
    getPublicQuoteProposal(token)
      .then((proposal) => {
        if (active) setState({ loading: false, proposal, error: "" });
      })
      .catch((error) => {
        if (active) {
          setState({
            loading: false,
            proposal: null,
            error: error.message || "No pudimos abrir esta propuesta.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [token]);

  const proposal = state.proposal;
  const companyName = useMemo(
    () =>
      proposal?.empresa?.nombreComercial ||
      proposal?.empresa?.razonSocial ||
      "Empresa emisora",
    [proposal]
  );
  const canRespond = proposal?.estado === "emitida";

  const handleResponse = async (action) => {
    if (responding) return;
    setResponding(true);
    try {
      const result = await respondPublicQuoteProposal({
        token,
        action,
        motivo: rejectionReason,
        comentario: rejectionComment,
      });
      const nextStatus = result.estado;
      setState((current) => ({
        ...current,
        proposal: { ...current.proposal, estado: nextStatus },
      }));
      setDialog("");
      sileo.success({
        title: nextStatus === "aceptada" ? "Propuesta aceptada" : "Respuesta registrada",
        description: "Tu respuesta fue registrada correctamente.",
      });
    } catch (error) {
      sileo.error({
        title: "No pudimos registrar tu respuesta",
        description: error.message || "Recarga la página e inténtalo nuevamente.",
      });
    } finally {
      setResponding(false);
    }
  };

  const handleDownload = async () => {
    if (!proposal || downloading) return;
    setDownloading(true);
    try {
      await downloadQuotePdf({ quote: proposal, companyProfile: proposal.empresa });
    } catch (error) {
      sileo.error({
        title: "No se pudo descargar el PDF",
        description: error.message || "Inténtalo nuevamente.",
      });
    } finally {
      setDownloading(false);
    }
  };

  if (state.loading) {
    return (
      <main className="public-proposal public-proposal--centered">
        <BrandLogo variant="auth" subtitle="Propuesta comercial" />
        <section className="public-proposal__message" aria-live="polite">
          <h1>Cargando propuesta</h1>
          <p>Estamos preparando la información comercial.</p>
        </section>
      </main>
    );
  }

  if (state.error || !proposal) {
    return (
      <main className="public-proposal public-proposal--centered">
        <BrandLogo variant="auth" subtitle="Propuesta comercial" />
        <section className="public-proposal__message" role="alert">
          <h1>Propuesta no disponible</h1>
          <p>{state.error}</p>
        </section>
      </main>
    );
  }

  const resolved = ["aceptada", "rechazada"].includes(proposal.estado);
  const expired = proposal.estado === "vencida";

  return (
    <main className="public-proposal">
      <header className="public-proposal__topbar">
        <BrandLogo variant="auth" subtitle="Propuesta comercial" />
        <span>Documento emitido por {companyName}</span>
      </header>

      <section className="public-proposal__hero">
        <div>
          <span className="public-proposal__eyebrow">Cotización {proposal.numero}</span>
          <h1>{companyName}</h1>
          <p>
            Propuesta para <strong>{proposal.clienteNombre || "cliente"}</strong>
            {proposal.proyectoNombre ? ` · ${proposal.proyectoNombre}` : ""}
          </p>
        </div>
        <div className="public-proposal__total">
          <small>Total</small>
          <strong>{formatCLP(proposal.total)}</strong>
          <span>Vigente hasta {formatDate(proposal.fechaVencimiento)}</span>
        </div>
      </section>

      {resolved && (
        <section className={`public-proposal__result public-proposal__result--${proposal.estado}`}>
          <AppIcon
            icon={proposal.estado === "aceptada" ? CheckCircle2 : XCircle}
            size={28}
          />
          <div>
            <h2>
              {proposal.estado === "aceptada"
                ? "Propuesta aceptada"
                : "Propuesta rechazada"}
            </h2>
            <p>Gracias. Tu respuesta fue registrada correctamente.</p>
          </div>
        </section>
      )}

      {expired && (
        <section className="public-proposal__result public-proposal__result--vencida">
          <XCircle aria-hidden="true" size={28} />
          <div>
            <h2>Esta propuesta ha vencido</h2>
            <p>
              La cotización {proposal.numero} venció el {formatDate(proposal.fechaVencimiento)}.
              Contacta a {companyName} si deseas solicitar una actualización.
            </p>
          </div>
        </section>
      )}

      <div className="public-proposal__toolbar no-print">
        <Button
          type="button"
          variant="secondary"
          icon={Download}
          onClick={handleDownload}
          disabled={downloading}
        >
          {downloading ? "Preparando PDF..." : "Descargar PDF"}
        </Button>
        {canRespond && (
          <div className="public-proposal__response-actions">
            <Button type="button" variant="secondary" onClick={() => setDialog("reject")}>
              Rechazar propuesta
            </Button>
            <Button type="button" onClick={() => setDialog("accept")}>
              Aceptar propuesta
            </Button>
          </div>
        )}
      </div>

      <section className="public-proposal__document">
        <QuotePrintView quote={proposal} companyProfile={proposal.empresa} />
      </section>

      <footer className="public-proposal__footer">
        Propuesta gestionada de forma segura con ValoraCloud.
      </footer>

      <ResponsiveDialog
        open={dialog === "accept"}
        onClose={() => !responding && setDialog("")}
        size="small"
        title="Aceptar propuesta"
        description={`¿Confirmas la aceptación de ${proposal.numero} por ${formatCLP(proposal.total)}?`}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={responding}
              onClick={() => setDialog("")}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={responding}
              onClick={() => handleResponse("accept")}
            >
              {responding ? "Registrando..." : "Confirmar aceptación"}
            </Button>
          </>
        }
      >
        <p className="public-proposal__dialog-copy">
          Esta acción registrará tu respuesta en la cotización. No genera una venta
          ni afecta inventario.
        </p>
      </ResponsiveDialog>

      <ResponsiveDialog
        open={dialog === "reject"}
        onClose={() => !responding && setDialog("")}
        size="small"
        title="Rechazar propuesta"
        description={`Indica opcionalmente por qué no continuarás con ${proposal.numero}.`}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={responding}
              onClick={() => setDialog("")}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={responding}
              onClick={() => handleResponse("reject")}
            >
              {responding ? "Registrando..." : "Confirmar rechazo"}
            </Button>
          </>
        }
      >
        <fieldset className="public-proposal__rejection-options" disabled={responding}>
          <legend>Motivo opcional</legend>
          {REJECTION_OPTIONS.map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="rejection-reason"
                value={value}
                checked={rejectionReason === value}
                onChange={(event) => setRejectionReason(event.target.value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <label className="public-proposal__comment">
          <span>Comentario opcional</span>
          <textarea
            value={rejectionComment}
            maxLength={500}
            disabled={responding}
            onChange={(event) => setRejectionComment(event.target.value)}
            placeholder="Puedes agregar un comentario breve."
          />
          <small>{rejectionComment.length}/500</small>
        </label>
      </ResponsiveDialog>
    </main>
  );
}

export default PublicQuoteProposalPage;
