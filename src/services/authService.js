import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification as firebaseSendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";
import { userDocPath } from "../firebase/firestorePaths";

export function subscribeToAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function loginWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function registerWithEmail(email, password) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await setDoc(
    doc(db, ...userDocPath(credential.user.uid)),
    {
      email: credential.user.email,
      creadoEn: new Date(),
    },
    { merge: true }
  );

  try {
    await sendVerificationEmail(credential.user);
  } catch (error) {
    console.warn("No se pudo enviar el correo de verificacion:", error);
  }

  return credential;
}

export async function resetPassword(email) {
  const normalizedEmail = String(email || "").trim();
  if (!normalizedEmail) {
    throw new Error("auth/email-required");
  }

  return sendPasswordResetEmail(auth, normalizedEmail);
}

export async function sendVerificationEmail(user = auth.currentUser) {
  if (!user) {
    throw new Error("auth/no-current-user");
  }

  if (user.emailVerified) {
    return false;
  }

  await firebaseSendEmailVerification(user);
  return true;
}

export async function refreshCurrentUser() {
  const user = auth.currentUser;
  if (!user) return null;

  await user.reload();
  return auth.currentUser;
}

export function logout() {
  return signOut(auth);
}
