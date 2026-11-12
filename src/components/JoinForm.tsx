"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PublicEvent } from "@/lib/booking/projection";
import { api } from "@/lib/client/api";
import { useAuth } from "@/lib/client/auth";
import { formatRand } from "@/lib/shared/money";
import { formatSast } from "@/lib/shared/time";

export function JoinForm({ event }: { event: PublicEvent }) {
  const router = useRouter();
  const { user } = useAuth();
  const openPools = event.pools.filter((p) => p.gateOpen);
  const [poolId, setPoolId] = useState(
    openPools[0]?.id ?? event.pools[0]?.id ?? "",
  );
  const pool = event.pools.find((p) => p.id === poolId);
  const [displayName, setDisplayName] = useState("");
  const [alias, setAlias] = useState("");
  const [showOnRoster, setShowOnRoster] = useState(true);
  const [email, setEmail] = useState(user?.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitPools, setWaitPools] = useState<string[]>([]);
  const [paymentMethod, setPaymentMethod] = useState("manual");

  if (!pool) return null;
  const full = pool.gateOpen && pool.remaining === 0;

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ registrationId: string; bookingToken: string }>(
        `/api/events/${event.id}/holds`,
        {
          poolId,
          displayName,
          alias: alias || undefined,
          showOnRoster,
          email: email || undefined,
          paymentMethod,
        },
      );
      router.push(
        `/booking/${res.registrationId}?t=${encodeURIComponent(res.bookingToken)}`,
      );
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function joinWaitlist(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ id: string; token: string }>(
        `/api/events/${event.id}/waitlist`,
        {
          displayName,
          email: email || undefined,
          poolIds: waitPools.length ? waitPools : [poolId],
        },
      );
      router.push(`/waiting/${res.id}?t=${encodeURIComponent(res.token)}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const fields = (
    <>
      <label htmlFor="dn">Your name</label>
      <input
        id="dn"
        required
        maxLength={40}
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        autoComplete="name"
      />
      <label htmlFor="em">Email (optional, private)</label>
      <input
        id="em"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
      />
    </>
  );

  return (
    <div className="card stack">
      <h2>Join</h2>
      {event.devSandbox && <p className="notice warn">DEV ONLY — PayFast sandbox. No real money. The return page simulates confirmation locally without an ITN.</p>}
      {event.pools.length > 1 && (
        <>
          <label htmlFor="pool">Time</label>
          <select
            id="pool"
            value={poolId}
            onChange={(e) => {
              setPoolId(e.target.value);
            }}
          >
            {event.pools.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — {p.gateOpen ? `${p.remaining} left` : p.gateLabel}
              </option>
            ))}
          </select>
        </>
      )}
      {!pool.gateOpen ? (
        <div className="notice warn">
          <strong>{pool.gateLabel}.</strong>{" "}
          {pool.gateLabel === "Opens soon" && event.registrationOpensAt
            ? `Registration opens ${formatSast(new Date(event.registrationOpensAt))} SAST.`
            : pool.gateReasons[0]}
        </div>
      ) : full ? (
        <form className="stack" onSubmit={joinWaitlist}>
          <div className="notice warn">
            <strong>Full.</strong> Join the waiting list for free.
          </div>
          {fields}
          {event.pools.length > 1 && (
            <fieldset>
              <legend>Times you can make</legend>
              {event.pools.map((p) => (
                <label key={p.id} className="inline">
                  <input
                    type="checkbox"
                    checked={
                      waitPools.includes(p.id) ||
                      (!waitPools.length && p.id === poolId)
                    }
                    onChange={(e) =>
                      setWaitPools((cur) =>
                        e.target.checked
                          ? [
                              ...new Set([
                                ...(cur.length ? cur : [poolId]),
                                p.id,
                              ]),
                            ]
                          : (cur.length ? cur : [poolId]).filter(
                              (x) => x !== p.id,
                            ),
                      )
                    }
                  />{" "}
                  {p.label}
                </label>
              ))}
            </fieldset>
          )}
          {error && (
            <div className="notice bad" role="alert">
              {error}
            </div>
          )}
          <button className="full" disabled={busy}>
            Join waiting list
          </button>
        </form>
      ) : (
        <form className="stack" onSubmit={join}>
          {fields}
          <label htmlFor="alias">
            Name shown on the shared list (optional)
          </label>
          <input
            id="alias"
            maxLength={40}
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder={displayName || "e.g. a nickname"}
          />
          <label className="inline">
            <input
              type="checkbox"
              checked={showOnRoster}
              onChange={(e) => setShowOnRoster(e.target.checked)}
            />{" "}
            Show my name on the player list
          </label>
          <p className="small muted">
            Anyone with this link can see the player list. Your email and
            payment details are never shown.
          </p>
          {error && (
            <div className="notice bad" role="alert">
              {error}
            </div>
          )}
          {event.priceCents > 0 && (
            <label>
              Payment
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                <option value="manual">I’ll pay cash / EFT</option>
                {event.payfastConnected && (
                  <option value="payfast">{event.devSandbox ? "PayFast sandbox · DEV ONLY" : "PayFast"}</option>
                )}
              </select>
            </label>
          )}
          {event.priceCents > 0 && event.paymentLink && paymentMethod === "manual" && (
            <p className="small">
              Or <a href={event.paymentLink} target="_blank" rel="noreferrer">pay with SnapScan / Zapper</a>.
              {" "}Join first, then pay using your name as the reference. The organiser marks you paid by hand.
            </p>
          )}
          <button className="full" disabled={busy}>
            {paymentMethod === "payfast"
              ? `Hold my place and pay ${formatRand(event.priceCents)}`
              : "Join"}
          </button>
          {paymentMethod === "payfast" && (
            <p className="small muted">
              Your place is held for 10 minutes while you pay. It is confirmed
              only when PayFast confirms the payment.
            </p>
          )}
        </form>
      )}
    </div>
  );
}
