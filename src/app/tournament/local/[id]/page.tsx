"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TournamentRunner } from "@/components/TournamentRunner";
import { api } from "@/lib/client/api";
import { useAuth } from "@/lib/client/auth";
import {
  createGuestShare,
  loadGuestShare,
  type GuestShare,
} from "@/lib/client/guest-share";
import { loadLocal, removeLocal, saveLocal } from "@/lib/client/local-sessions";
import {
  applyTournamentAction,
  toScoreboard,
  type Tournament,
  type TournamentAction,
} from "@/lib/tournament";

export default function LocalTournament() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [t, setT] = useState<Tournament | null | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<GuestShare | null>(null);
  const [shareUrl, setShareUrl] = useState<string>();
  const [sync, setSync] = useState<"local" | "saving" | "online" | "unsynced">(
    "local",
  );
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setT(loadLocal(id)?.tournament ?? null);
    setShare(loadGuestShare(id));
    setShareUrl(undefined);
  }, [id]);

  useEffect(() => {
    if (!t || !share) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const retryNow = () => setRetry((n) => n + 1);
    window.addEventListener("online", retryNow);
    setSync("saving");
    api(
      `/api/scoreboards/${share.id}`,
      { token: share.token, board: toScoreboard(t, new Date().toISOString()) },
      "PUT",
    )
      .then(() => {
        if (!current) return;
        setShareUrl(`${window.location.origin}/s/${share.id}`);
        setSync("online");
        setError(null);
      })
      .catch(() => {
        if (!current) return;
        setSync("unsynced");
        setError(
          "Scores are saved on this phone. The live scoreboard will update when the connection returns.",
        );
        timer = setTimeout(retryNow, 5000);
      });
    return () => {
      current = false;
      clearTimeout(timer);
      window.removeEventListener("online", retryNow);
    };
  }, [t, share, retry]);

  if (t === undefined)
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  if (t === null)
    return (
      <main>
        <p>
          No session called {id} on this device.{" "}
          <Link href="/tournament/new">Create one</Link>.
        </p>
      </main>
    );

  async function dispatch(action: TournamentAction) {
    const next = applyTournamentAction(t!, action, {
      actor: "local",
      now: new Date().toISOString(),
    });
    saveLocal(next);
    setT(next);
  }

  async function upload() {
    setUploading(true);
    setError(null);
    try {
      const saved = await api<Tournament>("/api/tournaments", {
        op: "import",
        tournament: t,
      });
      removeLocal(t!.id);
      router.push(`/tournament/${saved.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setUploading(false);
    }
  }

  return (
    <main className="wide">
      <TournamentRunner
        tournament={t}
        role="director"
        sync={sync}
        syncLabel={sync === "online" ? "Live scoreboard synced" : undefined}
        syncNotice="Scores are saved on this phone. Keep playing; the live scoreboard will catch up when the connection returns."
        onRetrySync={() => setRetry((n) => n + 1)}
        dispatch={dispatch}
        shareUrl={shareUrl}
        onShare={() => setShare(createGuestShare(id))}
      />
      <div className="card no-print">
        {!shareUrl && (
          <button
            disabled={sync === "saving"}
            onClick={() => setShare(createGuestShare(id))}
          >
            {sync === "saving"
              ? "Creating live link…"
              : share
                ? "Retry live scoreboard"
                : "Share live scoreboard"}
          </button>
        )}
        {shareUrl && (
          <p>
            Live scoreboard: <a href={shareUrl}>{shareUrl}</a> ·{" "}
            <button
              className="secondary"
              onClick={() => navigator.clipboard.writeText(shareUrl)}
            >
              Copy link
            </button>
          </p>
        )}
        <p className="small">
          No account needed. Keep scoring on this phone; everyone with the link
          sees the live results.
        </p>
        {error && <div className="notice bad">{error}</div>}
        {user ? (
          <button className="secondary" disabled={uploading} onClick={upload}>
            Save to my account to manage from other devices
          </button>
        ) : (
          <p className="small">
            Keep the organiser controls on this phone.{" "}
            <Link href={`/signin?next=/tournament/local/${t.id}`}>Sign in</Link>{" "}
            to keep a copy in your account.
          </p>
        )}
      </div>
    </main>
  );
}
