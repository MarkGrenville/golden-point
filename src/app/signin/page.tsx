"use client";
import { PageHeading } from "@/components/PageHeading";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { sendEmailLink, signInWithGoogle, useAuth } from "@/lib/client/auth";

import Link from "next/link";
import { signInNext } from "@/lib/client/signin-next";

function SignIn() {
  const params = useSearchParams();
  const next = signInNext(params.get("next"));
  const router = useRouter();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (user) router.replace(next);
  }, [user, next, router]);
  return (
    <main className="stack signin-page">
      <PageHeading eyebrow="Welcome back" title="Save it for next time" />
      <Link href={next}>Continue without signing in</Link>
      <p className="muted">
        Sign in to save your groups and tournaments online, connect payments or
        mark players as paid. Players can join and drop out using their private
        links without an account.
      </p>
      {error && <div className="notice bad">{error}</div>}
      <div className="card stack">
        <button
          className="full"
          onClick={() => signInWithGoogle().catch((e) => setError(e.message))}
        >
          Continue with Google
        </button>
      </div>
      <div className="card stack">
        {sent ? (
          <div className="notice ok">
            Check {email} for a sign-in link. Open it on this device.
          </div>
        ) : (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              sendEmailLink(email, next).then(
                () => setSent(true),
                (err) => setError(err.message),
              );
            }}
          >
            <label htmlFor="email">Email me a sign-in link</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            <button className="secondary full">Send link</button>
          </form>
        )}
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
