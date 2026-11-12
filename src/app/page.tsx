import Link from "next/link";

export default function Home() {
  return (
    <main className="wide home-page">
      <section className="home-hero">
        <div className="home-intro">
          <p className="eyebrow">Welcome to the clubhouse</p>
          <h1>Your people.<br />Your court.<br /><span>Game on.</span></h1>
          <p>Your weekly padel group: who’s playing, who’s paid and who’s waiting. Run Americano or Mexicano on the night.</p>
          <Link className="button ball-button" href="/tournament/new">Create Americano / Mexicano <span aria-hidden="true">↗</span></Link>
          <p className="home-note">Free to play. No account needed.</p>
        </div>
        <div className="court-art" aria-hidden="true"><div className="court-drawing"><span className="court-service" /><span className="court-net" /><span className="court-ball" /></div><span className="court-caption">A good week starts on court.</span></div>
      </section>
      <div className="home-options">
        <section className="card stack">
          <p className="eyebrow">01 / On the night</p>
          <h2>Run a tournament now</h2>
          <p>Enter names and courts. No account, league or payment needed — your session is saved on this device.</p>
          <Link className="home-text-link" href="/tournament/new">Create Americano / Mexicano <span aria-hidden="true">↗</span></Link>
        </section>
        <section className="card stack">
          <p className="eyebrow">02 / Organisers</p>
          <h2>Get the group together</h2>
          <p>Create a group link and dates. Players can pay you directly or choose cash / EFT.</p>
          <Link className="home-text-link" href="/date/new">Create a weekly date <span aria-hidden="true">↗</span></Link>
        </section>
        <section className="card stack">
          <p className="eyebrow">03 / Players</p>
          <h2>You’re part of the game</h2>
          <p>Open the link your organiser shared. Join without an account. Keep your private link to drop out or check a waiting-list offer.</p>
          <Link className="home-text-link" href="/me">My bookings <span aria-hidden="true">↗</span></Link>
        </section>
      </div>
    </main>
  );
}
