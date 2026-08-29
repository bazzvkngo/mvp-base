import React, {useCallback, useEffect, useRef, useState} from "react";
import {Lock, Pencil, RefreshCw, ShieldCheck, Trash2, UserPlus} from "lucide-react";
import Button from "../components/ui/Button";
import ResponsiveDialog from "../components/ui/ResponsiveDialog";
import StatusBadge from "../components/ui/StatusBadge";
import {
  BUSINESS_MEMBER_ROLE_LABELS,
  BUSINESS_MEMBER_STATUS_LABELS,
  MANAGEABLE_BUSINESS_MEMBER_ROLES,
  businessMemberProfileLabel,
  canManageBusinessMembers,
  canReadBusinessMembers,
  isValidBusinessMemberEmail,
} from "../domain/businessMemberModel.mjs";
import {BUSINESS_MODULE_LABELS, BUSINESS_MODULES} from "../domain/rbac.mjs";
import {
  actualizarMembresiaNegocio,
  actualizarPerfilEmpleado,
  asociarUsuarioExistente,
  crearPerfilEmpleado,
  eliminarPerfilEmpleado,
  listarMiembrosNegocio,
  listarPerfilesEmpleados,
} from "../services/businessMemberService.js";
import "../features/employees/employees.css";

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
  if (member.rol === "OWNER") return null;
  const self = member.uid === currentUserUid;
  return <div className="employees-actions">
    <select aria-label={`Perfil de ${member.nombre}`} value={selectionFor(member)} disabled={busy || self} onChange={(event) => onProfile(member, event.target.value)}>
      <ProfileOptions profiles={profiles} actorRole={actorRole} />
    </select>
    <Button type="button" variant={member.estado === "activo" ? "ghost-danger" : "secondary"} disabled={busy || self} onClick={() => onStatus(member)}>
      {busy ? "Procesando..." : member.estado === "activo" ? "Desactivar" : "Reactivar"}
    </Button>
    {self && <small>Tu propio acceso no se modifica aquí.</small>}
  </div>;
}

