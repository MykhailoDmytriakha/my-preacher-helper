import { initializeApp, cert, getApps } from 'firebase-admin/app';
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

      return initializeApp({
        credential: cert(serviceAccount)
      });
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

export { adminDb, FieldValue };