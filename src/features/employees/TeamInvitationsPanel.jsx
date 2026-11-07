import React from "react";
import {Ban, RefreshCw, Send} from "lucide-react";
import AppIcon from "../../components/ui/AppIcon";
import Button from "../../components/ui/Button";
import {SkeletonRegion, SkeletonTable} from "../../components/ui/Skeleton";
import Spinner from "../../components/ui/Spinner";
import StatusBadge from "../../components/ui/StatusBadge";
import {BUSINESS_INVITATION_STATES} from "../../domain/teamInvitationModel.mjs";
import {formatDate} from "../../utils/formatters";

// Orden de las filas y color/texto de la insignia de Estado. El perfil va aparte, en neutro.
const GROUPS = [
  {state: BUSINESS_INVITATION_STATES.PENDING, badge: "warning", badgeLabel: "Pendiente"},
  {state: BUSINESS_INVITATION_STATES.REJECTED, badge: "danger", badgeLabel: "Rechazada"},
  {state: BUSINESS_INVITATION_STATES.EXPIRED, badge: "neutral", badgeLabel: "Vencida"},
];

function InvitationDetail({invitation}) {
  if (invitation.estado === BUSINESS_INVITATION_STATES.PENDING) {
    return <span>Vence el {formatDate(invitation.expiraEn)}</span>;
  }
  if (invitation.estado === BUSINESS_INVITATION_STATES.REJECTED) {
    return <>
      <span>Rechazada el {formatDate(invitation.respondidoEn)}</span>
      <span className="employees-invitation__reason">
        {invitation.motivoRechazo ? `Motivo: ${invitation.motivoRechazo}` : "Sin motivo indicado."}
      </span>
    </>;
  }
  return <span>Venció el {formatDate(invitation.expiraEn)}</span>;
}

// Botón de fila con ícono y texto visible (patrón client-row-actions__labeled): Revocar no pide
// confirmación, así que el texto se queda a la vista. Mientras se procesa, el ícono pasa a spinner.
function RowAction({busy, disabled, icon, label, name, onClick}) {
  return <button type="button" className="client-row-actions__labeled" aria-label={`${label} ${name}`} aria-busy={busy || undefined} disabled={disabled} onClick={onClick}>
    {busy ? <Spinner size="sm" /> : <AppIcon icon={icon} size={17} />}
    {label}
  </button>;
}

// Sección "Invitaciones" de Empleados (SPEC 032): una tabla con pendientes (vencimiento y Revocar),
// rechazadas (motivo y fecha) y vencidas (Volver a invitar). Presentacional: el estado y las
// llamadas viven en EmployeesPage.
export default function TeamInvitationsPanel({status, groups, busyId, onRevoke, onReinvite, onRetry}) {
  const rows = GROUPS.flatMap((group) => groups[group.state].map((invitation) => ({group, invitation})));
  let body;
  if (status === "loading") {
    body = <SkeletonRegion label="Cargando invitaciones..."><SkeletonTable columns={5} rows={3} /></SkeletonRegion>;
  } else if (status === "error") {
    body = <div className="employees-message employees-message--error" role="alert">
      <span>No pudimos cargar las invitaciones.</span>
      <Button type="button" variant="secondary" icon={RefreshCw} onClick={onRetry}>Reintentar</Button>
    </div>;
  } else if (rows.length === 0) {
    body = <p className="employees-profile-empty">Aún no hay invitaciones enviadas.</p>;
  } else {
    body = <div className="erp-table-region">
      <table className="erp-table employees-table employees-invitations-table">
        <thead><tr><th>Correo</th><th>Perfil</th><th>Estado</th><th>Vence / Fecha</th><th className="clients-actions-column">Acciones</th></tr></thead>
        <tbody>
          {rows.map(({group, invitation}) => <tr key={invitation.id}>
            <td><strong className="employees-person__name">{invitation.correo}</strong></td>
            <td><StatusBadge variant="neutral">{invitation.perfilEtiqueta}</StatusBadge></td>
            <td><StatusBadge variant={group.badge}>{group.badgeLabel}</StatusBadge></td>
            <td><div className="employees-invitation__detail"><InvitationDetail invitation={invitation} /></div></td>
            <td className="clients-actions-column">
              <div className="client-row-actions">
                {group.state === BUSINESS_INVITATION_STATES.PENDING &&
                  <RowAction busy={busyId === invitation.id} disabled={Boolean(busyId)} icon={Ban} label="Revocar" name={invitation.correo} onClick={() => onRevoke(invitation)} />}
                {group.state === BUSINESS_INVITATION_STATES.EXPIRED &&
                  <RowAction busy={busyId === invitation.id} disabled={Boolean(busyId)} icon={Send} label="Volver a invitar" name={invitation.correo} onClick={() => onReinvite(invitation)} />}
              </div>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>;
  }
  return <section className="erp-panel" aria-labelledby="employees-invitations-title">
    <header className="employees-panel-header">
      <div>
        <h2 id="employees-invitations-title" className="erp-panel-title">Invitaciones</h2>
        <p className="erp-secondary-text">Cada persona decide si acepta. Las invitaciones vencen a los 7 días.</p>
      </div>
    </header>
    {body}
  </section>;
}
