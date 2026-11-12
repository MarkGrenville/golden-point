"use client";
import { PageHeading } from "@/components/PageHeading";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SignInOffer } from "@/components/SignInOffer";
import { admin } from "@/lib/client/api";
import { useAuth } from "@/lib/client/auth";

type WsRow = { id: string; name: string; role: string; merchant: { status: string } };

function Workspaces() {
  const { user } = useAuth();
  const [rows, setRows] = useState<WsRow[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (user) admin<WsRow[]>("workspaces.mine").then(setRows, (e) => setError(e.message));
  }, [user]);
  return (
    <main className="stack">
      <h1>Organise</h1>
      {error && <div className="notice bad">{error}</div>}
      {rows?.map((w) => (
        <Link key={w.id} href={`/admin/w/${w.id}`} className="card" style={{ display: "block", color: "inherit", textDecoration: "none" }}>
          <strong>{w.name}</strong> <span className="badge neutral">{w.role}</span>{" "}
          <span className={`badge ${w.merchant.status === "verified" ? "ok" : "warn"}`}>{w.merchant.status === "verified" ? "Payments enabled" : "Payments not enabled"}</span>
        </Link>
      ))}
      <form className="card stack" onSubmit={async (e) => { e.preventDefault(); try { const ws = await admin<{ id: string }>("workspace.create", { name }); window.location.href = `/admin/w/${ws.id}`; } catch (err) { setError((err as Error).message); } }}>
        <h2>New organiser workspace</h2>
        <p className="small muted">Each workspace has its own groups, co-organisers and PayFast merchant account.</p>
        <input placeholder="e.g. Golden Point Thursdays" required value={name} onChange={(e) => setName(e.target.value)} />
        <button>Create workspace</button>
      </form>
      <p className="small"><Link href="/tournament/new">Just need a quick Americano / Mexicano? No workspace needed.</Link></p>
    </main>
  );
}

export default function Page() {
  const { user } = useAuth();
  return <><main className="stack"><PageHeading eyebrow="Organise" title="Organise your weekly padel"><p>Create a date and share it. No account needed.</p></PageHeading><Link className="button full" href="/date/new">Create a date</Link></main>{user ? <Workspaces /> : <main><SignInOffer message="Want to keep your groups for next week or connect PayFast?" action="Sign in when you’re ready." next="/admin" /></main>}</>;
}
