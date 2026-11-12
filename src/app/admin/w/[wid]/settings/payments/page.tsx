"use client";
import { PageHeading } from "@/components/PageHeading";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { RequireSignIn } from "@/components/admin-utils";
import { admin } from "@/lib/client/api";

type Settings = {
  name: string;
  merchant: { status: string; sandbox: boolean; suffix?: string };
  paymentLink: string;
};

function Payments({ wid }: { wid: string }) {
  const [data, setData] = useState<Settings | null>(null);
  const [sandbox, setSandbox] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const settings = await admin<Settings>("payments.get", { workspaceId: wid });
    setData(settings);
    setSandbox(settings.merchant.status === "verified" && settings.merchant.sandbox);
    setLink(settings.paymentLink);
  }, [wid]);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  async function savePayfast(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fields = new FormData(form);
    setBusy(true); setError(""); setMessage("");
    try {
      await admin("merchant.set", {
        workspaceId: wid,
        merchant: {
          sandbox,
          merchantId: String(fields.get("merchantId")).trim(),
          merchantKey: String(fields.get("merchantKey")).trim(),
          passphrase: String(fields.get("passphrase")).trim(),
        },
      });
      form.reset();
      // Never repopulate credentials: the server only returns connection status.
      await load();
      setMessage(sandbox ? "PayFast sandbox saved. No real money changes hands." : "PayFast connected. Players pay you directly.");
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function saveLink(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      await admin("payments.link", { workspaceId: wid, settings: { paymentLink: link.trim() } });
      await load();
      setMessage(link.trim() ? "Payment link saved. Check payments and mark players paid by hand." : "Payment link removed.");
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return <main className="stack">
    <Link href={`/admin/w/${wid}`}>← Back to organiser group</Link>
    <PageHeading eyebrow="Settings" title="Payments" />
    {error && <p className="notice bad" role="alert">{error}</p>}
    {message && <p className="notice ok" role="status">{message}</p>}
    {!data ? <p>{error ? "Payment settings are available to the group owner." : "Loading…"}</p> : <>
      <p>{data.name} · Players pay you directly. Golden Point holds no money and charges no fee.</p>
      <form className="card stack" onSubmit={savePayfast}>
        <h2>PayFast</h2>
        <p className={`notice ${data.merchant.status === "verified" ? "ok" : "warn"}`}>
          {data.merchant.status === "verified"
            ? `Connected${data.merchant.sandbox ? " to sandbox" : ""}, ends in …${data.merchant.suffix}`
            : "PayFast not connected"}
        </p>
        <p><a href="https://payfast.io" target="_blank" rel="noreferrer">Sign up with PayFast</a>. In your PayFast dashboard, go to <strong>Settings → Developer settings</strong>. Copy your merchant ID and key, then set and save a security passphrase. You can also find the ID and key under Account → Personal Information.</p>
        <p className="small"><a href="https://support.payfast.help/portal/en/kb/articles/how-do-i-integrate-payfast-with-woocommerce-20-9-2022" target="_blank" rel="noreferrer">PayFast’s guide to finding your details</a></p>
        <p className="small muted">Credentials are encrypted when saved and never shown here again. To replace them, enter all three details. PayFast confirms online payments automatically.</p>
        <label className="inline"><input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} disabled={busy} />Test with PayFast sandbox</label>
        {sandbox && <p className="notice warn">Paste your sandbox merchant ID, key and passphrase from PayFast’s developer page below. Payments go to PayFast’s sandbox; no real money changes hands.</p>}
          <label>Merchant ID<input name="merchantId" type="password" inputMode="numeric" pattern="[0-9]{8}" minLength={8} maxLength={8} autoComplete="off" required disabled={busy} /></label>
          <label>Merchant key<input name="merchantKey" type="password" maxLength={64} autoComplete="new-password" required disabled={busy} /></label>
          <label>Security passphrase<input name="passphrase" type="password" maxLength={32} autoComplete="new-password" required disabled={busy} /></label>
        <button disabled={busy}>{busy ? "Saving…" : "Save PayFast connection"}</button>
      </form>
      <form className="card stack" onSubmit={saveLink}>
        <h2>SnapScan / Zapper</h2>
        <p>Paste your own payment link. You can use this without connecting PayFast. Players open the link to pay you, then you check your account and mark them paid on the date’s player list.</p>
        {data.paymentLink && <p className="notice ok">Saved link: <a href={data.paymentLink} target="_blank" rel="noreferrer" style={{ overflowWrap: "anywhere" }}>{data.paymentLink}</a></p>}
        <label>Payment link<input name="paymentLink" type="url" maxLength={2048} placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} disabled={busy} /></label>
        <p className="small muted">Use an HTTPS link. Leave it empty and save to remove it.</p>
        <button disabled={busy}>{busy ? "Saving…" : "Save payment link"}</button>
      </form>
    </>}
  </main>;
}

export default function Page() {
  const { wid } = useParams<{ wid: string }>();
  return <RequireSignIn next={`/admin/w/${wid}/settings/payments`}><Payments wid={wid} /></RequireSignIn>;
}
