"use client";
import { useEffect, useState } from "react";
import { MAX_COURTS, type PointsPerMatch, type TournamentFormat } from "@/lib/tournament";

import { useAuth } from "@/lib/client/auth";
import { api } from "@/lib/client/api";
import { goldenPointStorage } from "@/lib/client/storage";
import { SignInOffer } from "./SignInOffer";

export interface SetupValues {
  name: string;
  format: TournamentFormat;
  pointsPerMatch: PointsPerMatch;
  courts: number;
  rounds: number;
  minutesPerRound: number;
  lateEntrantsEligibleToWin: boolean;
  names: string[];
}

/** Suggested rounds: Americano aims for everyone partnering once where feasible. */
export function suggestedRounds(players: number, format: TournamentFormat): number {
  if (players < 4) return 1;
  if (format === "mexicano") return Math.min(10, Math.max(4, Math.ceil(players / 2)));
  return Math.min(15, players % 4 === 0 ? players - 1 : players);
}

/** baseCount: players added elsewhere (e.g. imported paid registrations) who also play. */
export function TournamentSetupForm({ initialNames = [], baseCount = 0, rememberPlayers = false, onSubmit, busy, submitLabel }: { initialNames?: string[]; baseCount?: number; rememberPlayers?: boolean; onSubmit: (v: SetupValues) => void; busy?: boolean; submitLabel: string }) {
  const { user } = useAuth();
  const [saved, setSaved] = useState<string[]>([]);
  const [saveMessage, setSaveMessage] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [name, setName] = useState("Golden Point Americano");
  const [format, setFormat] = useState<TournamentFormat>("americano");
  const [points, setPoints] = useState<PointsPerMatch>(24);
  const [namesText, setNamesText] = useState(initialNames.join("\n"));
  const names = namesText.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
  const total = names.length + baseCount;
  const maxCourts = Math.max(1, Math.min(MAX_COURTS, Math.floor(total / 4)));
  const [courts, setCourts] = useState<number | null>(null);
  const [rounds, setRounds] = useState<number | null>(null);
  const [minutes, setMinutes] = useState(15);
  const [lateEligible, setLateEligible] = useState(false);
  const c = Math.min(courts ?? maxCourts, maxCourts);
  const r = rounds ?? suggestedRounds(total, format);
  const resting = Math.max(0, total - c * 4);
  const tooFew = total < 4;
  const tooMany = total > 32;

  useEffect(() => {
    if (!rememberPlayers) return;
    const draft = goldenPointStorage().getItem("golden-point.players.draft");
    if (draft !== null) setNamesText(draft);
    setDraftReady(true);
  }, [rememberPlayers]);
  useEffect(() => {
    if (rememberPlayers && draftReady) goldenPointStorage().setItem("golden-point.players.draft", namesText);
  }, [namesText, rememberPlayers, draftReady]);
  useEffect(() => {
    setSaved([]);
    if (!rememberPlayers || !user) return;
    let active = true;
    async function load() {
      if (goldenPointStorage().getItem("golden-point.players.save-after-signin")) {
        const draft = goldenPointStorage().getItem("golden-point.players.draft") ?? "";
        const names = draft.split(/\n|,/).map(s => s.trim()).filter(Boolean);
        await api("/api/me", { op: "players.save", names });
        goldenPointStorage().removeItem("golden-point.players.save-after-signin");
        if (active) setSaveMessage("Players saved for next week.");
      }
      const result = await api<{ names: string[] }>("/api/me", { op: "players" });
      if (active) setSaved(result.names);
    }
    load().catch(e => { if (active) setSaveMessage(e.message); });
    return () => { active = false; };
  }, [rememberPlayers, user]);

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); onSubmit({ name, format, pointsPerMatch: points, courts: c, rounds: r, minutesPerRound: minutes, lateEntrantsEligibleToWin: lateEligible, names }); }}>
      <label htmlFor="tname">Tournament name</label>
      <input id="tname" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
      <label>Format</label>
      <div className="row">
        <label className="inline"><input type="radio" checked={format === "americano"} onChange={() => { setFormat("americano"); if (name === "Golden Point Mexicano") setName("Golden Point Americano"); }} /> Americano — rotating partners, fixed schedule</label>
        <label className="inline"><input type="radio" checked={format === "mexicano"} onChange={() => { setFormat("mexicano"); if (name === "Golden Point Americano") setName("Golden Point Mexicano"); }} /> Mexicano — rounds drawn from standings</label>
      </div>
      <label htmlFor="names">{baseCount ? `Additional players (${baseCount} already included)` : "Players (one per line, 4–32)"}</label>
      {rememberPlayers && user && saved.length > 0 && <div className="row"><span className="small">{saved.length} saved players</span><button type="button" className="secondary" onClick={() => setNamesText(saved.join("\n"))}>Use saved players</button></div>}
      <textarea id="names" rows={8} value={namesText} onChange={(e) => setNamesText(e.target.value)} placeholder={"Thandi\nJames\nPriya\nSipho"} />
      <p className={`small ${tooFew || tooMany ? "" : "muted"}`} role="status">{total} player{total === 1 ? "" : "s"}{tooFew ? " — at least 4 needed" : tooMany ? " — at most 32" : ""}</p>
      <div className="grid2">
        <div>
          <label htmlFor="courts">Courts</label>
          <select id="courts" value={c} onChange={(e) => setCourts(Number(e.target.value))}>
            {Array.from({ length: maxCourts }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="rounds">Rounds</label>
          <input id="rounds" type="number" min={1} max={40} value={r} onChange={(e) => setRounds(Number(e.target.value))} />
        </div>
        <div>
          <label htmlFor="points">Points per match</label>
          <select id="points" value={points} onChange={(e) => setPoints(Number(e.target.value) as PointsPerMatch)}>
            <option value={16}>16</option><option value={24}>24 (default)</option><option value={32}>32</option>
          </select>
        </div>
        <div>
          <label htmlFor="minutes">Minutes per round</label>
          <input id="minutes" type="number" min={5} max={60} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        </div>
      </div>
      <label className="inline"><input type="checkbox" checked={lateEligible} onChange={(e) => setLateEligible(e.target.checked)} /> Late entrants can win</label>
      {!tooFew && (
        <div className="notice info">
          {c} court{c === 1 ? "" : "s"}, {resting ? `${resting} player${resting === 1 ? "" : "s"} rest each round` : "nobody rests"}, about {r * minutes} minutes.
        </div>
      )}
      <button className="full" disabled={busy || tooFew || tooMany}>{submitLabel}</button>
      {rememberPlayers && user && names.length > 0 && <button type="button" className="secondary full" onClick={async () => {
        try {
          const result = await api<{ names: string[] }>("/api/me", { op: "players.save", names });
          setSaved(result.names); setSaveMessage("Players saved for next week.");
        } catch (e) { setSaveMessage((e as Error).message); }
      }}>Save these players for next week</button>}
      {saveMessage && <p role="status" className="small">{saveMessage}</p>}
      {rememberPlayers && names.length > 0 && <SignInOffer message="Want to keep these for next week?" next="/tournament/new" onSignIn={() => goldenPointStorage().setItem("golden-point.players.save-after-signin", "yes")} />}
    </form>
  );
}
