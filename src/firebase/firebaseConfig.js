import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyAGB0metkzNnJOtvI0zsft-NvIb5uoKBXA",
  authDomain: "tesis-inventario-ia.firebaseapp.com",
  projectId: "tesis-inventario-ia",
  storageBucket: "tesis-inventario-ia.firebasestorage.app",
  messagingSenderId: "1030324613425",
  appId: "1:1030324613425:web:27b82796bd1e955c2ac010",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
