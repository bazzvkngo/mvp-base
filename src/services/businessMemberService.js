import {httpsCallable} from "firebase/functions";
import {assertCloudFunctionAllowed} from "../config/firebaseEnvironment.mjs";
import {getFirebaseFunctions} from "../firebase/firebaseConfig.js";
import {
  adaptBusinessMember,
  normalizeBusinessMemberEmail,
} from "../domain/businessMemberModel.mjs";

const functions = getFirebaseFunctions("us-central1");

function call(name, data, operation) {
  assertCloudFunctionAllowed(operation);
  return httpsCallable(functions, name)(data);
}

export async function listarMiembrosNegocio(businessId) {
  const response = await call(
    "listarMiembrosNegocio",
    {businessId},
    "consultar miembros"
  );
  return (response.data?.miembros || []).map(adaptBusinessMember);
}

export async function asociarUsuarioExistente(businessId, correo, rol, profileId = "") {
  const response = await call(
    "asociarUsuarioExistente",
    {businessId, correo: normalizeBusinessMemberEmail(correo), rol, profileId},
    "asociar usuarios"
  );
  return response.data?.miembro || null;
}

export async function actualizarMembresiaNegocio(
  businessId,
  miembroUid,
  {rol, estado, profileId = ""}
) {
  const response = await call(
    "actualizarMembresiaNegocio",
    {businessId, miembroUid, rol, estado, profileId},
    "actualizar permisos"
  );
  return response.data?.miembro || null;
}

export async function listarPerfilesEmpleados(businessId) {
  const response = await call("listarPerfilesEmpleados", {businessId}, "consultar perfiles");
  return response.data?.perfiles || [];
}

export async function crearPerfilEmpleado(businessId, input) {
  const response = await call("crearPerfilEmpleado", {businessId, ...input}, "crear perfiles");
  return response.data?.perfil || null;
}

export async function actualizarPerfilEmpleado(businessId, profileId, input) {
  const response = await call(
    "actualizarPerfilEmpleado",
    {businessId, profileId, ...input},
    "actualizar perfiles"
  );
  return response.data?.perfil || null;
}

export async function eliminarPerfilEmpleado(businessId, profileId) {
  return (await call("eliminarPerfilEmpleado", {businessId, profileId}, "eliminar perfiles")).data;
}
