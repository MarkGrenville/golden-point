"use client";
import { PageHeading } from "@/components/PageHeading";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, admin } from "@/lib/client/api";
import { useAuth } from "@/lib/client/auth";
import { fromLocalInput } from "@/components/admin-utils";

type Workspace = { id: string; name: string; role: string; merchant: { status: string } };
export default function NewDate() {
  const { user, ready } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (user) admin<Workspace[]>("workspaces.mine").then((rows) => setWorkspaces(rows.filter((w) => w.role !== "scorer"))).catch((e) => setError(e.message));
    else setWorkspaces([]);
  }, [user]);
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError("");
    const f = new FormData(e.currentTarget);
    const value = (key: string) => String(f.get(key) ?? "");
    try {
      const result = await api<{ manageUrl: string }>("/api/dates", {
        title: value("title"), organiserName: value("organiserName"), venue: value("venue"),
        date: value("date"), startTime: value("startTime"), endTime: value("endTime"),
        playerLimit: Number(value("playerLimit")), priceCents: Math.round(Number(value("price")) * 100),
        format: value("format"), dropOutBefore: value("deadline") ? fromLocalInput(value("deadline")) : null,
        workspaceId: workspaceId || undefined,
        devSandbox: f.get("devSandbox") === "on",
      });
      window.location.assign(result.manageUrl);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }
  return <main className="stack">
    <PageHeading eyebrow="New date" title="Create a weekly date"><p>Share one link. Players add their name, pay you directly or choose cash / EFT, and see who’s in.</p></PageHeading>
    <form className="card stack" onSubmit={create}>
      <label>Date name<input name="title" placeholder="e.g. Thursday padel" required maxLength={80} /></label>
      <label>Your organiser name<input name="organiserName" required maxLength={80} autoComplete="name" /></label>
      <label>Venue<input name="venue" required maxLength={80} /></label>
      <label>Date (South Africa)<input name="date" type="date" required /></label>
      <div className="row">
        <label>Start (SAST)<input name="startTime" type="time" defaultValue="18:00" required /></label>
        <label>End (SAST)<input name="endTime" type="time" defaultValue="19:30" required /></label>
      </div>
      <label>Places<input name="playerLimit" type="number" min={4} max={32} defaultValue={16} required /></label>
      <label>Price per player (R)<input name="price" type="number" min={0} max={10000} step="0.01" defaultValue="0" required /></label>
      <label>On the night<select name="format" defaultValue="doubles"><option value="doubles">Social doubles</option><option value="americano">Americano</option><option value="mexicano">Mexicano</option></select></label>
      <label>Drop out before (SAST, optional)<input name="deadline" type="datetime-local" /></label>
      {user && workspaces.length > 0 && <label>Organiser group<select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}><option value="">New group · cash / EFT</option>{workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}{w.merchant.status === "verified" ? " · PayFast connected" : " · cash / EFT"}</option>)}</select></label>}
      {process.env.NODE_ENV === "development" && <label className="notice warn inline"><input type="checkbox" name="devSandbox" /> DEV ONLY — Use PayFast public sandbox (10000100). No real money; returning from sandbox simulates confirmation locally.</label>}
      <p className="small muted">{workspaceId ? "Uses this group’s payment settings and organiser name." : "Cash / EFT works immediately. Sign in and connect your own PayFast in Settings → Payments to offer online payments."} Money goes straight to the organiser. Golden Point is free.</p>
      {error && <p className="notice bad" role="alert">{error}</p>}
      <button disabled={busy || !ready}>{busy ? "Creating…" : "Create date and get link"}</button>
    </form>
    <p className="small">{user ? <Link href="/admin">Your organiser dashboard and payment settings</Link> : "No account needed. Keep the private organiser link after creating your date."}</p>
  </main>;
}
