import { describe, it, expect } from "vitest";
import {
  buildRows,
  HEADERS,
  jakartaStamp,
  parseInsightPayload,
  sheetCaption,
  toSheetValues,
  type ReelInsight,
  type ReelMedia,
} from "../lib/reels-table";

function media(id: string, timestamp: string, over: Partial<ReelMedia> = {}): ReelMedia {
  return {
    id,
    permalink: `https://www.instagram.com/reel/${id}/`,
    timestamp,
    caption: "",
    likeCount: 10,
    commentsCount: 2,
    mediaUrl: `https://cdn.example/${id}.mp4`,
    ...over,
  };
}

function insight(over: Partial<ReelInsight> = {}): ReelInsight {
  return {
    views: 1000,
    reach: 800,
    shares: 5,
    saved: 7,
    totalInteractions: 40,
    avgWatchTimeMs: 12_340,
    ...over,
  };
}

describe("buildRows", () => {
  it("sorts newest first", () => {
    const rows = buildRows(
      [
        media("a", "2026-07-01T00:00:00+0000"),
        media("c", "2026-08-01T00:00:00+0000"),
        media("b", "2026-07-15T00:00:00+0000"),
      ],
      new Map()
    );
    expect(rows.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("computes engagement rate as interactions over reach, in percent", () => {
    const rows = buildRows(
      [media("a", "2026-07-01T00:00:00+0000")],
      new Map([["a", insight({ totalInteractions: 40, reach: 800 })]])
    );
    expect(rows[0].engagementRate).toBe(5);
  });

  it("rounds engagement rate to two decimals", () => {
    const rows = buildRows(
      [media("a", "2026-07-01T00:00:00+0000")],
      new Map([["a", insight({ totalInteractions: 1, reach: 3 })]])
    );
    expect(rows[0].engagementRate).toBe(33.33);
  });

  it("leaves engagement rate empty when reach is zero or missing", () => {
    const rows = buildRows(
      [media("a", "2026-07-01T00:00:00+0000"), media("b", "2026-07-02T00:00:00+0000")],
      new Map([
        ["a", insight({ reach: 0 })],
        ["b", insight({ reach: null })],
      ])
    );
    expect(rows.every((r) => r.engagementRate === null)).toBe(true);
  });

  it("keeps a reel with no insights at all, with empty metrics", () => {
    const rows = buildRows([media("a", "2026-07-01T00:00:00+0000")], new Map());
    expect(rows).toHaveLength(1);
    expect(rows[0].views).toBeNull();
    expect(rows[0].shares).toBeNull();
    expect(rows[0].likeCount).toBe(10);
  });
});

describe("sheetCaption", () => {
  it("collapses newlines into single spaces", () => {
    expect(sheetCaption("первая\n\nвторая   строка")).toBe("первая вторая строка");
  });

  it("keeps the caption in full, however long it is", () => {
    const long = "x".repeat(2000);
    expect(sheetCaption(long)).toBe(long);
  });

  it("leaves a short caption untouched", () => {
    expect(sheetCaption("коротко")).toBe("коротко");
  });

  it("escapes captions that would be read as a formula", () => {
    expect(sheetCaption("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(sheetCaption("-30% скидка")).toBe("'-30% скидка");
  });
});

describe("jakartaStamp", () => {
  it("renders UTC timestamps in Jakarta time (UTC+7)", () => {
    expect(jakartaStamp("2026-07-27T18:51:11+0000")).toBe("2026-07-28 01:51");
  });

  it("returns empty string for an unparseable timestamp", () => {
    expect(jakartaStamp("")).toBe("");
  });
});

describe("toSheetValues", () => {
  it("puts headers plus an updated-at cell in the first row", () => {
    const values = toSheetValues([], new Date("2026-08-11T05:30:00Z"));
    expect(values).toHaveLength(1);
    expect(values[0].slice(0, HEADERS.length)).toEqual([...HEADERS]);
    expect(values[0][HEADERS.length]).toBe("Обновлено: 2026-08-11 12:30 (WIB)");
  });

  it("writes metrics as numbers and blanks as empty strings", () => {
    const rows = buildRows(
      [media("a", "2026-07-01T00:00:00+0000")],
      new Map([["a", insight({ shares: null })]])
    );
    const row = toSheetValues(rows, new Date("2026-08-11T05:30:00Z"))[1];
    expect(row).toHaveLength(HEADERS.length);
    expect(row[0]).toBe(1);
    expect(row[5]).toBe(1000); // просмотры
    expect(row[9]).toBe(""); // репосты недоступны
    expect(row[14]).toBe("a");
  });

  it("converts average watch time from milliseconds to seconds", () => {
    const rows = buildRows(
      [media("a", "2026-07-01T00:00:00+0000")],
      new Map([["a", insight({ avgWatchTimeMs: 12_340 })]])
    );
    expect(toSheetValues(rows, new Date())[1][13]).toBe(12.3);
  });
});

describe("durations", () => {
  it("writes the cached duration, rounded to a tenth of a second", () => {
    const rows = buildRows([media("a", "2026-07-01T00:00:00+0000")], new Map(), { a: 31.466 });
    expect(rows[0].durationSec).toBe(31.5);
    expect(toSheetValues(rows, new Date())[1][4]).toBe(31.5);
  });

  it("leaves the duration cell empty when it is unknown", () => {
    const rows = buildRows([media("a", "2026-07-01T00:00:00+0000")], new Map());
    expect(rows[0].durationSec).toBeNull();
    expect(toSheetValues(rows, new Date())[1][4]).toBe("");
  });
});

describe("parseInsightPayload", () => {
  it("reads both total_value and values shapes", () => {
    const ins = parseInsightPayload({
      data: [
        { name: "views", total_value: { value: 500 } },
        { name: "reach", values: [{ value: 400 }] },
        { name: "shares", total_value: { value: 3 } },
      ],
    });
    expect(ins.views).toBe(500);
    expect(ins.reach).toBe(400);
    expect(ins.shares).toBe(3);
    expect(ins.saved).toBeNull();
  });

  it("returns all-null insight for an empty payload", () => {
    expect(parseInsightPayload({})).toEqual({
      views: null,
      reach: null,
      shares: null,
      saved: null,
      totalInteractions: null,
      avgWatchTimeMs: null,
    });
  });
});