function ProfilesPanel({profiles, canManage, onCreate, onEdit, onDelete}) {
  return <section className="erp-panel">
    <header className="employees-panel-header"><div><h2 className="erp-panel-title">Perfiles y permisos</h2><p className="erp-secondary-text">Los perfiles personalizados habilitan acceso por módulos completos.</p></div>{canManage && <Button type="button" icon={ShieldCheck} onClick={onCreate}>Crear perfil</Button>}</header>
    <section className="employees-profile-section" aria-labelledby="system-profiles-title">
      <div className="employees-profile-section__header">
        <div><h3 id="system-profiles-title">Perfiles del sistema</h3><p>Accesos predefinidos que se mantienen protegidos.</p></div>
        <span>{PREDEFINED_PROFILES.length} perfiles</span>
      </div>
      <div className="employees-profile-grid">
        {PREDEFINED_PROFILES.map((role) => <article className="employees-profile-card employees-profile-card--system" key={role}><StatusBadge variant={role === "OWNER" ? "warning" : "neutral"}><Lock size={13} aria-hidden="true" /> Perfil protegido</StatusBadge><h3>{BUSINESS_MEMBER_ROLE_LABELS[role]}</h3><p>{PREDEFINED_PROFILE_DESCRIPTIONS[role]}</p></article>)}
      </div>
    </section>
    <section className="employees-profile-section" aria-labelledby="custom-profiles-title">
      <div className="employees-profile-section__header">
        <div><h3 id="custom-profiles-title">Perfiles personalizados</h3><p>Combinaciones de módulos definidas para este negocio.</p></div>
        <span>{profiles.length} {profiles.length === 1 ? "perfil" : "perfiles"}</span>
      </div>
      {profiles.length > 0 ? <div className="employees-profile-grid">
        {profiles.map((profile) => <article className="employees-profile-card" key={profile.id}><StatusBadge variant="neutral">Personalizado</StatusBadge><h3>{profile.nombre}</h3><p>{profile.descripcion || "Sin descripción."}</p><div className="employees-module-list">{profile.modulos.map((moduleId) => <span key={moduleId}>{BUSINESS_MODULE_LABELS[moduleId]}</span>)}</div>{canManage && <div className="employees-profile-actions"><Button type="button" variant="secondary" icon={Pencil} onClick={() => onEdit(profile)}>Editar</Button><Button type="button" variant="ghost-danger" icon={Trash2} onClick={() => onDelete(profile)}>Eliminar</Button></div>}</article>)}
      </div> : <div className="employees-profile-empty"><strong>Aún no hay perfiles personalizados.</strong><span>Crea uno cuando necesites combinar módulos de forma distinta a los perfiles del sistema.</span></div>}
    </section>
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

  const addMember = async (event) => {
    event.preventDefault();
    if (!isValidBusinessMemberEmail(email)) { setEmailError("Ingresa el correo completo de una cuenta ValoraCloud existente."); return; }
    const selected = decodeSelection(newSelection);
    setAdding(true); setEmailError("");
    try {
      await asociarUsuarioExistente(businessId, email, selected.rol, selected.profileId);
      setAddOpen(false); setFeedback({text: "Usuario agregado correctamente.", error: false}); await loadData();
    } catch (error) { setEmailError(cleanError(error, "No pudimos asociar esta cuenta.")); }
    finally { setAdding(false); }
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
    updateMember(member, selected, `${member.nombre} ahora tiene el perfil ${label}.`);
  };
  const changeStatus = (member) => {
    const estado = member.estado === "activo" ? "inactivo" : "activo";
    if (estado === "inactivo" && !globalThis.confirm(`¿Desactivar el acceso de ${member.nombre}?`)) return;
    updateMember(member, {estado}, estado === "activo" ? `${member.nombre} recuperó el acceso.` : `${member.nombre} quedó sin acceso.`);
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

  if (!businessId || !canRead) return <section className="erp-page employees-page"><div className="erp-empty-state" role="alert">No tienes permisos para consultar empleados.</div></section>;
  return <section className="erp-page employees-page">
    <header className="erp-page-header"><div className="erp-page-header__content"><span className="employees-eyebrow">Gestión</span><h1 className="erp-page-header__title">Empleados</h1><p className="erp-page-header__description">Usuarios, perfiles y acceso al negocio activo.</p></div>{canManage && tab === "employees" && <Button type="button" icon={UserPlus} onClick={() => {setEmail(""); setEmailError(""); setNewSelection("role:TECNICO"); setAddOpen(true);}}>Agregar usuario</Button>}</header>
    <div className="employees-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab === "employees"} onClick={() => setTab("employees")}>Empleados</button><button type="button" role="tab" aria-selected={tab === "profiles"} onClick={() => setTab("profiles")}>Perfiles y permisos</button></div>
    {!canManage && <div className="employees-notice">Puedes consultar esta sección; la administración corresponde a propietarios y administradores.</div>}
    {feedback.text && <div className={`employees-message${feedback.error ? " employees-message--error" : ""}`} role={feedback.error ? "alert" : "status"}>{feedback.text}</div>}
    {loadError && <div className="employees-message employees-message--error"><span>{loadError}</span><Button type="button" variant="secondary" icon={RefreshCw} onClick={loadData}>Reintentar</Button></div>}
    {loading ? <div className="erp-empty-state">Cargando empleados y perfiles...</div> : tab === "profiles" ? <ProfilesPanel profiles={profiles} canManage={canManage} onCreate={() => openProfile()} onEdit={openProfile} onDelete={deleteProfile} /> : <section className="erp-panel"><header className="employees-panel-header"><div><h2 className="erp-panel-title">Usuarios con acceso</h2><p className="erp-secondary-text">Perfiles asignados en esta empresa.</p></div><span className="employees-count">{members.length} {members.length === 1 ? "persona" : "personas"}</span></header><div className="erp-table-region"><table className="erp-table employees-table"><thead><tr><th>Nombre</th><th>Correo</th><th>Perfil</th><th>Estado</th><th>Incorporación</th>{canManage && <th>Acciones</th>}</tr></thead><tbody>{members.map((member) => <tr key={member.uid}><td><strong>{member.nombre}</strong></td><td>{member.correo}</td><td><StatusBadge variant={member.rol === "OWNER" ? "warning" : "neutral"}>{profileLabel(member)}</StatusBadge></td><td><StatusBadge variant={member.estado === "activo" ? "success" : "neutral"}>{BUSINESS_MEMBER_STATUS_LABELS[member.estado]}</StatusBadge></td><td>{member.fechaIncorporacion ? new Date(member.fechaIncorporacion).toLocaleDateString("es-CL") : "—"}</td>{canManage && <td><MemberActions member={member} profiles={profiles} actorRole={role} currentUserUid={currentUserUid} busy={processingUid === member.uid} onProfile={changeProfile} onStatus={changeStatus} /></td>}</tr>)}</tbody></table></div></section>}
    <ResponsiveDialog open={addOpen} onClose={() => {if (!adding) setAddOpen(false);}} title="Agregar usuario existente" eyebrow="Empleados" description="La cuenta debe existir previamente en ValoraCloud." size="small" initialFocusRef={emailRef} footer={<><Button type="button" variant="secondary" disabled={adding} onClick={() => setAddOpen(false)}>Cancelar</Button><Button type="submit" form="employee-add-form" disabled={adding}>{adding ? "Agregando..." : "Agregar usuario"}</Button></>}><form id="employee-add-form" className="employees-add-form" onSubmit={addMember}><label className="erp-field"><span className="erp-field__label">Correo de acceso</span><input ref={emailRef} className="erp-control" type="email" value={email} onChange={(event) => {setEmail(event.target.value); setEmailError("");}} placeholder="persona@empresa.cl" /></label><label className="erp-field"><span className="erp-field__label">Perfil</span><select className="erp-control" value={newSelection} onChange={(event) => setNewSelection(event.target.value)}><ProfileOptions profiles={profiles} actorRole={role} /></select></label>{emailError && <p className="employees-form-error" role="alert">{emailError}</p>}</form></ResponsiveDialog>
    <ResponsiveDialog open={profileOpen} onClose={() => {if (!savingProfile) setProfileOpen(false);}} title={editingProfile ? "Editar perfil" : "Crear perfil"} eyebrow="Perfiles y permisos" description="Selecciona los módulos completos que estarán disponibles." size="medium" initialFocusRef={profileNameRef} footer={<><Button type="button" variant="secondary" disabled={savingProfile} onClick={() => setProfileOpen(false)}>Cancelar</Button><Button type="submit" form="employee-profile-form" disabled={savingProfile}>{savingProfile ? "Guardando..." : "Guardar perfil"}</Button></>}>
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
