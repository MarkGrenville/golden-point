"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeading } from "@/components/PageHeading";
import { Suspense, useEffect, useState } from "react";
import { finishEmailLink } from "@/lib/client/auth";

import { signInNext } from "@/lib/client/signin-next";

function Finish() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    finishEmailLink(() => window.prompt("Confirm the email address you used"))
      .then((ok) => (ok ? router.replace(signInNext(params.get("next"))) : setError("This sign-in link is invalid or has expired.")))
      .catch((e) => setError(e.message));
  }, [params, router]);
  return <main className="signin-page"><PageHeading eyebrow="Welcome back" title="Signing you in" />{error ? <div className="notice bad">{error}</div> : <p>Signing you in…</p>}</main>;
}

export default function Page() {
  return <Suspense><Finish /></Suspense>;
}
