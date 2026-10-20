import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Initialize Firebase Admin SDK
function initAdmin() {
  if (getApps().length === 0) {
    // Check for service account credentials
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
      console.error("Firebase service account not found in environment variables");
      throw new Error("Firebase service account not found");
    }

    try {
      const serviceAccount = JSON.parse(
        Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString()
      );

      const app = initializeApp({
        credential: cert(serviceAccount)
      });
      // A mature gRPC reconnect pause otherwise lasts minutes, beyond the route's 30-second retry.
      // Configure once on app creation: HMR must reuse an already-used client without settings().
      getFirestore(app).settings({ 'grpc.max_reconnect_backoff_ms': 10_000 });
      return app;
    } catch (error) {
      console.error("Error initializing Firebase Admin:", error);
      throw error;
    }
  }

  return getApps()[0];
}

// Initialize Firestore with Admin SDK
const adminApp = initAdmin();
const adminDb = getFirestore(adminApp);
const adminAuth = getAuth(adminApp);

export { adminAuth, adminDb, FieldValue };
