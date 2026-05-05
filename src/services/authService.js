import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
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
  return credential;
}

export function logout() {
  return signOut(auth);
}
