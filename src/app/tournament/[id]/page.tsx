"use client";
import { doc, onSnapshot } from "firebase/firestore";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { TournamentRunner, type SyncState } from "@/components/TournamentRunner";
import { api, ApiError } from "@/lib/client/api";
import { useAuth } from "@/lib/client/auth";
import { clientDb } from "@/lib/client/firebase";
import { loadPending, savePending, type PendingScore } from "@/lib/client/local-sessions";
import type { Tournament, TournamentAction } from "@/lib/tournament";

export default function CloudTournament() {
  const { id } = useParams<{ id: string }>();
  const { user, ready } = useAuth();
  const [t, setT] = useState<Tournament | null>(null);
  const [role, setRole] = useState<"director" | "scorer">("scorer");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingScore[]>([]);
  const [saving, setSaving] = useState(false);
  const [scorerEmail, setScorerEmail] = useState("");
  const revision = useRef<number | null>(null);
  useEffect(() => {
    revision.current = t?.revision ?? null;
  }, [t]);

  const reload = useCallback(async () => {
    const res = await api<{ tournament: Tournament; role: "director" | "scorer" }>(`/api/tournaments/${id}`);
    setT(res.tournament);
    setRole(res.role);
  }, [id]);

  useEffect(() => {
    if (!ready || !user) return;
    setPending(loadPending(id));
    reload().catch((e) => setError(e.message));
    // The public scoreboard changes whenever anyone saves; use it as a cheap change signal.
    return onSnapshot(doc(clientDb(), `publicScoreboards/${id}`), (snap) => {
      const rev = snap.data()?.revision;
      if (revision.current !== null && rev !== undefined && rev !== revision.current) reload().catch(() => undefined);
    });
  }, [id, ready, user, reload]);

  async function send(action: TournamentAction) {
    const res = await api<{ tournament: Tournament }>(`/api/tournaments/${id}`, { action });
    setT(res.tournament);
  }

  async function dispatch(action: TournamentAction) {
    setSaving(true);
    try {
      await send(action);
    } catch (e) {
      if (!(e instanceof ApiError) && action.type === "result") {
        // Network failure: keep the score as a visible unsynchronised draft on this device only.
        const next = [...pending.filter((p) => p.matchId !== action.matchId), { matchId: action.matchId, expectedMatchRevision: action.expectedMatchRevision, scoreA: action.scoreA, scoreB: action.scoreB }];
        setPending(next);
        savePending(id, next);
        return;
      }
      if (e instanceof ApiError && e.status === 409) await reload();
      throw e;
    } finally {
      setSaving(false);
    }
  }

  async function retry() {
    const left: PendingScore[] = [];
    for (const p of pending) {
      try {
        await send({ type: "result", ...p });
      } catch (e) {
        if (!(e instanceof ApiError)) left.push(p);
        else setError(`A score for match ${p.matchId} was rejected: ${e.message}`);
      }
    }
    setPending(left);
    savePending(id, left);
    await reload().catch(() => undefined);
  }

  if (!ready) return <main><p>Loading…</p></main>;
  if (!user) return <main><p><Link href={`/signin?next=/tournament/${id}`}>Sign in</Link> to run or score this tournament. Spectators can use the <Link href={`/s/${id}`}>live scoreboard</Link>.</p></main>;
  if (error && !t) return <main><div className="notice bad">{error}</div></main>;
  if (!t) return <main><p>Loading…</p></main>;

  const sync: SyncState = pending.length ? "unsynced" : saving ? "saving" : "online";
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/s/${id}` : undefined;
  return (
    <main className="wide">
      {error && <div className="notice bad">{error}</div>}
      <TournamentRunner
        tournament={t}
        role={role}
        sync={sync}
        unsynced={Object.fromEntries(pending.map((p) => [p.matchId, p]))}
        dispatch={dispatch}
        onRetrySync={retry}
        shareUrl={shareUrl}
        fromEvent={!!t.eventId}
      />
      {role === "director" && (
        <div className="card no-print stack">
          <h3>Add a scorer</h3>
          <p className="small muted">Scorers can enter results only — no payments, roster or settings. They need to have signed in once.</p>
          <div className="row">
            <input className="grow" type="email" placeholder="scorer@example.com" value={scorerEmail} onChange={(e) => setScorerEmail(e.target.value)} style={{ width: "auto" }} />
            <button onClick={async () => { try { await api(`/api/tournaments/${id}`, { addScorer: scorerEmail }); setScorerEmail(""); } catch (e) { setError((e as Error).message); } }}>Add scorer</button>
          </div>
        </div>
      )}
    </main>
  );
}
