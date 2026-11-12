"use client";
import { goldenPointStorage } from "./storage";
import {
  GoogleAuthProvider,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { clientAuth } from "./firebase";

interface AuthState {
  user: User | null;
  ready: boolean;
}

const Ctx = createContext<AuthState>({ user: null, ready: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, ready: false });
  useEffect(() => onAuthStateChanged(clientAuth(), (user) => setState({ user, ready: true })), []);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export const signInWithGoogle = () => signInWithPopup(clientAuth(), new GoogleAuthProvider());
export const signOutUser = () => signOut(clientAuth());

const EMAIL_KEY = "golden-point.signin.email";

export async function sendEmailLink(email: string, next: string) {
  await sendSignInLinkToEmail(clientAuth(), email, {
    url: `${window.location.origin}/signin/finish?next=${encodeURIComponent(next)}`,
    handleCodeInApp: true,
  });
  goldenPointStorage().setItem(EMAIL_KEY, email);
}

export async function finishEmailLink(promptEmail: () => string | null) {
  const auth = clientAuth();
  if (!isSignInWithEmailLink(auth, window.location.href)) return false;
  const email = goldenPointStorage().getItem(EMAIL_KEY) ?? promptEmail();
  if (!email) return false;
  await signInWithEmailLink(auth, email, window.location.href);
  goldenPointStorage().removeItem(EMAIL_KEY);
  return true;
}
