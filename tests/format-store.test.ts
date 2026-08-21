import { describe, it, expect } from "vitest";
import { formatStoreClicksMessage } from "../lib/format";
import type { StoreClicks } from "../lib/applink-store";

const FROM = new Date("2026-08-20T05:30:00Z");
const TO = new Date("2026-08-21T05:30:00Z");

const r = (slug: string, android: number, ios: number, desktop = 0): StoreClicks => ({
  slug,
  android,
  ios,
  desktop,
});

const build = (rows: StoreClicks[]) => formatStoreClicksMessage(rows, "Переходы в стор · за сутки", FROM, TO);

describe("сообщение о переходах в стор", () => {
  it("даёт по человеку сумму и разбивку по витринам", () => {
    const msg = build([r("bara", 87, 24)]);

    expect(msg).toContain("Бара — <b>111</b>");
    expect(msg).toContain("Play 87");
    expect(msg).toContain("App Store 24");
  });

  it("не показывает витрину, по которой никто не прошёл", () => {
    const msg = build([r("zahid", 1, 0)]);

    expect(msg).toContain("Захид — <b>1</b> (Play 1)");
    expect(msg).not.toContain("App Store 0");
  });

  it("у нуля скобок нет вовсе", () => {
    const msg = build([r("bara", 5, 0), r("quranyapp", 0, 0)]);

    expect(msg).toContain("@qurany_app — <b>0</b>\n");
    expect(msg).not.toMatch(/@qurany_app — <b>0<\/b> \(/);
  });

  it("считает тотал по всем витринам и всем людям", () => {
    const msg = build([r("bara", 87, 24), r("zahid", 1, 1), r("daristeppe", 1, 0)]);

    expect(msg).toContain("Σ ТОТАЛ — <b>114</b>");
  });

  it("компьютерные заходы выносит сноской и в тотал не берёт", () => {
    const msg = build([r("bara", 87, 24, 25), r("zahid", 1, 1, 4)]);

    expect(msg).toContain("Σ ТОТАЛ — <b>113</b>");
    expect(msg).toContain("29");
    expect(msg).toContain("компьютера");
  });

  it("без компьютерных заходов сноски нет", () => {
    expect(build([r("bara", 87, 24)])).not.toContain("компьютера");
  });

  it("пустые сутки называет прямо, а не пустотой", () => {
    const msg = build([r("bara", 0, 0), r("zahid", 0, 0)]);

    expect(msg).toContain("Пока нет переходов за период.");
    expect(msg).not.toContain("Σ ТОТАЛ");
  });

  it("подписывает период границами спринта по Джакарте", () => {
    const msg = build([r("bara", 1, 0)]);

    expect(msg).toContain("20.08.2026, 12:30");
    expect(msg).toContain("21.08.2026, 12:30");
    expect(msg).toContain("Джакарта");
  });

  it("незнакомый слаг подписывает им самим и экранирует разметку", () => {
    const msg = build([r("noviy", 2, 0)]);

    expect(msg).toContain("noviy — <b>2</b>");
  });
});
