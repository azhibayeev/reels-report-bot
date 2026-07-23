import { describe, it, expect } from "vitest";
import { computeReport } from "../lib/diff";
import { ReelSnapshot, Snapshot } from "../lib/types";

function reel(id: string, views: number, publishedAt: string): ReelSnapshot {
  return {
    id,
    views,
    publishedAt,
    permalink: `https://www.instagram.com/reel/${id}/`,
    caption: `Рилс ${id}`,
  };
}

const T0 = "2026-07-19T05:30:00Z"; // вчера 12:30 WIB
const T1 = "2026-07-20T05:30:00Z"; // сегодня 12:30 WIB

describe("computeReport", () => {
  it("computes per-reel gain and total gain vs previous snapshot", () => {
    const prev: Snapshot = { takenAt: T0, reels: [reel("a", 100, "2026-07-01T00:00:00Z"), reel("b", 50, "2026-07-02T00:00:00Z")] };
    const curr: Snapshot = { takenAt: T1, reels: [reel("a", 180, "2026-07-01T00:00:00Z"), reel("b", 55, "2026-07-02T00:00:00Z")] };
    const r = computeReport(curr, prev);
    expect(r.isBaseline).toBe(false);
    expect(r.all.find((x) => x.id === "a")?.gain).toBe(80);
    expect(r.all.find((x) => x.id === "b")?.gain).toBe(5);
    expect(r.totalGain).toBe(85);
    expect(r.totalViews).toBe(235);
    expect(r.periodStart).toBe(T0);
    expect(r.periodEnd).toBe(T1);
  });

  it("marks reels published inside the window and absent from prev as new; gain = all their views", () => {
    const prev: Snapshot = { takenAt: T0, reels: [reel("a", 100, "2026-07-01T00:00:00Z")] };
    const curr: Snapshot = {
      takenAt: T1,
      reels: [reel("a", 120, "2026-07-01T00:00:00Z"), reel("n", 900, "2026-07-19T10:00:00Z")],
    };
    const r = computeReport(curr, prev);
    const n = r.all.find((x) => x.id === "n")!;
    expect(n.isNew).toBe(true);
    expect(n.gain).toBe(900);
    expect(r.newReels.map((x) => x.id)).toEqual(["n"]);
    expect(r.totalGain).toBe(920);
  });

  it("does not mark an old reel missing from prev snapshot as new", () => {
    const prev: Snapshot = { takenAt: T0, reels: [] };
    const curr: Snapshot = { takenAt: T1, reels: [reel("old", 500, "2026-01-01T00:00:00Z")] };
    const r = computeReport(curr, prev);
    expect(r.all[0].isNew).toBe(false);
    expect(r.all[0].gain).toBe(500);
  });

  it("baseline mode when prev is null: zero gains, empty top, new reels by last-24h window", () => {
    const curr: Snapshot = {
      takenAt: T1,
      reels: [reel("a", 100, "2026-07-01T00:00:00Z"), reel("n", 10, "2026-07-19T10:00:00Z")],
    };
    const r = computeReport(curr, null);
    expect(r.isBaseline).toBe(true);
    expect(r.periodStart).toBeNull();
    expect(r.totalGain).toBe(0);
    expect(r.top).toEqual([]);
    expect(r.newReels.map((x) => x.id)).toEqual(["n"]);
  });

  it("top is sorted by gain descending and capped at 10", () => {
    const prev: Snapshot = {
      takenAt: T0,
      reels: Array.from({ length: 12 }, (_, i) => reel(`r${i}`, 0, "2026-07-01T00:00:00Z")),
    };
    const curr: Snapshot = {
      takenAt: T1,
      reels: Array.from({ length: 12 }, (_, i) => reel(`r${i}`, i * 10, "2026-07-01T00:00:00Z")),
    };
    const r = computeReport(curr, prev);
    expect(r.top).toHaveLength(10);
    expect(r.top[0].id).toBe("r11");
    expect(r.top[1].id).toBe("r10");
  });

  it("computes followers count and net delta vs previous snapshot", () => {
    const prev: Snapshot = { takenAt: T0, followersCount: 15000, reels: [] };
    const curr: Snapshot = { takenAt: T1, followersCount: 16332, reels: [] };
    const r = computeReport(curr, prev);
    expect(r.followers).toEqual({ count: 16332, delta: 1332 });
  });

  it("followers delta is null when prev snapshot has no followers count (old format)", () => {
    const prev: Snapshot = { takenAt: T0, reels: [] };
    const curr: Snapshot = { takenAt: T1, followersCount: 16332, reels: [] };
    expect(computeReport(curr, prev).followers).toEqual({ count: 16332, delta: null });
  });

  it("followers is null when the current snapshot has no followers count", () => {
    const curr: Snapshot = { takenAt: T1, reels: [] };
    expect(computeReport(curr, null).followers).toBeNull();
  });

  it("new reels are sorted newest first", () => {
    const prev: Snapshot = { takenAt: T0, reels: [] };
    const curr: Snapshot = {
      takenAt: T1,
      reels: [reel("older", 1, "2026-07-19T08:00:00Z"), reel("newer", 2, "2026-07-20T01:00:00Z")],
    };
    const r = computeReport(curr, prev);
    expect(r.newReels.map((x) => x.id)).toEqual(["newer", "older"]);
  });
});
