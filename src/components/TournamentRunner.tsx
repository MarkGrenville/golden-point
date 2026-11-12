"use client";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import {
  canChangeRoster,
  computeStandings,
  correctionImpact,
  currentRound,
  generateAmericanoSchedule,
  liveRound,
  previewSchedule,
  setupWarnings,
  standingsCsv,
  toCsv,
  validateScore,
  winners,
  type Match,
  type ParticipantFinancialStatus,
  type Round,
  type Tournament,
  type TournamentAction,
} from "@/lib/tournament";

export type SyncState = "local" | "online" | "saving" | "unsynced" | "error";

export interface RunnerProps {
  tournament: Tournament;
  role: "director" | "scorer";
  sync: SyncState;
  syncLabel?: string;
  syncNotice?: string;
  /** Score drafts not yet confirmed by the server, keyed by match id. */
  unsynced?: Record<string, { scoreA: number; scoreB: number }>;
  dispatch: (action: TournamentAction) => Promise<void>;
  onRetrySync?: () => void;
  shareUrl?: string;
  onShare?: () => void;
  /** Paid-event tournaments record a financial status for walk-ins. */
  fromEvent?: boolean;
  extraTabs?: React.ReactNode;
}

const FIN_LABELS: Record<ParticipantFinancialStatus, string> = {
  paid_online: "Paid online",
  paid_externally: "Paid externally",
  cash_received: "Cash received",
  fee_waived: "Fee waived",
  unpaid_exception: "Unpaid (accepted exception)",
  not_applicable: "—",
};

type Tab = "round" | "standings" | "schedule" | "players" | "share";

export function SyncBadge({ sync, label: customLabel }: { sync: SyncState; label?: string }) {
  const map: Record<SyncState, [string, string]> = {
    local: ["neutral", "Saved on this device only"],
    online: ["ok", "Saved online"],
    saving: ["warn", "Saving…"],
    unsynced: ["bad", "Not synced — scores waiting to upload"],
    error: ["bad", "Not saved — check connection"],
  };
  const [cls, label] = map[sync];
  return <span className={`badge ${cls}`}>{customLabel ?? label}</span>;
}

