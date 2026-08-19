import { describe, it, expect } from "vitest";
import { computeReport } from "../lib/diff";
import { formatInfoMessage, formatMessage, formatNowMessage } from "../lib/format";
import { Snapshot } from "../lib/types";

function snap(takenAt: string, views: number): Snapshot {
  return {
    takenAt,
    followersCount: 1162,
    reels: [
      { id: "r1", permalink: "https://ig/r1", publishedAt: "2026-08-01T00:00:00Z", caption: "", views },
    ],
  };
}

const prev = snap("2026-08-18T05:30:00Z", 100);
const curr = snap("2026-08-19T05:30:00Z", 180);

describe("account label in report headers", () => {
  it("marks the daily report with the account it is about", () => {
    const msg = formatMessage(computeReport(curr, prev), null, "@qurany_app");
    expect(msg.split("\n")[0]).toContain("Отчёт по рилсам · @qurany_app");
  });

  it("marks /now and /info answers too", () => {
    expect(formatNowMessage(computeReport(curr, prev), "@qurany_app").split("\n")[0]).toContain(
      "Отчёт на сейчас · @qurany_app"
    );
    expect(formatInfoMessage(curr, "@qurany_app").split("\n")[0]).toContain(
      "Общая статистика · @qurany_app"
    );
  });

  it("leaves the headers unchanged when no account is named", () => {
    expect(formatMessage(computeReport(curr, prev)).split("\n")[0]).toBe("📊 <b>Отчёт по рилсам</b>");
    expect(formatNowMessage(computeReport(curr, prev)).split("\n")[0]).toBe("⚡️ <b>Отчёт на сейчас</b>");
    expect(formatInfoMessage(curr).split("\n")[0]).toBe("📈 <b>Общая статистика</b>");
  });
});
