"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Keep shared player and payment lists current on phones left open during the week. */
export function RefreshDate() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    const timer = setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [router]);
  return null;
}
