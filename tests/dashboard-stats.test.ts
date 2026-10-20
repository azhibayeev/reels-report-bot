import { describe, it, expect } from "vitest";
import { toDashboardStats } from "../lib/dashboard-stats";
import type { Snapshot } from "../lib/types";

const reel = (id: string, views: number) => ({ id, permalink: "", publishedAt: "", caption: "", views });

describe("toDashboardStats", () => {
  it("keeps the later snapshot when two share a Jakarta day", () => {
    const snaps: Snapshot[] = [
      { takenAt: "2026-10-10T01:00:00Z", followersCount: 100, reels: [reel("a", 10)] },
      { takenAt: "2026-10-10T05:00:00Z", followersCount: 110, reels: [reel("a", 20)] },
    ];
    expect(toDashboardStats(snaps)).toEqual({
      followers: 110,
      viewsByDay: [{ day: "2026-10-10", total: 20 }],
    });
  });

  it("returns null followers when latest snapshot lacks followersCount", () => {
    const snaps: Snapshot[] = [{ takenAt: "2026-10-10T05:00:00Z", reels: [] }];
    expect(toDashboardStats(snaps).followers).toBeNull();
  });

  it("sums views across reels, one entry per day, ascending", () => {
    const snaps: Snapshot[] = [
      { takenAt: "2026-10-11T05:00:00Z", followersCount: 5, reels: [reel("a", 1), reel("b", 2)] },
      { takenAt: "2026-10-10T05:00:00Z", followersCount: 4, reels: [reel("a", 3), reel("b", 4), reel("c", 5)] },
    ];
    expect(toDashboardStats(snaps).viewsByDay).toEqual([
      { day: "2026-10-10", total: 12 },
      { day: "2026-10-11", total: 3 },
    ]);
  });

  it("handles empty input", () => {
    expect(toDashboardStats([])).toEqual({ followers: null, viewsByDay: [] });
  });
});

describe("bearerMatches", () => {
  it("accepts exact token, rejects wrong/missing/unset", async () => {
    const { bearerMatches } = await import("../lib/dashboard-stats");
    expect(bearerMatches("Bearer s3cret", "s3cret")).toBe(true);
    expect(bearerMatches("Bearer s3creT", "s3cret")).toBe(false);
    expect(bearerMatches("Bearer short", "s3cret")).toBe(false);
    expect(bearerMatches(null, "s3cret")).toBe(false);
    expect(bearerMatches("Bearer ", "")).toBe(false);
    expect(bearerMatches("Bearer undefined", undefined)).toBe(false);
  });
});
