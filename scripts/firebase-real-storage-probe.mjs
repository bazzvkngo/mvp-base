import { randomBytes } from "node:crypto";
import { deleteApp, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
} from "firebase/auth";
import {
  deleteObject,
  getStorage,
  ref,
  uploadBytes,
} from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyAGB0metkzNnJOtvI0zsft-NvIb5uoKBXA",
  authDomain: "tesis-inventario-ia.firebaseapp.com",
  projectId: "tesis-inventario-ia",
  storageBucket: "tesis-inventario-ia.firebasestorage.app",
  messagingSenderId: "1030324613425",
  appId: "1:1030324613425:web:27b82796bd1e955c2ac010",
};
const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const app = initializeApp(firebaseConfig, `storage-probe-${runId}`);
const auth = getAuth(app);
const storage = getStorage(app);
const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1ioAAAAASUVORK5CYII=",
    "base64"
  )
);
const results = [];
let user;
let sdkReference;
let restObjectName = "";
let idToken = "";

function recordFailure(name, error) {
  results.push({
    name,
    status: "failed",
    code: String(error?.code || "unknown"),
    message: String(error?.message || error).slice(0, 500),
  });
}

try {
  const password = `Codex-${randomBytes(18).toString("base64url")}!9a`;
  const credential = await createUserWithEmailAndPassword(
    auth,
    `codex.storage.probe.${runId}@example.com`,
    password
  );
  user = credential.user;
  idToken = await user.getIdToken(true);
  results.push({ name: "auth", status: "ok", uid: user.uid });

  sdkReference = ref(
    storage,
    `usuarios/${user.uid}/empresa/logo/sdk-${runId}.png`
  );
  let sdkUploadSucceeded = false;
  try {
    const upload = await uploadBytes(sdkReference, png, {
      contentType: "image/png",
    });
    results.push({
      name: "storage-sdk-upload",
      status: "ok",
      size: upload.metadata.size,
    });
    sdkUploadSucceeded = true;
  } catch (error) {
    recordFailure("storage-sdk-upload", error);
  }
  if (sdkUploadSucceeded) {
    try {
      await deleteObject(sdkReference);
      sdkReference = null;
      results.push({ name: "storage-sdk-delete", status: "ok" });
    } catch (error) {
      recordFailure("storage-sdk-delete", error);
    }
  }

  restObjectName = `usuarios/${user.uid}/empresa/logo/rest-${runId}.png`;
  const uploadUrl =
    `https://firebasestorage.googleapis.com/v0/b/${firebaseConfig.storageBucket}/o` +
    `?uploadType=media&name=${encodeURIComponent(restObjectName)}`;
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "image/png",
    },
    body: png,
  });
  const uploadBody = await uploadResponse.text();
  results.push({
    name: "storage-rest-upload",
    status: uploadResponse.ok ? "ok" : "failed",
    httpStatus: uploadResponse.status,
    body: uploadBody.slice(0, 500),
  });
  if (uploadResponse.ok) {
    const deleteUrl =
      `https://firebasestorage.googleapis.com/v0/b/${firebaseConfig.storageBucket}/o/` +
      encodeURIComponent(restObjectName);
    const deleteResponse = await fetch(deleteUrl, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${idToken}` },
    });
    results.push({
      name: "storage-rest-delete",
      status: deleteResponse.ok ? "ok" : "failed",
      httpStatus: deleteResponse.status,
    });
    if (deleteResponse.ok) restObjectName = "";
  }
} finally {
  if (sdkReference) await deleteObject(sdkReference).catch(() => {});
  if (restObjectName && idToken) {
    const cleanupUrl =
      `https://firebasestorage.googleapis.com/v0/b/${firebaseConfig.storageBucket}/o/` +
      encodeURIComponent(restObjectName);
    await fetch(cleanupUrl, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${idToken}` },
    }).catch(() => {});
  }
  if (user) await deleteUser(user).catch(() => {});
  await deleteApp(app).catch(() => {});
}

console.log(
  JSON.stringify(
    { projectId: firebaseConfig.projectId, bucket: firebaseConfig.storageBucket, results },
    null,
    2
  )
);
