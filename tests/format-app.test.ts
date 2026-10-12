import { describe, it, expect } from "vitest";
import type { AppStats } from "../lib/app-stats";
import { formatAppCaption, formatAppMessage } from "../lib/format";

const nf = new Intl.NumberFormat("ru-RU");

const stats = (over: Partial<AppStats> = {}): AppStats => ({
  day: "2026-10-04",
  dau: 1234,
  prevDau: 1180,
  mau: 9876,
  newInstalls: 87,
  prevNewInstalls: 90,
  features: [
    { name: "Чтение", users: 812 },
    { name: "Хатм", users: 301 },
    { name: "Аудио", users: 150 },
    { name: "Тафсир", users: 99 },
    { name: "Произношение слова", users: 64 },
    { name: "Поиск", users: 12 },
  ],
  modes: [],
  pause: { users: 0, pulled: 0, pulledTimes: 0, enabled: 0, disabled: 0 },
  dauSeries: [],
  installSeries: [],
  ...over,
});

describe("сообщение по приложению", () => {
  it("печатает DAU, MAU, липкость и установки за отчётный день", () => {
    const m = formatAppMessage(stats());

    expect(m).toContain("04.10");
    expect(m).toContain(`DAU: <b>${nf.format(1234)}</b> (+54 к 03.10)`);
    expect(m).toContain(`MAU: <b>${nf.format(9876)}</b>`);
    expect(m).toContain("DAU/MAU <b>12%</b>");
    expect(m).toContain("Первые открытия: <b>87</b> (-3 к 03.10)");
  });

  it("показывает ровно пять функций с долей от DAU", () => {
    const m = formatAppMessage(stats());

    expect(m).toContain("Топ-5 функций");
    expect(m).toContain("1. Чтение — <b>812</b> (66%)");
    expect(m).toContain("5. Произношение слова — <b>64</b> (5%)");
    expect(m).not.toContain("Поиск");
  });

  it("без единого пользователя не делит на ноль", () => {
    const m = formatAppMessage(stats({ dau: 0, prevDau: 0, mau: 0, newInstalls: 0, prevNewInstalls: 0, features: [] }));

    expect(m).toContain("DAU: <b>0</b>");
    expect(m).not.toContain("NaN");
    expect(m).not.toContain("Infinity");
    expect(m).not.toContain("DAU/MAU");
    expect(m).toContain("за день никто не пользовался");
  });

  it("режимы чтения — одной строкой с долей от DAU", () => {
    const m = formatAppMessage(
      stats({
        dau: 773,
        modes: [
          { name: "Guided", users: 420 },
          { name: "Mushaf", users: 348 },
          { name: "Suflor", users: 48 },
        ],
      })
    );
    expect(m).toContain("📖 <b>Режимы чтения</b>: Guided <b>420</b> (54%) · Mushaf <b>348</b> (45%) · Suflor <b>48</b> (6%)");
  });

  it("пауза приложений — своей строкой всегда, даже с нулями", () => {
    const m = formatAppMessage(stats({ pause: { users: 11, pulled: 7, pulledTimes: 13, enabled: 1, disabled: 0 } }));
    expect(m).toContain(
      "⏸ <b>Пауза приложений</b>: пользовались <b>11</b> · вернула к чтению <b>7</b> (открытий: 13) · включили <b>1</b> · выключили <b>0</b>"
    );
    expect(formatAppMessage(stats())).toContain("⏸ <b>Пауза приложений</b>: пользовались <b>0</b>");
  });

  it("без чтения за день строки режимов нет", () => {
    expect(formatAppMessage(stats({ modes: [] }))).not.toContain("Режимы чтения");
  });

  it("экранирует HTML в названиях функций", () => {
    const m = formatAppMessage(stats({ features: [{ name: "A<b>", users: 1 }] }));
    expect(m).toContain("A&lt;b&gt;");
  });
});

describe("скачивания из сторов в сообщении", () => {
  // Отчётный день сводки — 04.10; сторы запаздывают: App Store готов по 03.10, Play — по 02.10.
  const both = {
    appStore: { status: "ok", date: "2026-10-03", day: 12, total: 8000 },
    play: { status: "ok", date: "2026-10-02", day: 198, total: 12210 },
  } as const;

  it("первая строка — всего скачиваний за всё время рядом с DAU", () => {
    const m = formatAppMessage(stats(), both);
    expect(m).toContain(`⬇️ Всего скачиваний: <b>${nf.format(20210)}</b> · 👤 DAU: <b>${nf.format(1234)}</b> (+54 к 03.10)`);
  });

  it("по стору — всего и «+» за его последний готовый день, опоздание помечено", () => {
    const m = formatAppMessage(stats(), both);
    expect(m).toContain(`🍏 App Store: <b>${nf.format(8000)}</b> · +12 за 03.10 <i>(стор отдаёт с опозданием)</i>`);
    expect(m).toContain(`🤖 Google Play: <b>${nf.format(12210)}</b> · +198 за 02.10 <i>(стор отдаёт с опозданием)</i>`);
  });

  it("стор успел к отчётному дню — без пометки об опоздании", () => {
    const m = formatAppMessage(stats(), { ...both, play: { status: "ok", date: "2026-10-04", day: 5, total: 100 } });
    expect(m).toContain("🤖 Google Play: <b>100</b> · +5 за 04.10\n");
  });

  it("стор с ошибкой: строка с причиной, итог помечен, что он без этого стора", () => {
    const m = formatAppMessage(stats(), {
      appStore: both.appStore,
      play: { status: "error", message: "нет доступа к бакету <x> (403)" },
    });
    expect(m).toContain(`⬇️ Всего скачиваний: <b>${nf.format(8000)}</b> <i>(без Google Play)</i> · 👤 DAU`);
    expect(m).toContain("🤖 Google Play: нет данных (нет доступа к бакету &lt;x&gt; (403))");
  });

  it("не подключённый стор не печатается и итог не помечает", () => {
    const m = formatAppMessage(stats(), { appStore: both.appStore, play: { status: "off" } });
    expect(m).not.toContain("Google Play");
    expect(m).toContain(`⬇️ Всего скачиваний: <b>${nf.format(8000)}</b> · 👤 DAU`);
  });

  it("ни одного подключённого стора — строка DAU как была, без скачиваний", () => {
    for (const m of [formatAppMessage(stats()), formatAppMessage(stats(), { appStore: { status: "off" }, play: { status: "off" } })]) {
      expect(m).not.toContain("скачиваний");
      expect(m).toContain(`👤 DAU: <b>${nf.format(1234)}</b> (+54 к 03.10)`);
    }
  });
});

describe("подпись к графику приложения", () => {
  it("называет окно и оба ряда", () => {
    const c = formatAppCaption(stats(), 14);
    expect(c).toContain("14 дней");
    expect(c).toContain("DAU");
    expect(c).toContain("новые установки");
  });
});
