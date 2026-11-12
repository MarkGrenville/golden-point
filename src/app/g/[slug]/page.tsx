import { PageHeading } from "@/components/PageHeading";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatRand } from "@/lib/shared/money";
import { formatSast, formatSastTime } from "@/lib/shared/time";
import { publicGroup } from "@/server/public";

export const dynamic = "force-dynamic";

export default async function GroupCalendar({ params }: { params: Promise<{ slug: string }> }) {
  const data = await publicGroup((await params).slug);
  if (!data) notFound();
  return (
    <main className="stack">
      <PageHeading eyebrow="Your group" title={data.group.name}>{data.group.description && <p>{data.group.description}</p>}</PageHeading>
      {data.events.length === 0 && <p className="muted">No upcoming dates yet.</p>}
      {data.events.map((e) => (
        <Link key={e.id} href={`/e/${e.id}`} className="card" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
          <div className="row">
            <strong className="grow">{formatSast(new Date(`${e.date}T12:00:00+02:00`), { time: false })}</strong>
            {e.status === "cancelled" ? <span className="badge bad">Cancelled</span> : null}
          </div>
          <div className="small muted">{e.venue} · {e.format === "doubles" ? "Doubles" : e.format === "americano" ? "Americano" : "Mexicano"} · {e.priceCents ? formatRand(e.priceCents) : "Free"}</div>
          {e.pools.map((p) => (
            <div key={p.id} className="row small" style={{ marginTop: 6 }}>
              <span className="grow">{formatSastTime(new Date(p.startsAt))}–{formatSastTime(new Date(p.endsAt))}</span>
              <span className={`badge ${p.gateOpen ? (p.remaining ? "ok" : "warn") : "neutral"}`}>
                {p.gateOpen ? (p.remaining ? `${p.remaining} of ${p.capacity} places left` : "Full — waiting list") : p.gateLabel}
              </span>
            </div>
          ))}
        </Link>
      ))}
      <p className="small muted">Times are South African Standard Time (SAST). This page is unlisted: anyone with the link can see it.</p>
    </main>
  );
}
