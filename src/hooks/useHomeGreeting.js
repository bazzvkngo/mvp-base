import {useEffect, useState} from "react";
import {greetingPersonName, workshopGreeting} from "../domain/workshopHomeModel.mjs";
import {auth} from "../firebase/firebaseConfig";
import {obtenerPerfilPropio} from "../services/workOrderService";

// Saludo del resumen de inicio de un rubro («Buenos días, Nombre Apellido»). Usa «Nombre Apellido» del perfil propio si
// la persona tiene ambos; si no, lo de siempre (nombre de la cuenta o la parte local del correo).

export function homeDateLabel(date = new Date()) {
  const label = date.toLocaleDateString("es-CL", {weekday: "long", day: "numeric", month: "long"});
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function fallbackUserName() {
  const user = auth.currentUser;
  return user?.displayName || user?.email?.split("@")[0] || "";
}

export default function useHomeGreeting(now = new Date()) {
  const uid = auth.currentUser?.uid || "";
  const [profileName, setProfileName] = useState("");

  useEffect(() => {
    let active = true;
    if (uid) obtenerPerfilPropio(uid).then((profile) => { if (active) setProfileName(greetingPersonName(profile)); });
    return () => { active = false; };
  }, [uid]);

  const name = profileName || fallbackUserName();
  return `${workshopGreeting(now)}${name ? `, ${name}` : ""}`;
}
