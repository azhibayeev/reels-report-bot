import { describe, it, expect } from "vitest";
import { formatMessage, formatCsv, escapeHtml } from "../lib/format";
import { computeReport } from "../lib/diff";
import { ReelSnapshot, Snapshot } from "../lib/types";

function reel(id: string, views: number, publishedAt: string, caption = `Рилс ${id}`): ReelSnapshot {
  return { id, views, publishedAt, caption, permalink: `https://www.instagram.com/reel/${id}/` };
}

const T0 = "2026-07-19T05:30:00Z";
const T1 = "2026-07-20T05:30:00Z";

function sampleReport() {
  const prev: Snapshot = { takenAt: T0, reels: [reel("a", 100, "2026-07-01T00:00:00Z")] };
  const curr: Snapshot = {
    takenAt: T1,
    reels: [reel("a", 180, "2026-07-01T00:00:00Z"), reel("n", 900, "2026-07-19T10:00:00Z")],
  };
  return computeReport(curr, prev);
}

describe("formatMessage", () => {
  it("includes Russian header, totals, new reels and top with links", () => {
    const msg = formatMessage(sampleReport());
    expect(msg).toContain("Отчёт по рилсам");
    expect(msg).toContain("время Джакарты");
    expect(msg).toContain("Новых рилсов за период: <b>1</b>");
    expect(msg).toContain('href="https://www.instagram.com/reel/n/"');
    expect(msg).toContain("Топ-2 по приросту");
    // top sorted: new reel n (gain 900) before a (gain 80)
    expect(msg.indexOf("reel/n/")).toBeLessThan(msg.lastIndexOf("reel/a/"));
  });

  it("baseline report explains that gains start tomorrow and has no top section", () => {
    const curr: Snapshot = { takenAt: T1, reels: [reel("a", 100, "2026-07-01T00:00:00Z")] };
    const msg = formatMessage(computeReport(curr, null));
    expect(msg).toContain("базовый замер");
    expect(msg).not.toContain("Топ-");
  });

  it("caps the new-reels list at 20 with a remainder line", () => {
    const prev: Snapshot = { takenAt: T0, reels: [] };
    const curr: Snapshot = {
      takenAt: T1,
      reels: Array.from({ length: 25 }, (_, i) => reel(`n${i}`, i, "2026-07-19T10:00:00Z")),
    };
    const msg = formatMessage(computeReport(curr, prev));
    expect(msg).toContain("… и ещё 5");
  });

  it("escapes HTML in captions", () => {
    const prev: Snapshot = { takenAt: T0, reels: [] };
    const curr: Snapshot = { takenAt: T1, reels: [reel("x", 5, "2026-07-19T10:00:00Z", "<b>жирный & смелый</b>")] };
    const msg = formatMessage(computeReport(curr, prev));
    expect(msg).toContain("&lt;b&gt;жирный &amp; смелый&lt;/b&gt;");
  });
});

describe("formatCsv", () => {
  it("has BOM, Russian header and one row per reel, sorted by gain desc", () => {
    const csv = formatCsv(sampleReport());
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("Ссылка;Дата публикации;Просмотров всего;Прирост за период");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("reel/n/"); // gain 900 first
    expect(lines[2]).toContain("reel/a/");
  });

  it("quotes cells containing the delimiter", () => {
    expect(formatCsv(sampleReport())).not.toContain('""'); // sanity: no accidental quoting
  });
});

describe("escapeHtml", () => {
  it("escapes &, <, >", () => {
    expect(escapeHtml('a & <b> "q"')).toBe('a &amp; &lt;b&gt; "q"');
  });
});
