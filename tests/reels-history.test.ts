import { describe, it, expect } from "vitest";
import { buildHistory, dayHeader, HISTORY_HEADERS, toHistoryValues } from "../lib/reels-history";
import { Snapshot } from "../lib/types";

// takenAt в 05:30 UTC = 12:30 по Джакарте, как у реального крона.
function snap(day: string, reels: Array<[id: string, views: number, published?: string]>): Snapshot {
  return {
    takenAt: `${day}T05:30:00.000Z`,
    reels: reels.map(([id, views, published]) => ({
      id,
      permalink: `https://www.instagram.com/reel/${id}/`,
      publishedAt: published ?? "2026-07-01T00:00:00+0000",
      caption: `подпись ${id}`,
      views,
    })),
  };
}

describe("buildHistory", () => {
  it("computes per-reel daily gains between consecutive snapshots", () => {
    const m = buildHistory([
      snap("2026-08-01", [["a", 100]]),
      snap("2026-08-02", [["a", 150]]),
      snap("2026-08-03", [["a", 190]]),
    ]);
    expect(m.dates).toEqual(["2026-08-03", "2026-08-02"]); // свежие слева
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0].gains).toEqual([40, 50]);
  });

  it("counts a brand-new reel's whole counter as that day's gain", () => {
    const m = buildHistory([
      snap("2026-08-01", [["a", 100]]),
      snap("2026-08-02", [
        ["a", 120],
        ["b", 900],
      ]),
    ]);
    const b = m.rows.find((r) => r.id === "b")!;
    expect(b.gains).toEqual([900]);
  });

  it("leaves a gap where the reel was absent from a snapshot", () => {
    const m = buildHistory([
      snap("2026-08-01", [["a", 10]]),
      snap("2026-08-02", [["a", 20]]),
      snap("2026-08-03", []),
    ]);
    expect(m.dates).toEqual(["2026-08-03", "2026-08-02"]);
    expect(m.rows[0].gains).toEqual([null, 10]);
  });

  it("keeps negative gains — Instagram does revise counters downward", () => {
    const m = buildHistory([snap("2026-08-01", [["a", 100]]), snap("2026-08-02", [["a", 90]])]);
    expect(m.rows[0].gains).toEqual([-10]);
  });

  it("returns nothing when there is less than one pair of snapshots", () => {
    expect(buildHistory([])).toEqual({ dates: [], rows: [] });
    expect(buildHistory([snap("2026-08-01", [["a", 1]])])).toEqual({ dates: [], rows: [] });
  });

  it("caps the number of day columns and keeps the freshest ones", () => {
    const snaps = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"].map((d, i) =>
      snap(d, [["a", (i + 1) * 10]])
    );
    const m = buildHistory(snaps, 2);
    expect(m.dates).toEqual(["2026-08-04", "2026-08-03"]);
    expect(m.rows[0].gains).toEqual([10, 10]);
  });

  it("orders rows newest published first and carries the latest total", () => {
    const m = buildHistory([
      snap("2026-08-01", [
        ["old", 5, "2026-07-01T00:00:00+0000"],
        ["new", 5, "2026-07-20T00:00:00+0000"],
      ]),
      snap("2026-08-02", [
        ["old", 8, "2026-07-01T00:00:00+0000"],
        ["new", 9, "2026-07-20T00:00:00+0000"],
      ]),
    ]);
    expect(m.rows.map((r) => r.id)).toEqual(["new", "old"]);
    expect(m.rows[0].totalViews).toBe(9);
  });

  it("accepts snapshots given out of order", () => {
    const m = buildHistory([snap("2026-08-03", [["a", 30]]), snap("2026-08-02", [["a", 10]])]);
    expect(m.dates).toEqual(["2026-08-03"]);
    expect(m.rows[0].gains).toEqual([20]);
  });
});

describe("dayHeader", () => {
  it("renders a day key as dd.mm", () => {
    expect(dayHeader("2026-08-03")).toBe("03.08");
  });
});

describe("toHistoryValues", () => {
  it("lays out fixed columns, then one column per day", () => {
    const m = buildHistory([snap("2026-08-01", [["a", 10]]), snap("2026-08-02", [["a", 25]])]);
    const values = toHistoryValues(m, new Date("2026-08-02T05:30:00Z"));
    expect(values[0]).toEqual([...HISTORY_HEADERS, "02.08"]);
    expect(values[1][0]).toBe(1);
    expect(values[1][4]).toBe(25); // всего просмотров
    expect(values[1][5]).toBe(15); // прирост за 02.08
  });

  it("writes gaps as empty cells, not zeros", () => {
    const m = buildHistory([
      snap("2026-08-01", [["a", 10]]),
      snap("2026-08-02", [["a", 20]]),
      snap("2026-08-03", []),
    ]);
    expect(toHistoryValues(m, new Date())[1][5]).toBe("");
  });

  it("ends with a legend row explaining the numbers", () => {
    const values = toHistoryValues(
      buildHistory([snap("2026-08-01", [["a", 10]]), snap("2026-08-02", [["a", 20]])]),
      new Date("2026-08-02T05:30:00Z")
    );
    expect(String(values[values.length - 1][0])).toContain("Прирост просмотров за день");
  });
});