export function TournamentRunner(props: RunnerProps) {
  const { tournament: t, role, sync, dispatch } = props;
  const [tab, setTab] = useState<Tab>(t.status === "setup" ? "players" : "round");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isDirector = role === "director";
  const name = (id: string) => t.participants.find((p) => p.id === id)?.name ?? "?";

  async function run(action: TournamentAction) {
    setBusy(true);
    setError(null);
    try {
      await dispatch(action);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const activeRound = liveRound(t) ?? currentRound(t);
  return (
    <div className="tournament-board">
      <header className="tournament-hero">
        <div className="hero-heading">
          <div>
            <p className="eyebrow">The clubhouse / {t.rules.format}</p>
            <h1>{t.name}</h1>
            <p className="hero-description">Good games. New partners. Every point counts.</p>
          </div>
          <div className="hero-status">
            <span className="session-status"><span aria-hidden="true" />{t.status === "running" ? "On court" : t.status === "finished" ? "Full time" : "Getting ready"}</span>
            <SyncBadge sync={sync} label={props.syncLabel} />
          </div>
        </div>
        <div className="board-stats">
          <div><strong>{String(activeRound?.number ?? 0).padStart(2, "0")}<small> / {String(t.rules.rounds).padStart(2, "0")}</small></strong><span>Round</span></div>
          <div><strong>{String(t.participants.filter(p => p.active).length).padStart(2, "0")}</strong><span>Players</span></div>
          <div><strong>{String(t.rules.courts).padStart(2, "0")}</strong><span>{t.rules.courts === 1 ? "Court" : "Courts"}</span></div>
          <div><strong>{t.rules.pointsPerMatch}</strong><span>Points per match</span></div>
        </div>
      </header>
      {sync === "unsynced" && (
        <div className="notice bad">
          {props.syncNotice ?? "Some scores are saved on this device only. Other devices cannot see them and the next round cannot be drawn until they upload."}{" "}
          {props.onRetrySync && <button className="secondary" onClick={props.onRetrySync}>Retry upload</button>}
        </div>
      )}
      {error && <div className="notice bad" role="alert">{error}</div>}
      <div className="tabs no-print" role="tablist">
        {(["round", "standings", "schedule", "players", "share"] as Tab[]).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "" : "secondary"} onClick={() => setTab(k)}>
            {{ round: t.status === "setup" ? "Start" : "Current round", standings: "Standings", schedule: "Schedule", players: "Players", share: "Share & export" }[k]}
          </button>
        ))}
      </div>
      {tab === "round" && <RoundTab {...props} run={run} busy={busy} name={name} isDirector={isDirector} />}
      {tab === "standings" && <StandingsTab t={t} />}
      {tab === "schedule" && <ScheduleTab t={t} name={name} />}
      {tab === "players" && <PlayersTab t={t} run={run} busy={busy} isDirector={isDirector} fromEvent={!!props.fromEvent} />}
      {tab === "share" && <ShareTab t={t} shareUrl={props.shareUrl} onShare={props.onShare} />}
      {props.extraTabs}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SetupPanel({ t, run, busy, isDirector }: { t: Tournament; run: (a: TournamentAction) => Promise<void>; busy: boolean; isDirector: boolean }) {
  const active = t.participants.filter((p) => p.active);
  const preview = useMemo(() => {
    if (t.rules.format !== "americano" || active.length < 4) return null;
    const ids = active.map((p) => p.id);
    const rounds = generateAmericanoSchedule({ participantIds: ids, courts: t.rules.courts, rounds: t.rules.rounds, seed: t.seed });
    return previewSchedule(ids, rounds, t.rules);
  }, [t, active]);
  const warnings = setupWarnings(t);
  const unchecked = active.filter((p) => !p.checkedIn);
  return (
    <div className="card stack">
      <h2>Before you start</h2>
      <ul>
        <li>{active.length} players · {t.rules.courts} courts · {t.rules.rounds} rounds · about {t.rules.rounds * t.rules.minutesPerRound} minutes.</li>
        <li>Each match is played to {t.rules.pointsPerMatch} total points (for example {t.rules.pointsPerMatch / 2 + 3}–{t.rules.pointsPerMatch / 2 - 3} or {t.rules.pointsPerMatch / 2}–{t.rules.pointsPerMatch / 2}). Both teammates receive their team&apos;s points.</li>
        <li>Rests award no points. When players have played different numbers of matches, ranking uses points per match, then win rate; unresolved ties are shared.</li>
        <li>{t.rules.lateEntrantsEligibleToWin ? "Late entrants can win." : "Late entrants are provisional and cannot win."} Players who leave keep their results but are marked inactive.</li>
        <li>
          {t.rules.format === "americano"
            ? "Americano: the whole schedule is drawn now, independent of scores, rotating partners."
            : "Mexicano: round 1 is random (or by seeding); each later round groups players by standings and pairs 1st + 4th against 2nd + 3rd. Partners can repeat."}
        </li>
      </ul>
      {warnings.map((w) => <div key={w} className="notice warn">{w}</div>)}
      {preview && (
        <div className="notice info">
          <strong>Schedule preview:</strong> {preview.partnerPairsCovered} of {preview.partnerPairsPossible} possible partnerships covered;{" "}
          {preview.repeatedPartnerPairs} repeated partner pairs, {preview.repeatedOpponentPairs} repeated opponent pairs.
          {preview.warnings.filter((w) => !warnings.includes(w)).map((w) => <div key={w}>• {w}</div>)}
        </div>
      )}
      {unchecked.length > 0 && <div className="notice warn">{unchecked.length} player(s) are not checked in: {unchecked.map((p) => p.name).join(", ")}. Remove absent players on the Players tab before starting.</div>}
      {isDirector && (
        <button className="full" disabled={busy || active.length < 4} onClick={() => run({ type: "start", expectedRevision: t.revision })}>
          Freeze roster and start round 1
        </button>
      )}
    </div>
  );
}

function RoundTab(p: RunnerProps & { run: (a: TournamentAction) => Promise<void>; busy: boolean; name: (id: string) => string; isDirector: boolean }) {
  const { tournament: t, run, busy, name, isDirector } = p;
  if (t.status === "setup") return <SetupPanel t={t} run={run} busy={busy} isDirector={isDirector} />;
  const round = liveRound(t) ?? currentRound(t);
  if (t.status === "finished") return <FinalResults t={t} />;
  if (!round) return <p>No round published.</p>;
  const complete = round.matches.every((m) => m.status !== "scheduled");
  const unsyncedCount = Object.keys(p.unsynced ?? {}).length;
  const moreRounds = t.rules.format === "mexicano" ? round.number < t.rules.rounds : t.rounds.some((r) => r.status === "draft");
  return (
    <div className="round-layout">
    <section className="round-main stack" aria-label="Current matches">
      <div className="round-heading"><div><p className="eyebrow">Let’s play</p><h2>Round {String(round.number).padStart(2, "0")} <span>/ {String(t.rules.rounds).padStart(2, "0")}</span></h2></div><span className="round-count">{round.matches.filter(m => m.status !== "scheduled").length} of {round.matches.length} results in</span></div>
      <div className="round-progress" aria-label={`${round.matches.filter(m => m.status !== "scheduled").length} of ${round.matches.length} results saved`}>{round.matches.map(m => <span key={m.id} className={m.status !== "scheduled" ? "complete" : ""} />)}</div>
      {round.resting.length > 0 && <div className="notice info"><strong>Resting this round:</strong> {round.resting.map(name).join(", ")}</div>}
      <div className="grid2">
        {round.matches.map((m) => (
          <MatchCard key={m.id} t={t} m={m} round={round} name={name} run={run} busy={busy} draft={p.unsynced?.[m.id]} />
        ))}
      </div>
      {isDirector && (
        <div className="card stack no-print round-actions">
          {complete && moreRounds && (
            <button className="full" disabled={busy || unsyncedCount > 0} onClick={() => run({ type: "publish_next", expectedRevision: t.revision })}>
              {t.rules.format === "mexicano" ? "Draw and publish next round from standings" : "Publish next round"}
            </button>
          )}
          {!complete && <p className="muted">Enter every result (or void a match with a reason) to publish the next round.</p>}
          {unsyncedCount > 0 && <p className="muted">Waiting for {unsyncedCount} unsynced score(s) before the next draw.</p>}
          {(complete || !moreRounds) && (
            <button className={moreRounds ? "secondary full" : "full"} disabled={busy} onClick={() => confirm("Finish the tournament and publish final results?") && run({ type: "finish", expectedRevision: t.revision })}>
              Finish tournament
            </button>
          )}
        </div>
      )}
    </section>
    <aside className="standings-preview">
      <div className="standings-heading"><p className="eyebrow">The leaderboard</p><h2>Who’s setting the pace?</h2></div>
      <ol>{computeStandings(t).slice(0, 8).map(r => <li key={r.participantId} className={r.rank === 1 && r.played > 0 ? "leading" : undefined}><span className="standing-rank">{r.tied ? "=" : ""}{String(r.rank).padStart(2, "0")}</span><span className="standing-name">{r.name}<small>{r.played} played · {r.wins} won</small></span><strong>{r.points}<small>pts</small></strong></li>)}</ol>
      <p className="small muted">Every point goes to both teammates. Follow the full table in Standings.</p>
    </aside>
    </div>
  );
}

function MatchCard({ t, m, round, name, run, busy, draft }: { t: Tournament; m: Match; round: Round; name: (id: string) => string; run: (a: TournamentAction) => Promise<void>; busy: boolean; draft?: { scoreA: number; scoreB: number } }) {
  const [a, setA] = useState(String(draft?.scoreA ?? m.result?.scoreA ?? ""));
  const [b, setB] = useState(String(draft?.scoreB ?? m.result?.scoreB ?? ""));
  const [editing, setEditing] = useState(m.status === "scheduled");
  const total = t.rules.pointsPerMatch;
  const check = validateScore(t.rules, a === "" ? NaN : Number(a), b === "" ? NaN : Number(b));
  const impact = m.status !== "scheduled" ? correctionImpact(t, m.id) : null;

  function onA(v: string) {
    setA(v);
    const n = Number(v);
    if (v !== "" && Number.isInteger(n) && n >= 0 && n <= total) setB(String(total - n));
  }

  async function save() {
    if (!check.ok) return;
    await run({ type: "result", matchId: m.id, expectedMatchRevision: m.revision, scoreA: Number(a), scoreB: Number(b) });
    setEditing(false);
  }

  return (
    <div className={`match ${m.status !== "scheduled" ? "done" : ""}`}>
      <div className="row">
        <span className="court grow">Court <strong>{String(m.court).padStart(2, "0")}</strong></span>
        {draft ? <span className="badge bad">Not synced</span> : m.status === "completed" ? <span className="badge ok">Result saved</span> : m.status === "void" ? <span className="badge neutral">Void</span> : <span className="badge warn">To play</span>}
      </div>
      <div className="teams">
        <span><small>Team A</small>{name(m.teamA[0])}<br />{name(m.teamA[1])}</span>
        <span className="vs">vs</span>
        <span style={{ textAlign: "right" }}><small>Team B</small>{name(m.teamB[0])}<br />{name(m.teamB[1])}</span>
      </div>
      {m.status === "void" && <p className="muted small">Void: {m.voidReason}</p>}
      {!editing && m.result && <div className="scoreline">{m.result.scoreA} – {m.result.scoreB}</div>}
      {editing && round.status !== "draft" && (
        <div className="stack">
          <div className="score-input">
            <input inputMode="numeric" aria-label="Team A points" placeholder="00" value={a} onChange={(e) => onA(e.target.value)} />
            <span aria-hidden="true">:</span>
            <input inputMode="numeric" aria-label="Team B points" placeholder="00" value={b} onChange={(e) => setB(e.target.value)} />
          </div>
          {!check.ok && a !== "" && <p className="small" role="alert">{check.error}</p>}
          <button className="full" disabled={busy || !check.ok} onClick={save}>Save score</button>
          {m.status === "scheduled" && (
            <button className="secondary full" disabled={busy} onClick={() => {
              const reason = prompt("Why is this match void (abandoned, injury…)?");
              if (reason && reason.trim().length >= 3) run({ type: "void", matchId: m.id, expectedMatchRevision: m.revision, reason });
            }}>Void match</button>
          )}
        </div>
      )}
      {!editing && m.status !== "scheduled" && (
        <div className="no-print">
          {impact && <p className="small muted">{impact.message}</p>}
          <button className="secondary" onClick={() => setEditing(true)}>Correct result</button>
        </div>
      )}
    </div>
  );
}

function StandingsTable({ t }: { t: Tournament }) {
  const rows = computeStandings(t);
  return (
    <table className="standings-table">
      <thead>
        <tr><th>#</th><th>Player</th><th className="num">Pts</th><th className="num">Played</th><th className="num">W</th><th className="num">Rests</th><th className="num">Pts/match</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.participantId}>
            <td>{r.tied ? `=${r.rank}` : r.rank}</td>
            <td>
              {r.name}
              {!r.active && <span className="badge neutral small"> left</span>}
              {!r.eligible && r.active && <span className="badge neutral small"> provisional</span>}
            </td>
            <td className="num">{r.points}</td>
            <td className="num">{r.played}</td>
            <td className="num">{r.wins}</td>
            <td className="num">{r.rests}</td>
            <td className="num">{r.pointsPerMatch.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StandingsTab({ t }: { t: Tournament }) {
  return (
    <div className="card">
      <StandingsTable t={t} />
      <p className="small muted">“=” marks a shared position. Provisional players joined late and are not eligible to win under the published rules.</p>
    </div>
  );
}

function FinalResults({ t }: { t: Tournament }) {
  const w = winners(computeStandings(t));
  return (
    <div className="card stack">
      <h2>Final results</h2>
      {w.length > 0 && <div className="notice ok"><strong>{w.length > 1 ? "Joint winners" : "Winner"}:</strong> {w.map((r) => r.name).join(", ")}</div>}
      <StandingsTable t={t} />
    </div>
  );
}

function ScheduleTab({ t, name }: { t: Tournament; name: (id: string) => string }) {
  return (
    <div className="stack">
      {t.rounds.length === 0 && <p className="muted">The schedule is drawn when the tournament starts.</p>}
      {t.rounds.map((r) => (
        <div key={r.number} className="card">
          <h3>Round {r.number} <span className="badge neutral">{r.status === "draft" ? "Not yet published" : r.status}</span></h3>
          <table>
            <tbody>
              {r.matches.map((m) => (
                <tr key={m.id}>
                  <td>Court {m.court}</td>
                  <td>{name(m.teamA[0])} &amp; {name(m.teamA[1])}</td>
                  <td className="num">{m.result ? `${m.result.scoreA} – ${m.result.scoreB}` : m.status === "void" ? "void" : ""}</td>
                  <td>{name(m.teamB[0])} &amp; {name(m.teamB[1])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.resting.length > 0 && <p className="small muted">Resting: {r.resting.map(name).join(", ")}</p>}
        </div>
      ))}
      {t.rules.format === "mexicano" && t.status === "running" && <p className="muted small">Mexicano rounds are drawn one at a time from the standings.</p>}
    </div>
  );
}

function PlayersTab({ t, run, busy, isDirector, fromEvent }: { t: Tournament; run: (a: TournamentAction) => Promise<void>; busy: boolean; isDirector: boolean; fromEvent: boolean }) {
  const [newName, setNewName] = useState("");
  const [fin, setFin] = useState<ParticipantFinancialStatus>(fromEvent ? "paid_externally" : "not_applicable");
  const changeable = canChangeRoster(t);
  return (
    <div className="card stack">
      <table>
        <thead><tr><th>Player</th><th>Status</th>{fromEvent && <th>Payment</th>}<th /></tr></thead>
        <tbody>
          {t.participants.map((p) => (
            <tr key={p.id}>
              <td>{p.name}{p.joinedRound > 1 && <span className="small muted"> (from round {p.joinedRound})</span>}</td>
              <td>{!p.active ? <span className="badge neutral">Left</span> : p.checkedIn ? <span className="badge ok">Checked in</span> : <span className="badge warn">Not checked in</span>}</td>
              {fromEvent && <td className="small">{FIN_LABELS[p.financialStatus]}</td>}
              <td>
                {isDirector && p.active && t.status === "setup" && (
                  <button className="secondary" disabled={busy} onClick={() => run({ type: "check_in", participantId: p.id, checkedIn: !p.checkedIn })}>
                    {p.checkedIn ? "Undo" : "Check in"}
                  </button>
                )}{" "}
                {isDirector && p.active && changeable && (
                  <button className="secondary" disabled={busy} onClick={() => confirm(`Remove ${p.name}? Their results are kept.`) && run({ type: "withdraw_player", participantId: p.id, expectedRevision: t.revision })}>
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {isDirector && t.status !== "finished" && (
        changeable ? (
          <div className="stack">
            <h3>{t.status === "setup" ? "Add player" : "Add late arrival"}</h3>
            {t.status === "running" && <p className="small muted">The remaining schedule will be redrawn; completed matches are kept.</p>}
            <input placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            {fromEvent && (
              <select value={fin} onChange={(e) => setFin(e.target.value as ParticipantFinancialStatus)} aria-label="Payment status">
                <option value="paid_externally">Paid externally</option>
                <option value="cash_received">Cash received</option>
                <option value="fee_waived">Fee waived</option>
                <option value="unpaid_exception">Unpaid — accepted exception</option>
              </select>
            )}
            <button disabled={busy || !newName.trim()} onClick={async () => { await run({ type: "add_player", name: newName, financialStatus: fin, expectedRevision: t.revision }); setNewName(""); }}>
              Add
            </button>
          </div>
        ) : (
          <p className="muted small">Players can be added or removed between rounds, once every result in the current round is in and before the next round starts.</p>
        )
      )}
    </div>
  );
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ShareTab({ t, shareUrl, onShare }: { t: Tournament; shareUrl?: string; onShare?: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (shareUrl) QRCode.toDataURL(shareUrl, { margin: 1, width: 240 }).then(setQr);
  }, [shareUrl]);
  const text = shareText(t, shareUrl);
  const slug = t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <div className="card stack">
      {shareUrl ? (
        <>
          <h3>Live scoreboard (read-only)</h3>
          <p><a href={shareUrl}>{shareUrl}</a></p>
          {qr && <img src={qr} alt="QR code for the live scoreboard" width={240} height={240} />}
        </>
      ) : (
        <div className="notice info">Share scores live while keeping the organiser controls on this phone. No account needed. {onShare && <button onClick={onShare}>Share live scoreboard</button>}</div>
      )}
      <h3>Message to share</h3>
      <pre className="share">{text}</pre>
      <div className="row">
        <button onClick={() => navigator.clipboard.writeText(text)}>Copy message</button>
        <a className="button secondary" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Share to WhatsApp</a>
      </div>
      <h3>Export</h3>
      <div className="row">
        <button className="secondary" onClick={() => download(`${slug}-fixtures.csv`, toCsv(t))}>Fixtures &amp; results CSV</button>
        <button className="secondary" onClick={() => download(`${slug}-standings.csv`, standingsCsv(t))}>Standings CSV</button>
        <button className="secondary" onClick={() => window.print()}>Print</button>
      </div>
    </div>
  );
}

function shareText(t: Tournament, url?: string): string {
  const stamp = new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" }).format(new Date());
  const name = (id: string) => t.participants.find((p) => p.id === id)?.name ?? "?";
  const lines = [`${t.name} — ${t.status === "finished" ? "final standings" : "standings"} (${stamp} SAST)`];
  for (const r of computeStandings(t).slice(0, 32)) lines.push(`${r.tied ? "=" : ""}${r.rank}. ${r.name} — ${r.points} pts (${r.played} played)`);
  const live = liveRound(t);
  if (t.status === "running" && live) {
    lines.push("", `Round ${live.number}:`);
    for (const m of live.matches) lines.push(`Court ${m.court}: ${name(m.teamA[0])} & ${name(m.teamA[1])} vs ${name(m.teamB[0])} & ${name(m.teamB[1])}`);
    if (live.resting.length) lines.push(`Resting: ${live.resting.map(name).join(", ")}`);
  }
  if (url) lines.push("", `Live: ${url}`);
  return lines.join("\n");
}
