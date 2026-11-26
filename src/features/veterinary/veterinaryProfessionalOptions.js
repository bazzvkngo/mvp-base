import {listarMiembrosNegocio, listarPerfilesEmpleados} from "../../services/businessMemberService";

export async function loadAssignableProfessionals(businessId) {
  const [members, profiles] = await Promise.all([
    listarMiembrosNegocio(businessId),
    listarPerfilesEmpleados(businessId),
  ]);
  const clinicalProfiles = new Set(profiles.filter((profile) => profile.negocioId === businessId &&
    profile.estado === "activo" && profile.modulos?.includes("veterinaria_asignada")).map(({id}) => id));
  return members.filter((member) => member.uid && member.estado === "activo" && (
    (["OWNER", "ADMIN"].includes(member.rol) && !member.profileId) ||
    (member.rol === "MEMBER" && clinicalProfiles.has(member.profileId))
  ));
}

export function professionalOptionLabel(member) {
  const name = member.nombre === "Nombre no informado" ? member.correo : member.nombre;
  return member.perfilNombre ? `${name} · ${member.perfilNombre}` : name;
}
