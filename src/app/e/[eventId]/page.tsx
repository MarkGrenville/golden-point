import { RefreshDate } from "@/components/RefreshDate";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JoinForm } from "@/components/JoinForm";
import { formatRand } from "@/lib/shared/money";
import { formatSast, formatSastTime } from "@/lib/shared/time";
import { publicEvent } from "@/server/public";

export const dynamic = "force-dynamic";

const FORMAT = {
  doubles: "Social doubles",
  americano: "Americano tournament",
  mexicano: "Mexicano tournament",
} as const;
const MODE = {
  organiser_assigns: "Join your group for a social padel session.",
  tournament_pool:
    "Join the tournament pool. Partners rotate each round; with uneven numbers some players rest in a round.",
} as const;

export default async function EventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const e = await publicEvent((await params).eventId);
  if (!e || e.status === "draft") notFound();
  return (
    <main className="wide stack date-page">
      <RefreshDate />
      <p className="small">
        <Link href={`/g/${e.groupSlug}`}>← All dates</Link>
      </p>
      <header className="page-heading"><p className="eyebrow">The clubhouse / {FORMAT[e.format]}</p><h1>{e.title}</h1><p>{e.venue}</p><div className="date-stats"><div><strong>{e.pools.reduce((n, p) => n + p.roster.length, 0).toString().padStart(2, "0")}</strong><span>On the list</span></div><div><strong>{e.pools.reduce((n, p) => n + p.remaining, 0).toString().padStart(2, "0")}</strong><span>Places left</span></div><div><strong>{e.priceCents ? formatRand(e.priceCents) : "Free"}</strong><span>Per player</span></div></div></header>
      <div className="card stack date-details">
        <div>
          <strong>
            {formatSast(new Date(`${e.date}T12:00:00+02:00`), { time: false })}
          </strong>
        </div>
        <div>{e.venue}</div>
        {e.pools.map((p) => (
          <div key={p.id}>
            {p.label !== formatSastTime(new Date(p.startsAt)) && `${p.label}: `}{formatSastTime(new Date(p.startsAt))}–
            {formatSastTime(new Date(p.endsAt))} SAST
          </div>
        ))}
        <div>
          {FORMAT[e.format]} ·{" "}
          {e.priceCents ? `${formatRand(e.priceCents)} per player` : "Free"}
        </div>
        <div className="small muted">{MODE[e.allocationMode]}</div>
        {e.status === "cancelled" && (
          <div className="notice bad">
            This date has been cancelled. Any money owed is settled directly
            with the organiser.
          </div>
        )}
      </div>
      <div className="date-columns">
      <div className="date-join">{e.status !== "cancelled" && <JoinForm event={e} />}</div>
      <div className="date-lists">
      <div className="card">
        <h2>Who&apos;s playing</h2>
        {e.pools.map((p) => (
          <div key={p.id}>
            <h3>{p.label}</h3>
            {p.roster.length === 0 ? (
              <p className="muted small">Nobody yet.</p>
            ) : (
              <ol className="club-roster">
                {p.roster.map((r, i) => (
                  <li key={i}>
                    <span className="roster-number" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span><strong>{r.name}</strong><span className={`badge ${r.paid ? "ok" : "warn"}`}>{r.paid ? "Paid" : "Unpaid"}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
        {(e.waitingCount ?? 0) > 0 && (
          <p className="small muted">{e.waitingCount} on the waiting list.</p>
        )}
      </div>
      <div className="card">
        <h2>Waiting list</h2>
        <ol className="club-roster">
          {e.waiting.map((w, i) => (
            <li key={i}>
              <span className="roster-number" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span><strong>{w.name}</strong><span className={`waiting-status ${w.status === "offered" ? "offered" : ""}`}>
              {w.status === "offered"
                ? "A place is available — open your private waiting link"
                : "Waiting"}</span>
            </li>
          ))}
        </ol>
      </div>
      </div></div>
      {e.paymentLink && (
        <p>
          <a href={e.paymentLink} target="_blank" rel="noreferrer">
            Pay with the organiser’s SnapScan / Zapper link
          </a>{" "}
          · The organiser marks this paid.
        </p>
      )}
      {e.dropOutBefore && (
        <div className="card">
          <h2>Dropping out</h2>
          <p>
            Drop out before {formatSast(new Date(e.dropOutBefore))} SAST. Settle
            any money directly with {e.organiserName}.
          </p>
        </div>
      )}
    </main>
  );
}
