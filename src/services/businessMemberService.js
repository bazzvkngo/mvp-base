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

export async function asociarUsuarioExistente(businessId, correo, rol) {
  const response = await call(
    "asociarUsuarioExistente",
    {businessId, correo: normalizeBusinessMemberEmail(correo), rol},
    "asociar usuarios"
  );
  return response.data?.miembro || null;
}

export async function actualizarMembresiaNegocio(
  businessId,
  miembroUid,
  {rol, estado}
) {
  const response = await call(
    "actualizarMembresiaNegocio",
    {businessId, miembroUid, rol, estado},
    "actualizar permisos"
  );
  return response.data?.miembro || null;
}
