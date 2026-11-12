"use client";
import { PageHeading } from "@/components/PageHeading";
import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api } from "@/lib/client/api";

function Waiting() {
  const { id } = useParams<{ id: string }>();
  const token = useSearchParams().get("t");
  const [entry, setEntry] = useState<{
    status: string;
    url: string | null;
    eventId: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [privateLink, setPrivateLink] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  useEffect(() => {
    setPrivateLink(window.location.href);
    let active = true;
    const load = () =>
      api<typeof entry>(
        `/api/waiting/${id}?t=${encodeURIComponent(token ?? "")}`,
      )
        .then((value) => { if (active) { setEntry(value); setError(""); } })
        .catch((e) => { if (active) setError(e.message); });
    load();
    const timer = setInterval(load, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [id, token]);
  return (
    <main className="stack">
      <PageHeading eyebrow="Next on court" title="Your waiting-list place" />
      {error && <p className="notice bad" role="alert">{error}</p>}
      {!entry && !error && <p>Loading your waiting-list place…</p>}
      {entry && (
        <>
          <div className="card stack">
            {entry.status === "waiting" && <p className="notice ok">You’re on the waiting list. If a place opens, your offer will appear here in queue order. This page checks automatically.</p>}
            {entry.status === "offered" && <p className="notice ok">A place is available for you. Open it to accept and choose how to pay before the offer expires.</p>}
            {entry.status === "accepted" && <p className="notice ok">You accepted this offer. Open your booking to check payment or drop out.</p>}
            {entry.status === "expired" && <p className="notice warn">Your offer expired. Open the shared date to join again if you still want to play.</p>}
            {entry.status === "cancelled" && <p className="notice warn">This date has been cancelled.</p>}
            {entry.status === "removed" && <p>You’re no longer on the waiting list.</p>}
            {entry.url && (
              <a className="button full" href={entry.url}>
                {entry.status === "accepted" ? "Open your booking" : "Take this place"}
              </a>
            )}
          </div>
          <div className="card stack">
            <h2>Keep your private waiting link</h2>
            <p>Bookmark this page or copy the link. It lets you check and take your offer without signing in. Keep it private.</p>
            <label>Your private waiting link
              <input type="text" readOnly value={privateLink} onFocus={(e) => e.currentTarget.select()} />
            </label>
            <button className="secondary" onClick={async () => {
              try { await navigator.clipboard.writeText(privateLink); setCopyMessage("Private waiting link copied."); }
              catch { setCopyMessage("Select and copy the link above, or bookmark this page."); }
            }}>Copy private waiting link</button>
            {copyMessage && <p role="status">{copyMessage}</p>}
          </div>
          <a href={`/e/${entry.eventId}`}>Shared date and player list</a>
        </>
      )}
    </main>
  );
}
export default function Page() {
  return (
    <Suspense>
      <Waiting />
    </Suspense>
  );
}
