import React, {useCallback, useEffect, useRef, useState} from "react";
import {RefreshCw, UserPlus, UsersRound} from "lucide-react";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import StatusBadge from "../components/ui/StatusBadge";
import {
  BUSINESS_MEMBER_ROLE_LABELS,
  BUSINESS_MEMBER_STATUS_LABELS,
  MANAGEABLE_BUSINESS_MEMBER_ROLES,
  canManageBusinessMembers,
  canReadBusinessMembers,
  isValidBusinessMemberEmail,
} from "../domain/businessMemberModel.mjs";
import {
  actualizarMembresiaNegocio,
  asociarUsuarioExistente,
  listarMiembrosNegocio,
} from "../services/businessMemberService.js";
import "../features/employees/employees.css";

function dateLabel(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("es-CL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
}

function errorMessage(error, fallback) {
  const message = String(error?.message || "").replace(/^Firebase:\s*/i, "").trim();
  return message || fallback;
}

function RoleBadge({role}) {
  return (
    <StatusBadge variant={role === "OWNER" ? "warning" : "neutral"}>
      {BUSINESS_MEMBER_ROLE_LABELS[role] || role}
    </StatusBadge>
  );
}

function StateBadge({status}) {
  return (
    <StatusBadge variant={status === "activo" ? "success" : "neutral"}>
      {BUSINESS_MEMBER_STATUS_LABELS[status] || status}
    </StatusBadge>
  );
}

function MemberActions({member, onRoleChange, onStatusChange, processing}) {
  if (member.rol === "OWNER") return null;
  return (
    <div className="employees-actions">
      <label>
        <span className="sr-only">Rol de {member.nombre}</span>
        <select
          aria-label={`Rol de ${member.nombre}`}
          disabled={processing}
          value={member.rol}
          onChange={(event) => onRoleChange(member, event.target.value)}
        >
          {MANAGEABLE_BUSINESS_MEMBER_ROLES.map((role) => (
            <option key={role} value={role}>
              {BUSINESS_MEMBER_ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </label>
      <Button
        type="button"
        variant={member.estado === "activo" ? "ghost-danger" : "secondary"}
        disabled={processing}
        onClick={() => onStatusChange(member)}
      >
        {processing
          ? "Procesando..."
          : member.estado === "activo"
            ? "Desactivar"
            : "Reactivar"}
      </Button>
    </div>
  );
}

export default function EmployeesPage({businessId, role}) {
  const emailRef = useRef(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [feedbackIsError, setFeedbackIsError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [adding, setAdding] = useState(false);
  const [processingUid, setProcessingUid] = useState("");
  const canRead = canReadBusinessMembers(role);
  const canManage = canManageBusinessMembers(role);

  const loadMembers = useCallback(async () => {
    if (!businessId || !canRead) {
      setMembers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      setMembers(await listarMiembrosNegocio(businessId));
    } catch (error) {
      setLoadError(errorMessage(error, "No pudimos cargar los miembros del negocio."));
    } finally {
      setLoading(false);
    }
  }, [businessId, canRead]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const openAddDialog = () => {
    setEmail("");
    setEmailError("");
    setDialogOpen(true);
  };

  const addMember = async (event) => {
    event.preventDefault();
    if (!isValidBusinessMemberEmail(email)) {
      setEmailError("Ingresa el correo completo de una cuenta ValoraCloud existente.");
      return;
    }
    setAdding(true);
    setEmailError("");
    try {
      await asociarUsuarioExistente(businessId, email);
      setDialogOpen(false);
      setFeedback("Usuario agregado como MEMBER con acceso activo.");
      setFeedbackIsError(false);
      await loadMembers();
    } catch (error) {
      setEmailError(errorMessage(error, "No pudimos asociar esta cuenta."));
    } finally {
      setAdding(false);
    }
  };

  const updateMember = async (member, patch, successMessage) => {
    setProcessingUid(member.uid);
    setFeedback("");
    try {
      await actualizarMembresiaNegocio(businessId, member.uid, {
        rol: patch.rol || member.rol,
        estado: patch.estado || member.estado,
      });
      setFeedback(successMessage);
      setFeedbackIsError(false);
      await loadMembers();
    } catch (error) {
      setFeedback(errorMessage(error, "No pudimos actualizar la membresía."));
      setFeedbackIsError(true);
    } finally {
      setProcessingUid("");
    }
  };

  const changeRole = (member, nextRole) => {
    updateMember(
      member,
      {rol: nextRole},
      `${member.nombre} ahora tiene rol ${BUSINESS_MEMBER_ROLE_LABELS[nextRole]}.`
    );
  };

  const changeStatus = (member) => {
    const nextStatus = member.estado === "activo" ? "inactivo" : "activo";
    if (
      nextStatus === "inactivo" &&
      !globalThis.confirm(`¿Desactivar el acceso de ${member.nombre}?`)
    ) return;
    updateMember(
      member,
      {estado: nextStatus},
      nextStatus === "activo"
        ? `${member.nombre} recuperó el acceso.`
        : `${member.nombre} quedó sin acceso a esta empresa.`
    );
  };

  if (!businessId || !canRead) {
    return (
      <section className="erp-page employees-page">
        <div className="erp-empty-state" role="alert">
          No tienes permisos para consultar los miembros del negocio activo.
        </div>
      </section>
    );
  }

  return (
    <section className="erp-page employees-page">
      <header className="erp-page-header">
        <div className="erp-page-header__content">
          <span className="employees-eyebrow">Gestión</span>
          <h1 className="erp-page-header__title">Empleados</h1>
          <p className="erp-page-header__description">
            Usuarios, roles y estado de acceso al negocio activo.
          </p>
        </div>
        {canManage && (
          <Button type="button" icon={UserPlus} onClick={openAddDialog}>
            Agregar usuario
          </Button>
        )}
      </header>

      {!canManage && (
        <div className="employees-notice" role="status">
          Tu rol permite consultar el directorio activo, pero solo OWNER administra accesos.
        </div>
      )}
      {feedback && (
        <div
          className={`employees-message${feedbackIsError ? " employees-message--error" : ""}`}
          role={feedbackIsError ? "alert" : "status"}
        >
          {feedback}
        </div>
      )}
      {loadError && (
        <div className="employees-message employees-message--error" role="alert">
          <span>{loadError}</span>
          <Button type="button" variant="secondary" icon={RefreshCw} onClick={loadMembers}>
            Reintentar
          </Button>
        </div>
      )}

      <section className="erp-panel" aria-labelledby="employees-list-title">
        <header className="employees-panel-header">
          <div>
            <h2 id="employees-list-title" className="erp-panel-title">Usuarios con acceso</h2>
            <p className="erp-secondary-text">
              {canManage
                ? "Miembros activos e inactivos de esta empresa."
                : "Miembros activos de esta empresa."}
            </p>
          </div>
          {!loading && !loadError && (
            <span className="employees-count">
              {members.length} {members.length === 1 ? "persona" : "personas"}
            </span>
          )}
        </header>

        {loading ? (
          <div className="erp-empty-state" role="status">Cargando usuarios y permisos...</div>
        ) : !loadError && members.length === 0 ? (
          <div className="erp-empty-state employees-empty-state">
            <AppIcon icon={UsersRound} size={30} />
            <h3>No hay miembros para mostrar</h3>
            <p>
              {canManage
                ? "Agrega una cuenta ValoraCloud existente para comenzar."
                : "No hay otros miembros activos en esta empresa."}
            </p>
            {canManage && <Button type="button" icon={UserPlus} onClick={openAddDialog}>Agregar usuario</Button>}
          </div>
        ) : !loadError ? (
          <>
            <div className="erp-table-region erp-desktop-only">
              <table className="erp-table employees-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Correo</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th>Incorporación</th>
                    {canManage && <th>Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.uid}>
                      <td><strong>{member.nombre}</strong></td>
                      <td>{member.correo}</td>
                      <td><RoleBadge role={member.rol} /></td>
                      <td><StateBadge status={member.estado} /></td>
                      <td>{dateLabel(member.fechaIncorporacion)}</td>
                      {canManage && (
                        <td>
                          <MemberActions
                            member={member}
                            processing={processingUid === member.uid}
                            onRoleChange={changeRole}
                            onStatusChange={changeStatus}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="erp-card-list erp-mobile-only">
              {members.map((member) => (
                <article className="erp-record-card employees-card" key={member.uid}>
                  <header className="erp-record-card__header">
                    <div>
                      <h3 className="erp-record-card__title">{member.nombre}</h3>
                      <span className="employees-card__email">{member.correo}</span>
                    </div>
                    <StateBadge status={member.estado} />
                  </header>
                  <dl className="employees-card__details">
                    <div><dt>Rol</dt><dd><RoleBadge role={member.rol} /></dd></div>
                    <div><dt>Incorporación</dt><dd>{dateLabel(member.fechaIncorporacion)}</dd></div>
                  </dl>
                  {canManage && (
                    <MemberActions
                      member={member}
                      processing={processingUid === member.uid}
                      onRoleChange={changeRole}
                      onStatusChange={changeStatus}
                    />
                  )}
                </article>
              ))}
            </div>
          </>
        ) : null}
      </section>

      <ResponsiveDialog
        open={dialogOpen}
        onClose={() => {if (!adding) setDialogOpen(false);}}
        title="Agregar usuario existente"
        eyebrow="Empleados"
        description="La cuenta debe existir previamente en ValoraCloud. Se agregará como MEMBER con acceso activo."
        size="small"
        initialFocusRef={emailRef}
        footer={(
          <>
            <Button type="button" variant="secondary" disabled={adding} onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="employee-add-form" disabled={adding}>
              {adding ? "Agregando..." : "Agregar usuario"}
            </Button>
          </>
        )}
      >
        <form id="employee-add-form" className="employees-add-form" onSubmit={addMember} noValidate>
          <label className="erp-field">
            <span className="erp-field__label">Correo de acceso</span>
            <input
              ref={emailRef}
              className="erp-control"
              type="email"
              autoComplete="email"
              maxLength="320"
              value={email}
              onChange={(event) => {setEmail(event.target.value); setEmailError("");}}
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? "employee-email-error" : undefined}
              placeholder="persona@empresa.cl"
            />
          </label>
          {emailError && <p id="employee-email-error" className="employees-form-error" role="alert">{emailError}</p>}
        </form>
      </ResponsiveDialog>
    </section>
  );
}
