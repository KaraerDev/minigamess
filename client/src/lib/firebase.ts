import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, signInAnonymously, type Auth } from "firebase/auth";
import { getDatabase, type Database } from "firebase/database";

function configFromEnv() {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL as string | undefined,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
    appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  };
}

export function isFirebaseConfigured(): boolean {
  const config = configFromEnv();
  return Boolean(config.apiKey && config.databaseURL && config.projectId && config.appId);
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Database | null = null;

function ensureInitialized() {
  if (!isFirebaseConfigured()) {
    throw new Error(
      "Firebase yapılandırması eksik. .env dosyasına VITE_FIREBASE_* değerlerini yazın (bkz. .env.example).",
    );
  }
  if (!app) {
    app = initializeApp({
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
      databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL as string,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
      appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
    });
    auth = getAuth(app);
    db = getDatabase(app);
  }
  return { auth: auth as Auth, db: db as Database };
}

/** Anonim giriş yapar (kalıcı) ve oyuncu kimliği olacak uid'yi döner. */
export async function ensurePlayerUid(): Promise<string> {
  const { auth } = ensureInitialized();
  if (auth.currentUser) return auth.currentUser.uid;
  const credential = await signInAnonymously(auth);
  return credential.user.uid;
}

export function getDb(): Database {
  return ensureInitialized().db;
}
