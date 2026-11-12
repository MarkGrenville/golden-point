"use client";
import { useEffect, useState } from "react";
import { PageHeading } from "@/components/PageHeading";
import { goldenPointStorage } from "@/lib/client/storage";
import { randomSeed } from "@/lib/shared/random";
import { pairSocialRound, type SocialDraw, type SocialMode } from "@/lib/tournament/social";

const STORAGE_KEY = "golden-point.social-round";

export default function MatchUsUp() {
  const [namesText, setNamesText] = useState("");
  const [mode, setMode] = useState<SocialMode>("random");
  const [courts, setCourts] = useState<number | null>(null);
  const [seed, setSeed] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const names = namesText.split(/\n|,/).map(name => name.trim()).filter(Boolean);
  const maxCourts = Math.max(1, Math.min(8, Math.floor(names.length / 4)));
  const courtCount = Math.min(courts ?? maxCourts, maxCourts);
  let draw: SocialDraw | null = null;
  let error = "";
  try {
    const result = pairSocialRound(names, courtCount, mode, seed ?? 0);
    if (seed !== null) draw = result;
  } catch (e) { error = (e as Error).message; }

  useEffect(() => {
    try {
      const saved = JSON.parse(goldenPointStorage().getItem(STORAGE_KEY) ?? "null");
      if (saved && typeof saved.namesText === "string" && ["random", "balanced"].includes(saved.mode) &&
          (saved.courts === null || (Number.isInteger(saved.courts) && saved.courts >= 1 && saved.courts <= 8)) &&
          (saved.seed === null || Number.isInteger(saved.seed))) {
        setNamesText(saved.namesText); setMode(saved.mode); setCourts(saved.courts); setSeed(saved.seed);
      }
    } catch { setStorageFailed(true); }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { goldenPointStorage().setItem(STORAGE_KEY, JSON.stringify({ namesText, mode, courts, seed })); }
    catch { setStorageFailed(true); }
  }, [ready, namesText, mode, courts, seed]);

  return <main className="stack">
    <PageHeading eyebrow="Social round" title="Match us up.">
      <p>Names in. Pairs out. A social game, ready to play — free, no account needed.</p>
    </PageHeading>
    <form className="card stack" onSubmit={e => { e.preventDefault(); if (!error) setSeed(randomSeed()); }}>
      <label htmlFor="social-names">Players (one per line or comma, 4–32)</label>
      <textarea id="social-names" rows={8} maxLength={2600} value={namesText} onChange={e => { setNamesText(e.target.value); setSeed(null); }} placeholder={"Lumi\nZola\nKavi\nMiro"} disabled={!ready} />
      <p className="small muted">{names.length} players. Use an initial if two players share a name.</p>
      <label htmlFor="social-mode">Pairing</label>
      <select id="social-mode" value={mode} onChange={e => { setMode(e.target.value as SocialMode); setSeed(null); }}>
        <option value="random">Random — mix everyone up</option>
        <option value="balanced">Balanced — use strength order</option>
      </select>
      {mode === "balanced" && <p className="notice info">List names from strongest to newest. We group nearby levels and mix stronger with weaker partners to keep teams close. Shuffle draws fresh partners, courts and anyone sitting out.</p>}
      <label htmlFor="social-courts">Courts available</label>
      <select id="social-courts" value={courtCount} onChange={e => { setCourts(Number(e.target.value)); setSeed(null); }}>
        {Array.from({ length: maxCourts }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
      </select>
      <p className="small muted">{Math.max(0, names.length - courtCount * 4)} sitting out. Each shuffle draws rests at random.</p>
      {names.length > 0 && error && <p role="status" className="notice warn">{error}</p>}
      <button className="full" disabled={!ready || !!error}>{draw ? "Shuffle again" : "Match us up"}</button>
    </form>
    {draw && <section aria-label="Your social round" aria-live="polite" className="stack social-draw">
      <h2>You’re up. Game on.</h2>
      {draw.matches.map(match => <article className="match" key={match.court}>
        <h3 className="court">Court {match.court}</h3>
        <div className="teams"><div>{match.teamA.map(name => <span key={name}>{name}</span>)}</div><span className="vs">vs</span><div>{match.teamB.map(name => <span key={name}>{name}</span>)}</div></div>
      </article>)}
      <div className="notice info"><strong>Sitting out: </strong>{draw.resting.length ? draw.resting.join(", ") : "Nobody — everyone’s on court."}</div>
    </section>}
    <p className="small muted" role="status">{storageFailed ? "Device saving is unavailable. Keep this page open to keep your draw." : "Names and draw stay on this device. Come back any time."}</p>
  </main>;
}
