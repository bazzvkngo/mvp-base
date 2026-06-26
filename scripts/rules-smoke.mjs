import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {
  connectStorageEmulator,
  getStorage,
  ref,
  uploadBytes,
} from "firebase/storage";

const PROJECT_ID = "tesis-inventario-ia";

function createClient(name) {
  const app = initializeApp(
    {
      apiKey: "demo-key",
      appId: `demo-${name}`,
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
      storageBucket: `${PROJECT_ID}.firebasestorage.app`,
    },
    name
  );
  const auth = getAuth(app);
  const db = getFirestore(app);
  const storage = getStorage(app);

  connectAuthEmulator(auth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectStorageEmulator(storage, "127.0.0.1", 9199);

  return { app, auth, db, storage };
}

async function expectDenied(label, operation) {
  try {
    await operation();
  } catch (error) {
    const code = String(error?.code || "");
    if (
      code.includes("permission-denied") ||
      code.includes("unauthorized")
    ) {
      console.log(`OK denegado: ${label}`);
      return;
    }
    throw error;
  }

  throw new Error(`Se esperaba denegacion: ${label}`);
}

async function main() {
  const ownerClient = createClient("rules-owner");
  const otherClient = createClient("rules-other");
  const guestClient = createClient("rules-guest");

  try {
    const ownerCredential = await signInAnonymously(ownerClient.auth);
    const otherCredential = await signInAnonymously(otherClient.auth);
    const ownerUid = ownerCredential.user.uid;
    const otherUid = otherCredential.user.uid;
    const inventoryPath = `usuarios/${ownerUid}/inventario/item-smoke`;

    await setDoc(doc(ownerClient.db, inventoryPath), {
      nombre: "Item de prueba",
      tipoItem: "producto",
      unidad: "unidad",
      costoBase: 1000,
      margenDeseado: 20,
      precioInterno: 1200,
      estado: "activo",
      uidUsuario: ownerUid,
      actualizadoEn: serverTimestamp(),
    });
    console.log("OK permitido: propietario crea inventario");

    await expectDenied("otro usuario lee inventario", () =>
      getDoc(doc(otherClient.db, inventoryPath))
    );
    await expectDenied("usuario no autenticado crea inventario", () =>
      setDoc(doc(guestClient.db, `usuarios/${ownerUid}/inventario/guest`), {
        nombre: "No permitido",
        uidUsuario: ownerUid,
      })
    );
    await expectDenied("propietario declara otro uidUsuario", () =>
      setDoc(doc(ownerClient.db, `usuarios/${ownerUid}/inventario/owner-mismatch`), {
        nombre: "No permitido",
        uidUsuario: otherUid,
      })
    );
    await expectDenied("crear cotizacion con estado de correo", () =>
      setDoc(
        doc(
          ownerClient.db,
          `usuarios/${ownerUid}/cotizaciones/quote-forged-email`
        ),
        {
          clienteNombre: "Cliente de prueba",
          estado: "borrador",
          estadoEnvioCorreo: "enviado",
          uidUsuario: ownerUid,
        }
      )
    );

    const quoteRef = doc(
      ownerClient.db,
      `usuarios/${ownerUid}/cotizaciones/quote-smoke`
    );
    await setDoc(quoteRef, {
      clienteNombre: "Cliente de prueba",
      estado: "borrador",
      uidUsuario: ownerUid,
      actualizadoEn: serverTimestamp(),
    });
    await updateDoc(quoteRef, {
      estado: "emitida",
      actualizadoEn: serverTimestamp(),
    });
    console.log("OK permitido: borrador pasa a emitida");

    await expectDenied("editar contenido de cotizacion emitida", () =>
      updateDoc(quoteRef, {
        clienteNombre: "Cambio no permitido",
        actualizadoEn: serverTimestamp(),
      })
    );
    await expectDenied("cliente escribe estado de correo", () =>
      updateDoc(quoteRef, {
        estadoEnvioCorreo: "enviado",
        actualizadoEn: serverTimestamp(),
      })
    );
    await updateDoc(quoteRef, {
      estado: "aceptada",
      estadoAnterior: "emitida",
      actualizadoEn: serverTimestamp(),
    });
    console.log("OK permitido: cambio controlado de estado comercial");

    const logoPath = `usuarios/${ownerUid}/empresa/logo/logo-smoke.png`;
    await uploadBytes(
      ref(ownerClient.storage, logoPath),
      new Uint8Array([137, 80, 78, 71]),
      { contentType: "image/png" }
    );
    console.log("OK permitido: propietario sube PNG");

    await expectDenied("otro usuario reemplaza logo", () =>
      uploadBytes(
        ref(otherClient.storage, logoPath),
        new Uint8Array([137, 80, 78, 71]),
        { contentType: "image/png" }
      )
    );
    await expectDenied("tipo MIME no permitido", () =>
      uploadBytes(
        ref(ownerClient.storage, `usuarios/${ownerUid}/empresa/logo/logo.txt`),
        new TextEncoder().encode("contenido"),
        { contentType: "text/plain" }
      )
    );
    await expectDenied("logo superior a 2 MB", () =>
      uploadBytes(
        ref(ownerClient.storage, `usuarios/${ownerUid}/empresa/logo/grande.png`),
        new Uint8Array(2 * 1024 * 1024 + 1),
        { contentType: "image/png" }
      )
    );

    console.log("RULES_SMOKE_OK");
  } finally {
    await Promise.all([
      deleteApp(ownerClient.app),
      deleteApp(otherClient.app),
      deleteApp(guestClient.app),
    ]);
  }
}

main().catch((error) => {
  console.error("RULES_SMOKE_FAILED", error?.code || "", error?.message || error);
  process.exitCode = 1;
});
