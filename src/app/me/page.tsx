"use client";
import { PageHeading } from "@/components/PageHeading";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SignInOffer } from "@/components/SignInOffer";
import { listLocal } from "@/lib/client/local-sessions";
import { AttendanceBadge, PaymentBadge } from "@/components/Status";
import type { PublicEvent } from "@/lib/booking/projection";
import type { Registration } from "@/lib/booking/types";
import { api } from "@/lib/client/api";
import { signOutUser, useAuth } from "@/lib/client/auth";
import { formatRand } from "@/lib/shared/money";
import { formatSast } from "@/lib/shared/time";

export default function Me() {
  const { user, ready } = useAuth();
  const [data, setData] = useState<{
    registrations: Registration[];
    events: PublicEvent[];
  } | null>(null);
  const [notes, setNotes] = useState<
    {
      id: string;
      title: string;
      body: string;
      url: string;
      createdAt: string;
    }[]
  >([]);
  const [tournaments, setTournaments] = useState<
    { id: string; name: string; status: string }[]
  >([]);
  const [localSessions, setLocalSessions] = useState<ReturnType<typeof listLocal>>([]);
  useEffect(() => setLocalSessions(listLocal()), []);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const claim = await api<{ claimed: number }>("/api/me", {
      op: "claim",
    }).catch(() => ({ claimed: 0 }));
    if (claim.claimed)
      setMsg(`Linked ${claim.claimed} booking(s) made with ${user?.email}.`);
    setData(await api("/api/me", { op: "bookings" }));
    setNotes(await api("/api/me", { op: "notifications" }));
    setTournaments(await api("/api/me", { op: "tournaments" }));
  }, [user]);

  useEffect(() => {
    if (user) load().catch((e) => setMsg(e.message));
  }, [user, load]);

  if (!ready)
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  if (!user)
    return (
      <main className="stack">
        <PageHeading eyebrow="Your padel" title="My bookings" />
        <p>Use the private link you received when joining to check your place or drop out. Your organiser’s shared link shows the player list.</p>
        <Link className="button full" href="/date/new">Create a weekly date</Link>
        {localSessions.length > 0 && <div className="card"><h2>On this device</h2><ul>{localSessions.map(s => <li key={s.id}><Link href={`/tournament/local/${s.id}`}>{s.name}</Link></li>)}</ul></div>}
        <SignInOffer message="Want your bookings together on any device?" action="Sign in with the email you booked with." next="/me" />
      </main>
    );

  async function withdrawFrom(r: Registration) {
    if (
      !confirm(
        "Withdraw from this date? This releases your place to the waiting list.",
      )
    )
      return;
    try {
      const outcome = await api<{ message: string }>(
        `/api/bookings/${r.id}/withdraw`,
        {},
      );
      setMsg("Dropped out. Any money owed is settled with the organiser.");
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  const eventOf = (id: string) => data?.events.find((e) => e.id === id);
  return (
    <main className="stack">
      <div className="row">
        <div className="grow"><PageHeading eyebrow="Your padel" title="My bookings" /></div>
        <button className="secondary" onClick={() => signOutUser()}>
          Sign out
        </button>
      </div>
      <p className="muted small">
        Signed in as {user.email}
        {user.emailVerified
          ? ""
          : " (unverified — use an email link or Google to claim bookings)"}
      </p>
      {msg && <div className="notice info">{msg}</div>}
      {notes.length > 0 && (
        <div className="card">
          <h2>Notifications</h2>
          <ul>
            {notes.map((n) => (
              <li key={n.id}>
                <Link href={n.url}>{n.title}</Link>{" "}
                <span className="small muted">{n.body}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data?.registrations.length === 0 && (
        <p>No bookings linked to {user.email} yet.</p>
      )}
      {data?.registrations.map((r) => {
        const e = eventOf(r.eventId);
        const pool = e?.pools.find((p) => p.id === r.poolId);
        return (
          <div key={r.id} className="card stack">
            <strong>{e?.title ?? r.eventId}</strong>
            {pool && (
              <span>
                {formatSast(new Date(pool.startsAt))} –{" "}
                {formatSast(new Date(pool.endsAt)).split(", ")[1]} · {e?.venue}
              </span>
            )}
            <div className="row">
              <AttendanceBadge
                s={r.attendance}
                awaitingEvent={e ? !e.eventConfirmed : false}
              />
              <PaymentBadge s={r.payment} />
            </div>
            <span className="small muted">
              {formatRand(r.amountCents)} · booked as {r.displayName}
              {r.alias ? ` (shown as ${r.alias})` : ""}
            </span>
            {(r.attendance === "active" || r.attendance === "held") && (
              <button className="secondary" onClick={() => withdrawFrom(r)}>
                I can&apos;t attend — withdraw
              </button>
            )}
          </div>
        );
      })}
      {tournaments.length > 0 && (
        <div className="card">
          <h2>My tournaments</h2>
          <ul>
            {tournaments.map((t) => (
              <li key={t.id}>
                <Link href={`/tournament/${t.id}`}>{t.name}</Link>{" "}
                <span className="small muted">({t.status})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
