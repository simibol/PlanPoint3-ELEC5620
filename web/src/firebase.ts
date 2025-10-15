import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore, setLogLevel } from "firebase/firestore";

// Add this type definition to fix the ImportMeta error
interface ImportMetaEnv {
  VITE_FB_API_KEY: string;
  VITE_FB_AUTH_DOMAIN: string;
  VITE_FB_PROJECT_ID: string;
  VITE_FB_STORAGE_BUCKET: string;
  VITE_FB_MSG_SENDER_ID: string;
  VITE_FB_APP_ID: string;
}

interface ImportMeta {
  env: ImportMetaEnv;
}

const firebaseConfig = {
  apiKey: import.meta.env.local.VITE_FB_API_KEY,
  authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FB_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FB_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FB_MSG_SENDER_ID,
  appId: import.meta.env.VITE_FB_APP_ID,
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const google = new GoogleAuthProvider();
export const db = getFirestore(app);
setLogLevel("debug");
export { app };
