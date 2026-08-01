import { describe, it, expect } from "vitest";
import { computeDailyViewGains } from "../lib/chart";
import { Snapshot } from "../lib/types";

function snap(takenAt: string, ...views: number[]): Snapshot {
  return {
    takenAt,
    reels: views.map((v, i) => ({
      id: `r${i}`,
      permalink: `https://www.instagram.com/reel/r${i}/`,
      publishedAt: "2026-07-01T00:00:00Z",
      caption: "",
      views: v,
    })),
  };
}

describe("computeDailyViewGains", () => {
  it("returns daily total-view gains between consecutive snapshots", () => {
    const snaps: Snapshot[] = [
      snap("2026-07-19T05:30:00Z", 100), // total 100
      snap("2026-07-20T05:30:00Z", 180), // total 180 → gain 80
      snap("2026-07-21T05:30:00Z", 200, 50), // total 250 → gain 70
    ];
    expect(computeDailyViewGains(snaps)).toEqual([
      { date: "2026-07-20", value: 80 },
      { date: "2026-07-21", value: 70 },
    ]);
  });

  it("returns [] when fewer than 2 snapshots", () => {
    expect(computeDailyViewGains([])).toEqual([]);
    expect(computeDailyViewGains([snap("2026-07-20T05:30:00Z", 100)])).toEqual([]);
  });
});
