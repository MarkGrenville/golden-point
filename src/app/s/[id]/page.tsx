"use client";
import { doc, onSnapshot } from "firebase/firestore";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { clientDb } from "@/lib/client/firebase";
import type { Scoreboard } from "@/lib/tournament";

/** Read-only live scoreboard for spectators (names and results only). */
export default function ScoreboardPage() {
  const { id } = useParams<{ id: string }>();
  const [board, setBoard] = useState<Scoreboard | null | undefined>(undefined);
  useEffect(() => onSnapshot(doc(clientDb(), `publicScoreboards/${id}`), (s) => setBoard((s.data() as Scoreboard) ?? null), () => setBoard(null)), [id]);
  if (board === undefined) return <main><p>Loading…</p></main>;
  if (board === null) return <main><p>Scoreboard not found.</p></main>;
  const live = [...board.rounds].reverse().find((r) => r.status === "published") ?? board.rounds.at(-1);
  return (
    <main className="wide stack tournament-board live-scoreboard">
      <header className="page-heading"><div className="live-heading-row"><p className="eyebrow">The clubhouse / live scoreboard</p><span className="session-status"><span aria-hidden="true" />{board.status === "finished" ? "Full time" : board.status === "setup" ? "Getting ready" : "On court"}</span></div><h1>{board.name}</h1>
      <p className="muted small">
        {board.rules.format === "americano" ? "Americano" : "Mexicano"} · {board.rules.pointsPerMatch} points · {board.status === "finished" ? "Final results" : board.status === "setup" ? "Not started" : `Round ${live?.number ?? "–"} of ${board.rules.rounds}`} · updated{" "}
        {new Date(board.updatedAt).toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg" })}
      </p></header>
      {live && board.status === "running" && (
        <div className="grid2">
          {live.matches.map((m) => (
            <div key={m.id} className={`match ${m.status !== "scheduled" ? "done" : ""}`}>
              <div className="court">Court <strong>{String(m.court).padStart(2, "0")}</strong></div>
              <div className="teams"><span><small>Team A</small>{m.teamA[0]}<br />{m.teamA[1]}</span><span className="vs">vs</span><span style={{ textAlign: "right" }}><small>Team B</small>{m.teamB[0]}<br />{m.teamB[1]}</span></div>
              <div className={`scoreline ${m.status !== "completed" ? "score-pending" : ""}`}>{m.status === "completed" ? `${m.scoreA} – ${m.scoreB}` : m.status === "void" ? "Void" : "In play"}</div>
            </div>
          ))}
          {live.resting.length > 0 && <div className="notice info">Resting: {live.resting.join(", ")}</div>}
        </div>
      )}
      <div className="card">
        <h2>Standings</h2>
        <table className="standings-table">
          <thead><tr><th>#</th><th>Player</th><th className="num">Pts</th><th className="num">Played</th><th className="num">W</th><th className="num">Pts/match</th></tr></thead>
          <tbody>
            {board.standings.map((r) => (
              <tr key={r.name + r.rank}>
                <td>{r.tied ? `=${r.rank}` : r.rank}</td>
                <td>{r.name}{!r.active ? " (left)" : !r.eligible ? " (provisional)" : ""}</td>
                <td className="num">{r.points}</td><td className="num">{r.played}</td><td className="num">{r.wins}</td><td className="num">{r.pointsPerMatch.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
