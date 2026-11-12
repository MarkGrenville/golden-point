"use client";
import { PageHeading } from "@/components/PageHeading";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  RequireSignIn,
  fromLocalInput,
  randsToCents,
} from "@/components/admin-utils";
import { admin } from "@/lib/client/api";
import type { Group } from "@/lib/booking/types";
import type { PublicEvent } from "@/lib/booking/projection";
function Workspace() {
  const { wid } = useParams<{ wid: string }>();
  const [data, setData] = useState<{
    workspace: {
      name: string;
      role: string;
      merchant: { status: string; sandbox: boolean; suffix?: string };
    };
    groups: Group[];
    events: PublicEvent[];
    tournaments: { id: string; name: string; status: string }[];
  } | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      admin<typeof data>("workspace.overview", { workspaceId: wid })
        .then(setData)
        .catch((e) => setError(e.message)),
    [wid],
  );
  useEffect(() => {
    load();
  }, [load]);
  async function act(op: string, args: Record<string, unknown>) {
    try {
      setError("");
      await admin(op, { workspaceId: wid, ...args });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!data) return <main>{error || "Loading…"}</main>;
  return (
    <main className="stack">
      <PageHeading eyebrow="Organiser dashboard" title={data.workspace.name} />
      {error && (
        <p role="alert" className="notice bad">
          {error}
        </p>
      )}
      <div className="card">
        <h2>Dates</h2>
        {data.events.map((e) => (
          <p key={e.id}>
            <Link href={`/admin/e/${e.id}`}>
              {e.date} · {e.title}
            </Link>{" "}
            · {e.status}
          </p>
        ))}
      </div>
      <div className="card">
        <h2>Tournaments</h2>
        <Link href="/tournament/new">New Americano / Mexicano</Link>
        {data.tournaments.map((t) => (
          <p key={t.id}>
            <Link href={`/tournament/${t.id}`}>{t.name}</Link> · {t.status}
          </p>
        ))}
      </div>
      {data.groups.map((g) => (
        <div className="card stack" key={g.id}>
          <h2>{g.name}</h2>
          <Link href={`/g/${g.slug}`}>Shared group link</Link>
          {g.template && (
            <button
              className="secondary"
              onClick={() => act("group.drafts", { groupId: g.id })}
            >
              Prepare upcoming weekly dates
            </button>
          )}
          <NewDate
            group={g}
            save={(ev) => act("event.create", { groupId: g.id, event: ev })}
          />
        </div>
      ))}
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          act("group.create", {
            group: {
              name: f.get("name"),
              slug: f.get("slug"),
              kind: "single",
              description: "",
            },
          });
        }}
      >
        <h2>New group</h2>
        <label>
          Name
          <input name="name" required />
        </label>
        <label>
          Link name
          <input
            name="slug"
            placeholder="thursday-golden-point"
            pattern="[a-z0-9-]{3,48}"
            required
          />
        </label>
        <button>Create group</button>
      </form>
      {data.workspace.role === "owner" && (
        <div className="card stack">
          <h2>Settings</h2>
          <Link href={`/admin/w/${wid}/settings/payments`}>Payments →</Link>
          <p className="small muted">Connect your PayFast or add a SnapScan / Zapper link.</p>
        </div>
      )}
    </main>
  );
}
function NewDate({
  group,
  save,
}: {
  group: Group;
  save: (e: unknown) => void;
}) {
  return (
    <details>
      <summary>Add a date</summary>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const date = String(f.get("date"));
          save({
            title: group.name,
            date,
            venue: f.get("venue"),
            format: "doubles",
            allocationMode: "organiser_assigns",
            priceCents: randsToCents(String(f.get("price"))),
            registrationOpensAt: new Date().toISOString(),
            pools: [
              {
                id: "pool1",
                label: String(f.get("start")),
                startsAt: fromLocalInput(`${date}T${f.get("start")}`),
                endsAt: fromLocalInput(`${date}T${f.get("end")}`),
                playerLimit: Number(f.get("limit")),
              },
            ],
          });
        }}
      >
        <label>
          Date
          <input name="date" type="date" required />
        </label>
        <label>
          Venue
          <input name="venue" required />
        </label>
        <label>
          Start (SAST)
          <input name="start" type="time" defaultValue="18:00" required />
        </label>
        <label>
          Finish
          <input name="end" type="time" defaultValue="19:30" required />
        </label>
        <label>
          Player limit
          <input
            name="limit"
            type="number"
            min="4"
            max="32"
            defaultValue="12"
            required
          />
        </label>
        <label>
          Price per player (R)
          <input
            name="price"
            type="number"
            min="0"
            step="0.01"
            defaultValue="150"
            required
          />
        </label>
        <button>Create date</button>
      </form>
    </details>
  );
}
export default function Page() {
  return (
    <RequireSignIn next="/admin">
      <Workspace />
    </RequireSignIn>
  );
}
