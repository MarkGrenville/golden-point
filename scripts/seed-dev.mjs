// Seeds the local emulators with a demo organiser, the Thursday group and an open date.
// Usage: npm run seed   (emulators must be running). Never point this at a real project.
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8180";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9410";
initializeApp({ projectId: "demo-golden-point" });
const db = getFirestore();
const auth = getAuth();

const email = "organiser@example.com";
const user = await auth
  .getUserByEmail(email)
  .catch(() =>
    auth.createUser({
      email,
      password: "golden-point-dev",
      emailVerified: true,
      displayName: "Demo Organiser",
    }),
  );
const now = new Date();
const iso = (d) => d.toISOString();
const days = (n) => new Date(now.getTime() + n * 86400_000);

await db
  .doc("workspaces/demo")
  .set({
    id: "demo",
    name: "Golden Point Thursdays",
    ownerUid: user.uid,
    members: { [user.uid]: "owner" },
    merchant: { status: "none", sandbox: true },
    createdAt: iso(now),
  });
await db.doc(`workspaces/demo/members/${user.uid}`).set({ role: "owner" });
const template = {
  weekday: 4,
  venue: "Demo Padel Club",
  pools: [{ label: "18:00", startTime: "18:00", endTime: "19:30" }],
  format: "doubles",
  allocationMode: "organiser_assigns",
  priceCents: 15000,
  weeksAhead: 3,
  opensDaysBefore: 3,
  opensAtTime: "19:00",
  playerLimit: 12,
};
await db
  .doc("groups/thursday")
  .set({
    id: "thursday",
    workspaceId: "demo",
    slug: "thursday-golden-point",
    name: "Golden Point Thursdays",
    description: "Weekly social doubles. Courts are booked by the organiser.",
    kind: "recurring",
    template,
    createdAt: iso(now),
  });
await db
  .doc("slugs/thursday-golden-point")
  .set({ groupId: "thursday", workspaceId: "demo" });
await db
  .doc("publicGroups/thursday-golden-point")
  .set({
    slug: "thursday-golden-point",
    name: "Golden Point Thursdays",
    description: "Weekly social doubles. Courts are booked by the organiser.",
    workspaceId: "demo",
    groupId: "thursday",
  });

const start = days(4);
start.setUTCHours(16, 0, 0, 0);
const date = start.toISOString().slice(0, 10);
const end = new Date(start.getTime() + 90 * 60_000);
const event = {
  id: "demo-open",
  workspaceId: "demo",
  groupId: "thursday",
  groupSlug: "thursday-golden-point",
  title: "Golden Point Thursdays",
  date,
  venue: "Demo Padel Club",
  format: "doubles",
  allocationMode: "organiser_assigns",
  priceCents: 15000,
  eventConfirmed: true,
  status: "scheduled",
  pools: [
    {
      id: "pool1",
      label: "18:00",
      startsAt: iso(start),
      endsAt: iso(end),
      playerLimit: 12,
    },
  ],
  registrationOpensAt: iso(days(-1)),
  createdAt: iso(now),
};
await db.doc("events/demo-open").set(event);
// The app rebuilds this projection on the first mutation; seed a minimal one so the page renders.
await db
  .doc("eventPools/demo-open__pool1")
  .set({ eventId: "demo-open", poolId: "pool1", places: {} });
await db.doc("publicEvents/demo-open").set({
  id: event.id,
  workspaceId: "demo",
  groupSlug: event.groupSlug,
  title: event.title,
  date,
  venue: event.venue,
  format: event.format,
  allocationMode: event.allocationMode,
  priceCents: event.priceCents,
  eventConfirmed: true,
  status: "scheduled",
  dropOutBefore: null,
  organiserName: "Golden Point Thursdays",
  payfastConnected: false,
  paymentLink: null,
  waiting: [],
  waitingCount: 0,
  registrationOpensAt: event.registrationOpensAt,
  pools: [
    {
      id: "pool1",
      label: "18:00",
      startsAt: iso(start),
      endsAt: iso(end),
      capacity: 12,
      remaining: 12,
      gateLabel: "Open",
      gateOpen: true,
      gateReasons: [],
      courts: [],
      roster: [],
    },
  ],
  updatedAt: iso(now),
});
console.log(
  `Seeded. Sign in as ${email} / golden-point-dev. Group: http://localhost:3410/g/thursday-golden-point`,
);
process.exit(0);
