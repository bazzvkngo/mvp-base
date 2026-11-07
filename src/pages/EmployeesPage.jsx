import React, {useCallback, useEffect, useRef, useState} from "react";
import {Lock, Pencil, RefreshCw, ShieldCheck, Trash2, UserPlus} from "lucide-react";
import AppIcon from "../components/ui/AppIcon";
import Button from "../components/ui/Button";
import ModuleHeader from "../components/ui/ModuleHeader";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import {SkeletonRegion, SkeletonTable} from "../components/ui/Skeleton";
import StatusBadge from "../components/ui/StatusBadge";
import TeamInvitationsPanel from "../features/employees/TeamInvitationsPanel";
import {
  BUSINESS_MEMBER_ROLE_LABELS,
  BUSINESS_MEMBER_STATUS_LABELS,
  MANAGEABLE_BUSINESS_MEMBER_ROLES,
  businessMemberProfileLabel,
  canManageBusinessMembers,
  canReadBusinessMembers,
  isValidBusinessMemberEmail,
  normalizeBusinessMemberEmail,
} from "../domain/businessMemberModel.mjs";
import {BUSINESS_MODULE_LABELS, BUSINESS_MODULES} from "../domain/rbac.mjs";
import {
  INVITATION_SENT_MESSAGE,
  adaptBusinessInvitation,
  groupBusinessInvitations,
} from "../domain/teamInvitationModel.mjs";
import {getWorkMemberIdentity} from "../domain/workModel.mjs";
import {
  actualizarMembresiaNegocio,
  actualizarPerfilEmpleado,
  crearPerfilEmpleado,
  eliminarPerfilEmpleado,
  listarMiembrosNegocio,
  listarPerfilesEmpleados,
} from "../services/businessMemberService.js";
import {
  createRequestId,
  invitarMiembroNegocio,
  listarInvitacionesNegocio,
  revocarInvitacionNegocio,
} from "../services/teamInvitationService.js";
import {getRouteMeta} from "../app/navigation";
import "../features/employees/employees.css";

const MODULE = getRouteMeta("/empleados");

const PREDEFINED_PROFILES = ["OWNER", ...MANAGEABLE_BUSINESS_MEMBER_ROLES];
const PREDEFINED_PROFILE_DESCRIPTIONS = Object.freeze({
  OWNER: "Acceso completo al negocio, incluida la administración de miembros y perfiles.",
  ADMIN: "Acceso amplio a los módulos del negocio, salvo funciones reservadas al propietario.",
  VENTAS: "Clientes, cotizaciones y ventas, con consulta de inventario y referencias.",
  COMPRAS: "Proveedores, órdenes, recepciones y compras, con acceso a inventario y costos.",
  TECNICO: "Inventario y proyectos y trabajos para consulta y operación técnica.",
  FINANZAS: "Ventas, compras, inventario, reportes, rentabilidad y finanzas.",
  MEMBER: "Consulta transversal del negocio y operación técnica de proyectos y trabajos.",
});
const cleanError = (error, fallback) =>
  String(error?.message || "").replace(/^Firebase:\s*/i, "").trim() || fallback;
const profileLabel = (member) => businessMemberProfileLabel(member);
// Sin nombre registrado la persona se identifica por su correo.
const memberName = (member) => getWorkMemberIdentity(member);
// El correo va bajo el nombre solo cuando hay un nombre real; si el nombre ya es el correo no se repite.
const memberEmailLine = (member) => {
  const email = String(member.correo || "").trim();
  if (!email || email === "Sin correo disponible") return "";
  return email.toLowerCase() === memberName(member).toLowerCase() ? "" : email;
};
const selectionFor = (member) => member.profileId ? `profile:${member.profileId}` : `role:${member.rol}`;
const decodeSelection = (value) => value.startsWith("profile:")
  ? {rol: "MEMBER", profileId: value.slice(8)}
  : {rol: value.slice(5), profileId: ""};

