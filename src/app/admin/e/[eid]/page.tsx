"use client";
import { PageHeading } from "@/components/PageHeading";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { SignInOffer } from "@/components/SignInOffer";
import { goldenPointStorage } from "@/lib/client/storage";
import { useAuth } from "@/lib/client/auth";
import {
  fromLocalInput,
  toLocalInput,
} from "@/components/admin-utils";
import type {
  EventDate,
  Registration,
  WaitlistEntry,
} from "@/lib/booking/types";
import { TournamentSetupForm } from "@/components/TournamentSetupForm";
import type { Tournament } from "@/lib/tournament";
import { admin as signedInAdmin, api } from "@/lib/client/api";
import { formatRand } from "@/lib/shared/money";

function DateAdmin() {
  const admin = useCallback(<T,>(op: string, args: Record<string, unknown> = {}) => {
    const guestToken = window.location.hash.slice(1);
    return signedInAdmin<T>(op, { ...args, ...(guestToken ? { guestToken } : {}) });
  }, []);
  const { ready, user } = useAuth();
  const [privateLink, setPrivateLink] = useState("");
  const [savedDate, setSavedDate] = useState(false);
  const [savingDate, setSavingDate] = useState(false);
  const router = useRouter();
  const { eid } = useParams<{ eid: string }>();
  const [data, setData] = useState<{
    event: EventDate;
    organiserName: string;
    registrations: Registration[];
    waitlist: WaitlistEntry[];
    publishProblems: string[];
  } | null>(null);
  const [error, setError] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const load = useCallback(
    () =>
      admin<typeof data>("event.dashboard", { eventId: eid })
        .then(setData)
        .catch((e) => setError(e.message)),
    [eid, admin],
  );
  useEffect(() => {
    if (!ready) return;
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load, ready]);
  useEffect(() => {
    setPrivateLink(window.location.pathname + window.location.hash);
  }, []);
  const saveDate = useCallback(async () => {
    setSavingDate(true);
    try {
      await api(`/api/dates/${eid}/claim`, { token: window.location.hash.slice(1) });
      goldenPointStorage().removeItem(`golden-point.date.save.${eid}`);
      setSavedDate(true);
    } catch (e) { setError((e as Error).message); }
    finally { setSavingDate(false); }
  }, [eid]);
  useEffect(() => {
    if (user && goldenPointStorage().getItem(`golden-point.date.save.${eid}`)) void saveDate();
  }, [user, eid, saveDate]);
  async function act(op: string, args: Record<string, unknown> = {}) {
    try {
      setError("");
      await admin(op, { eventId: eid, ...args });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!data) return <main>{error || "Loading…"}</main>;
  const e = data.event;
  return (
    <main className="stack">
      <PageHeading eyebrow="Manage your date" title={e.title} />
      <div className="card stack">
        <h2>Invite your players</h2>
        <Link href={`/e/${eid}`}>Open shared date and player list</Link>
        <button onClick={async () => {
          try { await navigator.clipboard.writeText(`${window.location.origin}/e/${eid}`); setShareMessage("Player link copied."); }
          catch { setShareMessage(`Share ${window.location.origin}/e/${eid}`); }
        }}>Copy player link</button>
        <p className="small muted">Keep this organiser page private. Bookmark it to tick payments and settle money later.</p>
        <button className="secondary" onClick={async () => {
          try { await navigator.clipboard.writeText(window.location.href); setShareMessage("Private organiser link copied. Keep it safe."); }
          catch { setShareMessage("Bookmark this page to keep your private organiser link."); }
        }}>Copy private organiser link</button>
        {shareMessage && <p role="status">{shareMessage}</p>}
      </div>
      {error && (
        <p className="notice bad" role="alert">
          {error}
        </p>
      )}
      <div className="card stack">
        <h2>Date settings</h2>
        {process.env.NODE_ENV === "development" && e.devSandbox && <p className="notice warn">DEV ONLY — This date uses PayFast’s public sandbox. No real money; return confirmation is simulated locally.</p>}
        <p>
          {e.status} · {e.venue} · {formatRand(e.priceCents)} per player
        </p>
        <label>
          Drop out before (SAST, optional)
          <input
            type="datetime-local"
            defaultValue={toLocalInput(e.dropOutBefore)}
            onChange={(x) => {
              act("event.update", {
                patch: {
                  dropOutBefore: x.target.value
                    ? fromLocalInput(x.target.value)
                    : null,
                },
              });
            }}
          />
        </label>
        {e.status === "draft" && (
          <>
            <p>{data.publishProblems.join(" ")}</p>
            <button onClick={() => act("event.publish")}>Publish date</button>
          </>
        )}
        {e.status !== "cancelled" && (
          <button
            className="danger"
            onClick={() =>
              act("event.cancel", { reason: "Cancelled by the organiser" })
            }
          >
            Cancel date
          </button>
        )}
        {e.status === "cancelled" && (
          <p className="notice warn">
            Cancelled. Settle any money below in person.
          </p>
        )}
      </div>
      <div className="card stack">
        <h2>Players and payments</h2>
        {data.registrations.map((r) => (
          <div key={r.id} className="card stack organiser-player">
            <div><strong>{r.displayName}</strong></div>
            <div>
              {r.attendance} · {r.payment.replaceAll("_", " ")}
            </div>
            {r.settlement === "due" && (
              <>
                <span>
                  {formatRand(r.settlementCents ?? r.amountCents)} to settle
                  with {data.organiserName}
                </span>
                <button
                  onClick={() =>
                    act("registration.settle", { registrationId: r.id })
                  }
                >
                  Mark settled
                </button>
              </>
            )}
            {r.settlement === "settled" && (
              <span className="badge ok">Settled</span>
            )}
            {r.payment === "unpaid" && r.attendance === "active" && (
              <div className="row">
                <button
                  onClick={() =>
                    act("registration.manualPayment", {
                      registrationId: r.id,
                      payment: { method: "cash", amountCents: r.amountCents },
                    })
                  }
                >
                  Paid cash
                </button>
                <button
                  onClick={() =>
                    act("registration.manualPayment", {
                      registrationId: r.id,
                      payment: {
                        method: "external_transfer",
                        amountCents: r.amountCents,
                      },
                    })
                  }
                >
                  Paid EFT / payment link
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {e.status !== "cancelled" && !window.location.hash && (
        <details className="card">
          <summary>Run Americano / Mexicano from this date</summary>
          <TournamentSetupForm
            baseCount={
              data.registrations.filter(
                (r) =>
                  r.attendance === "active" &&
                  [
                    "paid_online",
                    "paid_externally",
                    "cash_received",
                    "fee_waived",
                  ].includes(r.payment),
              ).length
            }
            submitLabel="Create tournament"
            onSubmit={async (v) => {
              try {
                const t = await api<Tournament>("/api/tournaments", {
                  op: "create",
                  input: {
                    name: v.name,
                    eventId: eid,
                    rules: {
                      format: v.format,
                      pointsPerMatch: v.pointsPerMatch,
                      courts: v.courts,
                      rounds: v.rounds,
                      minutesPerRound: v.minutesPerRound,
                      lateEntrantsEligibleToWin: v.lateEntrantsEligibleToWin,
                    },
                    participants: v.names.map((name) => ({
                      name,
                      financialStatus: "unpaid_exception",
                    })),
                  },
                });
                router.push(`/tournament/${t.id}`);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          />
        </details>
      )}
      <div className="card">
        <h2>Waiting list</h2>
        <ol>
          {data.waitlist.map((w) => (
            <li key={w.id}>
              {w.displayName} · {w.status}
            </li>
          ))}
        </ol>
      </div>
      {privateLink.includes("#") && !savedDate && <>
        <SignInOffer message="Want to keep your dates online?" action="Sign in and we’ll save this date." next={privateLink} onSignIn={() => goldenPointStorage().setItem(`golden-point.date.save.${eid}`, "yes")} />
        {user && <button className="secondary" disabled={savingDate} onClick={saveDate}>{savingDate ? "Saving…" : "Save this date to my account"}</button>}
      </>}
      {savedDate && <p className="notice ok" role="status">Date saved. Find it in <Link href="/admin">your organiser dashboard</Link>.</p>}
    </main>
  );
}
export default function Page() {
  return <DateAdmin />;
}
