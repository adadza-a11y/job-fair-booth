import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// ── REPLACE these values with your Firebase project config ──
// Go to: Firebase Console → Project Settings → Your apps → Web app → Config
const firebaseConfig = {
  apiKey: "AIzaSyBNpwJuoKsVbY58r-PAamts2_v2Ns5u0So",
  authDomain: "grad-event-2026.firebaseapp.com",
  projectId: "grad-event-2026",
  storageBucket: "grad-event-2026.firebasestorage.app",
  messagingSenderId: "244189474111",
  appId: "1:244189474111:web:8e7d1d8f0f2d3e6c1eb78a",
  measurementId: "G-QT4RBVYP3M",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