function ProfileOptions({profiles, actorRole}) {
  return <>
    <optgroup label="Perfiles predefinidos">
      {MANAGEABLE_BUSINESS_MEMBER_ROLES
        .filter((item) => actorRole === "OWNER" || item !== "ADMIN")
        .map((item) => <option key={item} value={`role:${item}`}>{BUSINESS_MEMBER_ROLE_LABELS[item]}</option>)}
    </optgroup>
    {profiles.length > 0 && <optgroup label="Perfiles personalizados">
      {profiles.map((item) => <option key={item.id} value={`profile:${item.id}`}>{item.nombre}</option>)}
    </optgroup>}
  </>;
}

function MemberActions({member, profiles, actorRole, currentUserUid, busy, onProfile, onStatus}) {
  if (member.rol === "OWNER") return <span className="employees-readonly-label">Solo lectura</span>;
  const self = member.uid === currentUserUid;
  return <div className="employees-actions">
    <select aria-label={`Perfil de ${memberName(member)}`} value={selectionFor(member)} disabled={busy || self} onChange={(event) => onProfile(member, event.target.value)}>
      <ProfileOptions profiles={profiles} actorRole={actorRole} />
    </select>
    <Button type="button" variant={member.estado === "activo" ? "ghost-danger" : "secondary"} loading={busy} disabled={self} onClick={() => onStatus(member)}>
      {busy ? "Procesando..." : member.estado === "activo" ? "Desactivar" : "Reactivar"}
    </Button>
    {self && <small>Tu propio acceso no se modifica aquí.</small>}
  </div>;
}

function ProfileRowActions({profile, onEdit, onDelete}) {
  return <div className="client-row-actions employees-row-icons">
    <button type="button" onClick={() => onEdit(profile)} aria-label={`Editar perfil ${profile.nombre}`} title="Editar perfil"><AppIcon icon={Pencil} size={17} /></button>
    <button type="button" onClick={() => onDelete(profile)} aria-label={`Eliminar perfil ${profile.nombre}`} title="Eliminar perfil"><AppIcon icon={Trash2} size={17} /></button>
  </div>;
}

// Una tabla compacta por tipo de perfil. Si la carga falló y no hay perfiles propios, la sección
// de personalizados no se dibuja: el aviso de error con Reintentar ya está arriba y no se muestra un falso vacío.
function ProfilesPanel({profiles, canManage, loadFailed, onCreate, onEdit, onDelete}) {
  const showCustom = !(loadFailed && profiles.length === 0);
  return <section className="erp-panel employees-profiles">
    <section className="employees-profiles__section" aria-labelledby="system-profiles-title">
      <header className="employees-panel-header"><div><h2 id="system-profiles-title" className="erp-panel-title">Perfiles del sistema</h2><p className="erp-secondary-text">Los perfiles del sistema están protegidos y no se pueden modificar.</p></div></header>
      <div className="erp-table-region"><table className="erp-table employees-table employees-profiles-table"><thead><tr><th>Perfil</th><th>Qué puede ver</th></tr></thead><tbody>{PREDEFINED_PROFILES.map((role) => <tr key={role}><td><span className="employees-profile-name"><span className="employees-profile-lock" role="img" aria-label="Perfil protegido" title="Perfil protegido"><AppIcon icon={Lock} size={14} /></span><strong>{BUSINESS_MEMBER_ROLE_LABELS[role]}</strong></span></td><td><p className="employees-profile-text" title={PREDEFINED_PROFILE_DESCRIPTIONS[role]}>{PREDEFINED_PROFILE_DESCRIPTIONS[role]}</p></td></tr>)}</tbody></table></div>
    </section>
    {showCustom && <section className="employees-profiles__section" aria-labelledby="custom-profiles-title">
      <header className="employees-panel-header"><div><h2 id="custom-profiles-title" className="erp-panel-title">Perfiles personalizados</h2><p className="erp-secondary-text">Dan acceso a los módulos completos que elijas.</p></div>{canManage && <Button type="button" icon={ShieldCheck} onClick={onCreate}>Crear perfil</Button>}</header>
      {profiles.length > 0
        ? <div className="erp-table-region"><table className="erp-table employees-table employees-profiles-table"><thead><tr><th>Perfil</th><th>Qué puede ver</th>{canManage && <th className="clients-actions-column">Acciones</th>}</tr></thead><tbody>{profiles.map((profile) => {
          const modules = profile.modulos.map((moduleId) => BUSINESS_MODULE_LABELS[moduleId]).filter(Boolean).join(", ");
          return <tr key={profile.id}><td><strong className="employees-person__name">{profile.nombre}</strong>{profile.descripcion && <span className="employees-person__email employees-profile-text" title={profile.descripcion}>{profile.descripcion}</span>}</td><td><p className="employees-profile-text" title={modules}>{modules}</p></td>{canManage && <td className="clients-actions-column"><ProfileRowActions profile={profile} onEdit={onEdit} onDelete={onDelete} /></td>}</tr>;
        })}</tbody></table></div>
        : <p className="employees-profile-empty">Aún no hay perfiles personalizados.{canManage ? " Usa «Crear perfil» para agregar el primero." : ""}</p>}
    </section>}
  </section>;
}

