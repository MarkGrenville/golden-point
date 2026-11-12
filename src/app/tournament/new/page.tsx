"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TournamentSetupForm, type SetupValues } from "@/components/TournamentSetupForm";
import { api } from "@/lib/client/api";
import { useAuth } from "@/lib/client/auth";
import { listLocal, saveLocal } from "@/lib/client/local-sessions";
import { createTournament, type Tournament } from "@/lib/tournament";
import { randomSeed } from "@/lib/shared/random";

export default function NewTournament() {
  const router = useRouter();
  const { user } = useAuth();
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ReturnType<typeof listLocal>>([]);
  useEffect(() => setSessions(listLocal()), []);

  async function submit(v: SetupValues) {
    setError(null);
    setBusy(true);
    try {
      const rules = { format: v.format, pointsPerMatch: v.pointsPerMatch, rounds: v.rounds, courts: v.courts, minutesPerRound: v.minutesPerRound, lateEntrantsEligibleToWin: v.lateEntrantsEligibleToWin };
      if (online && user) {
        const t = await api<Tournament>("/api/tournaments", { op: "create", input: { name: v.name, rules, participants: v.names.map((name) => ({ name })) } });
        router.push(`/tournament/${t.id}`);
      } else {
        const t = createTournament({ id: `local-${Date.now().toString(36)}`, name: v.name, rules, participants: v.names.map((name) => ({ name, checkedIn: true })), seed: randomSeed(), now: new Date().toISOString(), actor: "local" });
        saveLocal(t);
        router.push(`/tournament/local/${t.id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <main className="stack tournament-setup">
      <p className="eyebrow">The clubhouse / new tournament</p>
      <h1>Get your game on<span className="brand-period">.</span></h1>
      <p className="muted">Americano or Mexicano. Bring your players. We’ll handle the draw.</p>
      {sessions.length > 0 && (
        <div className="card">
          <h2>Continue on this device</h2>
          <ul>{sessions.map((s) => <li key={s.id}><Link href={`/tournament/local/${s.id}`}>{s.name}</Link> <span className="small muted">({s.status}, saved {new Date(s.savedAt).toLocaleString("en-ZA")})</span></li>)}</ul>
        </div>
      )}
      <div className="card">
        <div className="notice info">
          {user ? (
            <label className="inline"><input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} /> Save online — share a live scoreboard, add scorers, and continue on another device.</label>
          ) : (
            <>Saved on this device and recovered after a refresh. Share a live scoreboard without an account.</>
          )}
        </div>
        {error && <div className="notice bad" role="alert">{error}</div>}
        <TournamentSetupForm rememberPlayers onSubmit={submit} busy={busy} submitLabel={online && user ? "Create online session" : "Create on this device"} />
      </div>
    </main>
  );
}
