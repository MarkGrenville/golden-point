"use client";
import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/lib/client/auth";

/** Reserve a separate viewport area so the fixed offer cannot cover page content. */
export function SignInOffer({ message, next, onSignIn, action = "Sign in and we’ll save them." }: { message: string; next: string; onSignIn?: () => void; action?: string }) {
  const { user, ready } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const bar = useRef<HTMLElement>(null);
  const visible = ready && !user && !dismissed;

  useLayoutEffect(() => {
    if (!visible || !bar.current) return;
    const root = document.documentElement;
    const measure = () => root.style.setProperty("--signin-offer-height", `${bar.current!.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar.current);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--signin-offer-height");
    };
  }, [visible]);

  if (!visible) return null;
  return createPortal(<aside ref={bar} className="signin-offer" aria-label="Optional sign-in">
    <div className="signin-offer-content">
      <p>{message} <Link href={`/signin?next=${encodeURIComponent(next)}`} onClick={onSignIn}>{action}</Link></p>
      <button type="button" className="secondary" onClick={() => setDismissed(true)} aria-label="Dismiss sign-in offer">Not now</button>
    </div>
  </aside>, document.body);
}
