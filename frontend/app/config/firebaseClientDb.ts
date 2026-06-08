import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
  type Firestore,
} from "firebase/firestore";

import app from "@/config/firebaseConfig";

// Firestore client-SDK migration (Variant B). This is the browser-side replacement
// for "browser -> API route -> Admin SDK": the client talks to Firestore directly,
// with a full local replica in IndexedDB (offline reads/writes + auto-sync). Access
// is gated by the deployed Security Rules, not by our server.

let dbInstance: Firestore | null = null;

/**
 * Returns the browser Firestore instance with offline persistence (IndexedDB).
 *
 * Browser-only: `persistentLocalCache` needs IndexedDB, so this MUST NOT run during
 * SSR. Call it from client components / effects / event handlers, never at module
 * top-level of a server-rendered file. Throws on the server to fail loud, not silent.
 *
 * `initializeFirestore` must be the first Firestore call on the app instance; the app
 * currently uses Firebase only for Auth, so this is safe.
 */
export function getClientDb(): Firestore {
  if (typeof window === "undefined") {
    throw new Error("getClientDb() is browser-only (IndexedDB persistence).");
  }
  if (dbInstance) return dbInstance;

  dbInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });

  // Dev-only: point at the local Firestore emulator when explicitly enabled.
  if (process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR === "true") {
    connectFirestoreEmulator(dbInstance, "localhost", 8080);
  }

  return dbInstance;
}
