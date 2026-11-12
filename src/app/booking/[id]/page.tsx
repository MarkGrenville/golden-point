"use client";
import { PageHeading } from "@/components/PageHeading";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { AttendanceBadge, PaymentBadge } from "@/components/Status";
import type { Registration } from "@/lib/booking/types";
import { api } from "@/lib/client/api";
import { useAuth } from "@/lib/client/auth";
import { formatRand } from "@/lib/shared/money";

function Booking() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const token = search.get("t");
  const devReturn = search.get("dev_return");
  const { ready } = useAuth();
  const [devSandbox, setDevSandbox] = useState(false);
  const [devConfirmed, setDevConfirmed] = useState(false);
  const [payfastConnected, setPayfastConnected] = useState(false);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const [organiser, setOrganiser] = useState("the organiser");
  const [reg, setReg] = useState<Registration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const res = await api<{
      devSandbox: boolean;
      registration: Registration;
      organiserName: string;
      payfastConnected: boolean;
      paymentLink: string | null;
    }>(`/api/bookings/${id}${token ? `?t=${encodeURIComponent(token)}` : ""}`);
    setDevSandbox(res.devSandbox);
    setReg(res.registration);
    setOrganiser(res.organiserName);
    setPayfastConnected(res.payfastConnected);
    setPaymentLink(res.paymentLink);
  }, [id, token]);

  useEffect(() => {
    if (!ready) return;
    load().catch((e) => setError(e.message));
    // Poll briefly after returning from PayFast: the notification may arrive after the redirect.
    const poll = setInterval(() => load().catch(() => undefined), 4000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [ready, load]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !ready || !devSandbox || !devReturn || !token) return;
    api(`/api/bookings/${id}/dev-sandbox-return`, { token, nonce: devReturn })
      .then(async () => { setDevConfirmed(true); await load(); })
      .catch((e) => setError(e.message));
  }, [ready, devSandbox, devReturn, token, id, load]);

  async function pay() {
    setPaying(true);
    setError(null);
    try {
      const { action, fields } = await api<{
        action: string;
        fields: [string, string][];
      }>(`/api/bookings/${id}/checkout`, { token });
      const form = document.createElement("form");
      form.method = "POST";
      form.action = action;
      for (const [k, v] of fields) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = k;
        input.value = v;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    } catch (e) {
      setError((e as Error).message);
      setPaying(false);
    }
  }

  if (error && !reg)
    return (
      <main>
        <div className="notice bad">{error}</div>
      </main>
    );
  if (!reg)
    return (
      <main>
        <p>Loading your booking…</p>
      </main>
    );
  const left = reg.holdExpiresAt
    ? Math.max(0, new Date(reg.holdExpiresAt).getTime() - now)
    : 0;
  const mins = Math.floor(left / 60000);
  const secs = Math.floor((left % 60000) / 1000);

  return (
    <main className="stack">
      <PageHeading eyebrow="Your place" title="Your booking" />
      {devSandbox && <p className="notice warn" role="status"><strong>DEV ONLY — PayFast sandbox</strong><br />{devConfirmed ? "Sandbox return confirmed locally. No real money was received and no ITN was verified." : "This is a PayFast sandbox test. No real money changes hands. Returning from checkout simulates payment confirmation locally because PayFast cannot send an ITN to this computer."}</p>}
      <div className="card stack">
        <div className="row">
          <AttendanceBadge s={reg.attendance} />
          <PaymentBadge s={reg.payment} />
        </div>
        <div>
          {reg.displayName}
          {reg.alias ? ` (shown as ${reg.alias})` : ""} ·{" "}
          {formatRand(reg.amountCents)}
        </div>
        {reg.attendance === "held" && left > 0 && (
          <>
            <div className="notice warn">
              Your place is held for{" "}
              <strong>
                {mins}:{String(secs).padStart(2, "0")}
              </strong>
              . Pay now to confirm it.
            </div>
            <button
              className="secondary"
              onClick={async () => {
                try {
                  await api(`/api/bookings/${id}/cash`, { token });
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              I’ll pay cash / EFT
            </button>
            {payfastConnected && reg.amountCents > 0 && (
              <button className="full" disabled={paying} onClick={pay}>
                Pay {formatRand(reg.amountCents)} with PayFast
              </button>
            )}
            <p className="small muted">
              Card, Instant EFT and other methods enabled by the
              organiser&apos;s PayFast account.
            </p>
          </>
        )}
        {reg.attendance === "held" && left === 0 && (
          <div className="notice bad">
            This hold has expired. If you already paid, we&apos;ll confirm your
            place if one is still free, or show money to settle with the
            organiser.
          </div>
        )}
        {reg.attendance === "active" && (
          <div className="notice ok">
            You&apos;re in. Keep this private link to drop out if you can&apos;t
            make it.
          </div>
        )}
        {paymentLink && reg.attendance === "active" && reg.payment === "unpaid" && reg.amountCents > 0 && (
          <div className="stack">
            <p className="small">I’ll pay cash / EFT, or:</p>
            <a className="button full" href={paymentLink} target="_blank" rel="noreferrer">Pay with SnapScan / Zapper</a>
            <p className="small muted">Pay {formatRand(reg.amountCents)} using your name as the reference. The organiser will mark you paid after checking the payment.</p>
          </div>
        )}
        {reg.settlement === "due" && (
          <p className="notice warn">
            {formatRand(reg.settlementCents ?? reg.amountCents)} to settle with{" "}
            {organiser}
          </p>
        )}
        {reg.settlement === "settled" && <p className="notice ok">Settled</p>}
        {(reg.attendance === "active" || reg.attendance === "held") && (
          <button
            className="secondary"
            onClick={async () => {
              try {
                await api(`/api/bookings/${id}/withdraw`, { token });
                await load();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Drop out
          </button>
        )}
        {error && <div className="notice bad">{error}</div>}
      </div>
      <p className="small">
        <Link href={`/e/${reg.eventId}`}>View the date and player list</Link> ·{" "}
        <Link href="/me">Manage my bookings</Link>
      </p>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Booking />
    </Suspense>
  );
}
