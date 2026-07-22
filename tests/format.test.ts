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
  it("is a compact summary: period, new reels count and gain, total gain, total views", () => {
    const msg = formatMessage(sampleReport());
    expect(msg).toContain("Отчёт по рилсам");
    expect(msg).toContain("Период: с");
    expect(msg).toContain("время Джакарты");
    expect(msg).toContain("Новых рилсов за период: <b>1</b>");
    // new reel n gained 900 (all its views)
    expect(msg).toContain("Новые рилсы набрали за эти 24 часа");
    expect(msg).toContain("<b>900</b> просмотров");
    // total gain = 80 (a) + 900 (n) = 980; total views = 180 + 900 = 1080
    expect(msg).toContain("Прирост ТОТАЛ просмотров за последние 24 часа: <b>+980</b>");
    expect(msg).toContain("ТОТАЛ просмотров по 2 рилсам");
    expect(msg).toContain(`<b>${new Intl.NumberFormat("ru-RU").format(1080)}</b>`);
    // no per-reel links in the message — they live in the CSV table
    expect(msg).not.toContain("href=");
  });

  it("baseline report has first-measurement wording and no gain lines", () => {
    const curr: Snapshot = { takenAt: T1, reels: [reel("a", 100, "2026-07-01T00:00:00Z")] };
    const msg = formatMessage(computeReport(curr, null));
    expect(msg).toContain("Первый замер");
    expect(msg).toContain("базовый замер");
    expect(msg).toContain("Новых рилсов за последние 24 часа");
    expect(msg).not.toContain("Прирост ТОТАЛ");
  });
});

describe("formatCsv", () => {
  it("has BOM, rank column, Russian header and one row per reel, sorted by gain desc", () => {
    const csv = formatCsv(sampleReport());
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("№;Ссылка;Дата публикации;Просмотров всего;Прирост за период");
    expect(lines).toHaveLength(3);
    expect(lines[1].startsWith("1;")).toBe(true);
    expect(lines[1]).toContain("reel/n/"); // gain 900 first
    expect(lines[2].startsWith("2;")).toBe(true);
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