export default function EmployeesPage({businessId, role, currentUserUid = ""}) {
  const emailRef = useRef(null);
  const profileNameRef = useRef(null);
  const [tab, setTab] = useState("employees");
  const [members, setMembers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState({text: "", error: false});
  const [addOpen, setAddOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [newSelection, setNewSelection] = useState("role:TECNICO");
  const [emailError, setEmailError] = useState("");
  const [adding, setAdding] = useState(false);
  const [processingUid, setProcessingUid] = useState("");
  const [invitations, setInvitations] = useState([]);
  const [invitationsStatus, setInvitationsStatus] = useState("loading");
  const [invitationBusyId, setInvitationBusyId] = useState("");
  const inviteRequestRef = useRef({key: "", id: ""});
  const [profileOpen, setProfileOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState(null);
  const [profileForm, setProfileForm] = useState({nombre: "", descripcion: "", modulos: []});
  const [profileError, setProfileError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const canRead = canReadBusinessMembers(role);
  const canManage = canManageBusinessMembers(role);

  const loadData = useCallback(async () => {
    if (!businessId || !canRead) { setMembers([]); setProfiles([]); setLoading(false); return; }
    setLoading(true); setLoadError("");
    try {
      const [nextMembers, nextProfiles] = await Promise.all([listarMiembrosNegocio(businessId), listarPerfilesEmpleados(businessId)]);
      setMembers(nextMembers); setProfiles(nextProfiles);
    } catch (error) { setLoadError(cleanError(error, "No pudimos cargar empleados y perfiles.")); }
    finally { setLoading(false); }
  }, [businessId, canRead]);
  useEffect(() => { loadData(); }, [loadData]);

  // Las invitaciones se cargan aparte: si fallan, la tabla de miembros no se ve afectada.
  const loadInvitations = useCallback(async ({silent = false} = {}) => {
    if (!businessId || !canManage) { setInvitations([]); return; }
    if (!silent) setInvitationsStatus("loading");
    try {
      setInvitations(await listarInvitacionesNegocio(businessId));
      setInvitationsStatus("ready");
    } catch { setInvitationsStatus("error"); }
  }, [businessId, canManage]);
  useEffect(() => { loadInvitations(); }, [loadInvitations]);

  // Un reintento del mismo envío reutiliza el requestId; un envío distinto genera otro.
  const sendInvitation = async ({correo, rol, profileId}) => {
    const key = [normalizeBusinessMemberEmail(correo), rol, profileId].join("|");
    if (inviteRequestRef.current.key !== key) inviteRequestRef.current = {key, id: createRequestId()};
    await invitarMiembroNegocio(businessId, {correo, rol, profileId, requestId: inviteRequestRef.current.id});
    inviteRequestRef.current = {key: "", id: ""};
  };

  const inviteMember = async (event) => {
    event.preventDefault();
    if (!isValidBusinessMemberEmail(email)) { setEmailError("Ingresa un correo válido."); return; }
    const selected = decodeSelection(newSelection);
    setAdding(true); setEmailError("");
    try {
      await sendInvitation({correo: email, ...selected});
      setAddOpen(false); setFeedback({text: INVITATION_SENT_MESSAGE, error: false}); await loadInvitations({silent: true});
    } catch (error) { setEmailError(cleanError(error, "No pudimos enviar la invitación.")); }
    finally { setAdding(false); }
  };

  const revokeInvitation = async (invitation) => {
    setInvitationBusyId(invitation.id);
    try {
      await revocarInvitacionNegocio(businessId, invitation.id);
      setFeedback({text: "Invitación revocada.", error: false}); await loadInvitations({silent: true});
    } catch (error) { setFeedback({text: cleanError(error, "No pudimos revocar la invitación."), error: true}); }
    finally { setInvitationBusyId(""); }
  };

  const reinvite = async (invitation) => {
    setInvitationBusyId(invitation.id);
    try {
      await sendInvitation({correo: invitation.correo, rol: invitation.rol, profileId: invitation.profileId});
      setFeedback({text: INVITATION_SENT_MESSAGE, error: false}); await loadInvitations({silent: true});
    } catch (error) { setFeedback({text: cleanError(error, "No pudimos enviar la invitación."), error: true}); }
    finally { setInvitationBusyId(""); }
  };

  const updateMember = async (member, patch, text) => {
    setProcessingUid(member.uid);
    try {
      await actualizarMembresiaNegocio(businessId, member.uid, {rol: patch.rol || member.rol, profileId: Object.hasOwn(patch, "profileId") ? patch.profileId : member.profileId, estado: patch.estado || member.estado});
      setFeedback({text, error: false}); await loadData();
    } catch (error) { setFeedback({text: cleanError(error, "No pudimos actualizar el acceso."), error: true}); }
    finally { setProcessingUid(""); }
  };

  const changeProfile = (member, value) => {
    const selected = decodeSelection(value);
    const label = selected.profileId ? profiles.find((item) => item.id === selected.profileId)?.nombre : BUSINESS_MEMBER_ROLE_LABELS[selected.rol];
    updateMember(member, selected, `${memberName(member)} ahora tiene el perfil ${label}.`);
  };
  const changeStatus = (member) => {
    const estado = member.estado === "activo" ? "inactivo" : "activo";
    if (estado === "inactivo" && !globalThis.confirm(`¿Desactivar el acceso de ${memberName(member)}?`)) return;
    updateMember(member, {estado}, estado === "activo" ? `${memberName(member)} recuperó el acceso.` : `${memberName(member)} quedó sin acceso.`);
  };

  const openProfile = (profile = null) => {
    setEditingProfile(profile); setProfileError("");
    setProfileForm(profile ? {nombre: profile.nombre, descripcion: profile.descripcion || "", modulos: [...profile.modulos]} : {nombre: "", descripcion: "", modulos: []});
    setProfileOpen(true);
  };
  const saveProfile = async (event) => {
    event.preventDefault();
    if (!profileForm.nombre.trim() || !profileForm.modulos.length) { setProfileError("Ingresa un nombre y selecciona al menos un módulo."); return; }
    const input = {...profileForm, nombre: profileForm.nombre.trim(), descripcion: profileForm.descripcion.trim()};
    setSavingProfile(true); setProfileError("");
    try {
      if (editingProfile) await actualizarPerfilEmpleado(businessId, editingProfile.id, input); else await crearPerfilEmpleado(businessId, input);
      setProfileOpen(false); setFeedback({text: editingProfile ? "Perfil actualizado." : "Perfil creado.", error: false}); await loadData();
    } catch (error) { setProfileError(cleanError(error, "No pudimos guardar el perfil.")); }
    finally { setSavingProfile(false); }
  };
  const deleteProfile = async (profile) => {
    if (!globalThis.confirm(`¿Eliminar el perfil ${profile.nombre}?`)) return;
    try { await eliminarPerfilEmpleado(businessId, profile.id); setFeedback({text: "Perfil eliminado.", error: false}); await loadData(); }
    catch (error) { setFeedback({text: cleanError(error, "No pudimos eliminar el perfil."), error: true}); }
  };

  if (!businessId || !canRead) return <section className="erp-page employees-page"><ModuleHeader description={MODULE.description} icon={MODULE.icon} title={MODULE.title} /><div className="erp-empty-state" role="alert">No tienes permisos para consultar empleados.</div></section>;
  return <section className="erp-page employees-page">
    <ModuleHeader
      actions={canManage && tab === "employees" ? <Button type="button" icon={UserPlus} onClick={() => {setEmail(""); setEmailError(""); setNewSelection("role:TECNICO"); setAddOpen(true);}}>Invitar usuario</Button> : null}
      description={MODULE.description}
      icon={MODULE.icon}
      title={MODULE.title}
    />
    <div className="employees-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab === "employees"} onClick={() => setTab("employees")}>Empleados</button><button type="button" role="tab" aria-selected={tab === "profiles"} onClick={() => setTab("profiles")}>Perfiles y permisos</button></div>
    {!canManage && <div className="employees-notice">Puedes consultar esta sección; la administración corresponde a propietarios y administradores.</div>}
    {feedback.text && <div className={`employees-message${feedback.error ? " employees-message--error" : ""}`} role={feedback.error ? "alert" : "status"}>{feedback.text}</div>}
    {loadError && <div className="employees-message employees-message--error"><span>{loadError}</span><Button type="button" variant="secondary" icon={RefreshCw} onClick={loadData}>Reintentar</Button></div>}
    {tab === "profiles" ? (loading ? <section className="erp-panel"><SkeletonRegion label="Cargando perfiles..."><SkeletonTable columns={2} rows={5} twoLine /></SkeletonRegion></section> : <ProfilesPanel profiles={profiles} canManage={canManage} loadFailed={Boolean(loadError)} onCreate={() => openProfile()} onEdit={openProfile} onDelete={deleteProfile} />) : loading && members.length === 0 ? <section className="erp-panel"><SkeletonRegion label="Cargando empleados y perfiles..."><SkeletonTable columns={canManage ? 5 : 4} /></SkeletonRegion></section> : loadError && members.length === 0 ? null : <section className="erp-panel"><header className="employees-panel-header"><div><h2 className="erp-panel-title">Usuarios con acceso</h2><p className="erp-secondary-text">Perfiles asignados en esta empresa.</p></div>{!loadError && <span className="employees-count">{members.length} {members.length === 1 ? "persona" : "personas"}</span>}</header><div className="erp-table-region"><table className="erp-table employees-table"><thead><tr><th>Nombre</th><th>Perfil</th><th>Estado</th><th>Incorporación</th>{canManage && <th>Acciones</th>}</tr></thead><tbody>{members.map((member) => <tr key={member.uid}><td><strong className="employees-person__name">{memberName(member)}</strong>{memberEmailLine(member) && <span className="employees-person__email">{memberEmailLine(member)}</span>}</td><td><StatusBadge variant={member.rol === "OWNER" ? "warning" : "neutral"}>{profileLabel(member)}</StatusBadge></td><td><StatusBadge variant={member.estado === "activo" ? "success" : "neutral"}>{BUSINESS_MEMBER_STATUS_LABELS[member.estado]}</StatusBadge></td><td>{member.fechaIncorporacion ? new Date(member.fechaIncorporacion).toLocaleDateString("es-CL") : "—"}</td>{canManage && <td><MemberActions member={member} profiles={profiles} actorRole={role} currentUserUid={currentUserUid} busy={processingUid === member.uid} onProfile={changeProfile} onStatus={changeStatus} /></td>}</tr>)}</tbody></table></div></section>}
    {canManage && tab === "employees" && <TeamInvitationsPanel status={invitationsStatus} groups={groupBusinessInvitations(invitations.map((item) => adaptBusinessInvitation(item, profiles)))} busyId={invitationBusyId} onRevoke={revokeInvitation} onReinvite={reinvite} onRetry={loadInvitations} />}
    <ResponsiveDialog open={addOpen} onClose={() => {if (!adding) setAddOpen(false);}} title="Invitar usuario" eyebrow="Empleados" description="La persona recibe la invitación y decide si la acepta." size="small" initialFocusRef={emailRef} footer={<><Button type="button" variant="secondary" disabled={adding} onClick={() => setAddOpen(false)}>Cancelar</Button><Button type="submit" form="employee-add-form" loading={adding}>{adding ? "Enviando..." : "Enviar invitación"}</Button></>}><form id="employee-add-form" className="employees-add-form" onSubmit={inviteMember}><label className="erp-field"><span className="erp-field__label">Correo de acceso</span><input ref={emailRef} className="erp-control" type="email" value={email} onChange={(event) => {setEmail(event.target.value); setEmailError("");}} placeholder="persona@empresa.cl" /></label><label className="erp-field"><span className="erp-field__label">Perfil</span><select className="erp-control" value={newSelection} onChange={(event) => setNewSelection(event.target.value)}><ProfileOptions profiles={profiles} actorRole={role} /></select></label>{emailError && <p className="employees-form-error" role="alert">{emailError}</p>}</form></ResponsiveDialog>
    <ResponsiveDialog open={profileOpen} onClose={() => {if (!savingProfile) setProfileOpen(false);}} title={editingProfile ? "Editar perfil" : "Crear perfil"} eyebrow="Perfiles y permisos" description="Selecciona los módulos completos que estarán disponibles." size="medium" initialFocusRef={profileNameRef} footer={<><Button type="button" variant="secondary" disabled={savingProfile} onClick={() => setProfileOpen(false)}>Cancelar</Button><Button type="submit" form="employee-profile-form" loading={savingProfile}>{savingProfile ? "Guardando..." : "Guardar perfil"}</Button></>}>
      <form id="employee-profile-form" className="employees-add-form" onSubmit={saveProfile}>
        <label className="erp-field"><span className="erp-field__label">Nombre</span><input ref={profileNameRef} className="erp-control" maxLength="80" placeholder="Ej. Coordinación comercial" value={profileForm.nombre} onChange={(event) => setProfileForm((current) => ({...current, nombre: event.target.value}))} /></label>
        <label className="erp-field"><span className="erp-field__label">Descripción</span><textarea className="erp-control" maxLength="300" rows="3" placeholder="Ej. Acceso para el equipo que prepara cotizaciones" value={profileForm.descripcion} onChange={(event) => setProfileForm((current) => ({...current, descripcion: event.target.value}))} /></label>
        <fieldset className="employees-modules">
          <legend>Acceso a módulos</legend>
          <div className="employees-modules-toolbar">
            <span><strong>{profileForm.modulos.length}</strong> / {BUSINESS_MODULES.length} seleccionados</span>
            <div><Button type="button" variant="secondary" disabled={profileForm.modulos.length === BUSINESS_MODULES.length} onClick={() => {setProfileForm((current) => ({...current, modulos: [...BUSINESS_MODULES]})); setProfileError("");}}>Seleccionar todos</Button><Button type="button" variant="secondary" disabled={profileForm.modulos.length === 0} onClick={() => setProfileForm((current) => ({...current, modulos: []}))}>Limpiar</Button></div>
          </div>
          <div className="employees-modules-grid">{BUSINESS_MODULES.map((moduleId) => <label key={moduleId}><input type="checkbox" checked={profileForm.modulos.includes(moduleId)} onChange={(event) => {setProfileForm((current) => ({...current, modulos: event.target.checked ? [...current.modulos, moduleId] : current.modulos.filter((item) => item !== moduleId)})); setProfileError("");}} /><span>{BUSINESS_MODULE_LABELS[moduleId]}</span></label>)}</div>
        </fieldset>
        {profileError && <p className="employees-form-error" role="alert">{profileError}</p>}
      </form>
    </ResponsiveDialog>
  </section>;
}
