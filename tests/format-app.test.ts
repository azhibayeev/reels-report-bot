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
    expect(m).toContain("Новые установки: <b>87</b> (-3 к 03.10)");
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

  it("экранирует HTML в названиях функций", () => {
    const m = formatAppMessage(stats({ features: [{ name: "A<b>", users: 1 }] }));
    expect(m).toContain("A&lt;b&gt;");
  });
});

describe("скачивания из сторов в сообщении", () => {
  it("каждый стор — со своей датой отчёта и пометкой, что это последний готовый день", () => {
    const m = formatAppMessage(stats(), {
      appStore: { status: "ok", date: "2026-10-03", downloads: 7, redownloads: 5 },
      play: { status: "ok", date: "2026-10-02", downloads: 198 },
    });

    expect(m).toContain("последний готовый отчёт");
    // App Store: всего = первые + повторные (Total Downloads в App Store Connect).
    expect(m).toContain("App Store: <b>12</b> скачиваний (7 новых + 5 повторных) · отчёт за 03.10");
    expect(m).toContain("Google Play: <b>198</b> новых · отчёт за 02.10");
  });

  it("без повторных — итог без разбивки", () => {
    const m = formatAppMessage(stats(), {
      appStore: { status: "ok", date: "2026-10-03", downloads: 7, redownloads: 0 },
      play: { status: "off" },
    });
    expect(m).toContain("App Store: <b>7</b> скачиваний · отчёт за 03.10");
  });

  it("не подключённый стор не печатается, ошибка называется прямо", () => {
    const m = formatAppMessage(stats(), {
      appStore: { status: "error", message: "App Store Connect 401: <bad>" },
      play: { status: "off" },
    });

    expect(m).toContain("App Store: нет данных (App Store Connect 401: &lt;bad&gt;)");
    expect(m).not.toContain("Google Play");
  });

  it("ни одного подключённого стора — блока нет вовсе", () => {
    expect(formatAppMessage(stats())).not.toContain("сторов");
    expect(formatAppMessage(stats(), { appStore: { status: "off" }, play: { status: "off" } })).not.toContain("сторов");
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
