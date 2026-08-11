import { describe, it, expect } from "vitest";
import { buildHeatmapRequests, type Heatmap } from "../lib/sheets";

interface Rule {
  addConditionalFormatRule: {
    rule: {
      ranges: Array<{
        sheetId: number;
        startRowIndex: number;
        endRowIndex: number;
        startColumnIndex: number;
        endColumnIndex: number;
      }>;
      gradientRule: {
        minpoint: { type: string; color: Record<string, number> };
        midpoint: { type: string; value: string };
        maxpoint: { type: string; color: Record<string, number> };
      };
    };
  };
}

const ranges = (rs: unknown[]) => (rs as Rule[]).map((r) => r.addConditionalFormatRule.rule.ranges[0]);

const rowMap: Heatmap = {
  kind: "row",
  startRowIndex: 1,
  rowCount: 3,
  startColumnIndex: 6,
  endColumnIndex: 9,
  scale: "green",
};

const colMap: Heatmap = {
  kind: "column",
  startRowIndex: 1,
  rowCount: 100,
  startColumnIndex: 5,
  endColumnIndex: 8,
  scale: "redYellowGreen",
};

describe("buildHeatmapRequests — построчная карта", () => {
  it("creates one rule per row, each spanning the full column span", () => {
    const rs = ranges(buildHeatmapRequests(7, rowMap));
    expect(rs).toHaveLength(3);
    expect(rs.map((r) => [r.startRowIndex, r.endRowIndex])).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
    expect(rs.every((r) => r.startColumnIndex === 6 && r.endColumnIndex === 9)).toBe(true);
    expect(rs.every((r) => r.sheetId === 7)).toBe(true);
  });

  it("caps the number of painted rows so the sheet stays responsive", () => {
    const rs = buildHeatmapRequests(7, { ...rowMap, rowCount: 900 });
    expect(rs).toHaveLength(400);
  });
});

describe("buildHeatmapRequests — поколоночная карта", () => {
  it("creates one rule per column, each spanning all data rows", () => {
    const rs = ranges(buildHeatmapRequests(7, colMap));
    expect(rs).toHaveLength(3);
    expect(rs.map((r) => [r.startColumnIndex, r.endColumnIndex])).toEqual([
      [5, 6],
      [6, 7],
      [7, 8],
    ]);
    expect(rs.every((r) => r.startRowIndex === 1 && r.endRowIndex === 101)).toBe(true);
  });

  it("is not capped by the row limit — a column is a single rule", () => {
    expect(buildHeatmapRequests(7, { ...colMap, rowCount: 5000 })).toHaveLength(3);
  });
});

describe("шкалы", () => {
  const grad = (h: Heatmap) => (buildHeatmapRequests(1, h)[0] as Rule).addConditionalFormatRule.rule.gradientRule;

  it("uses min / 50th percentile / max anchors", () => {
    const g = grad(rowMap);
    expect(g.minpoint.type).toBe("MIN");
    expect(g.midpoint.type).toBe("PERCENTILE");
    expect(g.midpoint.value).toBe("50");
    expect(g.maxpoint.type).toBe("MAX");
  });

  it("green scale runs white → saturated green", () => {
    const g = grad(rowMap);
    expect(g.minpoint.color).toEqual({ red: 1, green: 1, blue: 1 });
    expect(g.maxpoint.color.green).toBeGreaterThan(g.maxpoint.color.red);
  });

  it("red-yellow-green scale starts red and ends green", () => {
    const g = grad({ ...rowMap, scale: "redYellowGreen" });
    expect(g.minpoint.color.red).toBeGreaterThan(g.minpoint.color.green);
    expect(g.maxpoint.color.green).toBeGreaterThan(g.maxpoint.color.red);
  });
});
