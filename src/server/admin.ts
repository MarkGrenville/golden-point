import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let app: App | undefined;

/** Admin SDK. Uses the emulators when FIRESTORE_EMULATOR_HOST is set (see README.md). */
export function adminApp(): App {
  if (app) return app;
  app = getApps()[0] ?? initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "demo-golden-point" });
  return app;
}

// Kept on globalThis so dev hot-reloads don't call settings() on an already-used instance.
const g = globalThis as { __goldenPointDb?: Firestore };
export function adminDb(): Firestore {
  if (!g.__goldenPointDb) {
    g.__goldenPointDb = getFirestore(adminApp());
    g.__goldenPointDb.settings({ ignoreUndefinedProperties: true });
  }
  return g.__goldenPointDb;
}

export const adminAuth = () => getAuth(adminApp());
