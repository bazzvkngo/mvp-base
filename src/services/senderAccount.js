import { auth } from "../firebase/firebaseConfig";
import { normalizeReplyAddress } from "../domain/emailReplyTo.mjs";

// Correo de quien envía, solo si está verificado: es el mismo criterio que usa
// el servidor para el respaldo de Reply-To y para la copia oculta.
export function getVerifiedAccountEmail() {
  const user = auth.currentUser;
  return user?.emailVerified === true ? normalizeReplyAddress(user.email) : "";
}
