import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage"; // <-- add this

// Vite injects import.meta.env in the browser bundle.
// Guard so this file never crashes if it's undefined.
const viteEnv: Record<string, string | undefined> =
  typeof import.meta !== "undefined" && (import.meta as any).env
    ? (import.meta as any).env
    : {};

const firebaseConfig = {
  apiKey: viteEnv.VITE_FB_API_KEY || "",
  authDomain: viteEnv.VITE_FB_AUTH_DOMAIN || "",
  projectId: viteEnv.VITE_FB_PROJECT_ID || "",
  storageBucket: viteEnv.VITE_FB_STORAGE_BUCKET || "",
  messagingSenderId: viteEnv.VITE_FB_MSG_SENDER_ID || "",
  appId: viteEnv.VITE_FB_APP_ID || "",
};

// Only initialize when we have at least the apiKey; otherwise create a dummy app
// so the UI can render without throwing.
const app = getApps().length
  ? getApps()[0]
  : initializeApp(
      firebaseConfig.apiKey
        ? firebaseConfig
        : ({ apiKey: "demo", authDomain: "demo", projectId: "demo" } as any)
    );

export const auth = getAuth(app);
export const google = new GoogleAuthProvider();
export const db = getFirestore(app);
export const storage = getStorage(app); // <-- add this

// Optional: warn (non-fatal) if env is missing
if (!firebaseConfig.apiKey) {
  // eslint-disable-next-line no-console
  console.warn(
    "Firebase env is missing. Set VITE_FB_* in web/.env.local for local dev."
  );
}
console.log("Firebase config:", firebaseConfig);
