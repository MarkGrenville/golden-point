"use client";
import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let auth: Auth | undefined;
let db: Firestore | undefined;
const emulators = process.env.NEXT_PUBLIC_USE_EMULATORS === "true";

function app() {
  return getApps().length ? getApp() : initializeApp(config);
}

export function clientAuth(): Auth {
  if (!auth) {
    auth = getAuth(app());
    if (emulators) connectAuthEmulator(auth, process.env.NEXT_PUBLIC_AUTH_EMULATOR_URL ?? "http://127.0.0.1:9410", { disableWarnings: true });
  }
  return auth;
}

export function clientDb(): Firestore {
  if (!db) {
    db = getFirestore(app());
    if (emulators) connectFirestoreEmulator(db, "127.0.0.1", 8180);
  }
  return db;
}
