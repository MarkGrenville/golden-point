import { describe, it, expect } from "vitest";
import { makeEvent, makeReg } from "./fixtures";
import {
  registrationGate,
  remainingPlaces,
  nextEligibleWaiter,
  publicRoster,
  draftFromTemplate,
  upcomingDates,
} from "./rules";
import { projectEvent } from "./projection";
import { settlementFor } from "./settlement";
import type { Group, WaitlistEntry } from "./types";
const now = new Date("2026-11-02T18:00:00Z");
describe("weekly dates", () => {
  it("opens paid dates without a merchant for cash/EFT", () =>
    expect(registrationGate(makeEvent(), "pool1", "none", now).open).toBe(
      true,
    ));
  it("closes cancelled and started dates", () => {
    expect(
      registrationGate(
        makeEvent({ status: "cancelled" }),
        "pool1",
        "verified",
        now,
      ).open,
    ).toBe(false);
    expect(
      registrationGate(makeEvent(), "pool1", "none", new Date("2026-11-06"))
        .open,
    ).toBe(false);
  });
  it("counts only active players and live holds against the player limit", () => {
    const e = makeEvent();
    const regs = [
      makeReg("a", 1),
      makeReg("b", 2, { attendance: "withdrawn" }),
      makeReg("c", 3, {
        attendance: "held",
        holdExpiresAt: "2026-11-02T17:00:00Z",
      }),
    ];
    expect(remainingPlaces(e, regs, "pool1", now)).toBe(3);
  });
  it("offers the earliest eligible waiter, regardless of input order", () => {
    const w = (id: string, date: string, pool = "pool1"): WaitlistEntry => ({
      id,
      eventId: "e1",
      displayName: id,
      contactEmail: "private@example.com",
      acceptablePoolIds: [pool],
      status: "waiting",
      createdAt: date,
    });
    expect(
      nextEligibleWaiter(
        [w("b", "2"), w("x", "0", "other"), w("a", "1")],
        "pool1",
      )?.id,
    ).toBe("a");
  });
  it("never projects contacts or private payment records", () => {
    const r = makeReg("r", 1);
    expect(JSON.stringify(publicRoster(makeEvent(), [r]))).not.toContain(
      r.contactEmail,
    );
    expect(
      JSON.stringify(projectEvent(makeEvent(), "none", {}, now)),
    ).not.toContain("contactEmail");
  });
  it("records paid withdrawals for settlement and preserves settled records", () => {
    expect(settlementFor(makeReg("r", 1))).toEqual({
      settlement: "due",
      settlementCents: 15000,
    });
    expect(
      settlementFor(makeReg("r", 1, { payment: "unpaid" })).settlement,
    ).toBe("none");
    expect(
      settlementFor(makeReg("r", 1, { settlement: "settled" })).settlement,
    ).toBe("settled");
  });
  it("prepares weekly drafts with a player limit", () => {
    const g: Group = {
      id: "g",
      workspaceId: "w",
      slug: "weekly",
      name: "Weekly",
      description: "",
      kind: "recurring",
      createdAt: "",
      template: {
        weekday: 4,
        venue: "Club",
        pools: [{ label: "18:00", startTime: "18:00", endTime: "19:30" }],
        format: "doubles",
        allocationMode: "organiser_assigns",
        priceCents: 15000,
        weeksAhead: 2,
        opensDaysBefore: 3,
        opensAtTime: "18:00",
        playerLimit: 12,
      },
    };
    expect(upcomingDates(g, "2026-11-02", [])).toEqual([
      "2026-11-05",
      "2026-11-12",
    ]);
    expect(
      draftFromTemplate(g, "2026-11-05", "e", now).pools[0]?.playerLimit,
    ).toBe(12);
  });
});
