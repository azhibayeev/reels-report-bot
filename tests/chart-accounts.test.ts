import { describe, it, expect } from "vitest";
import { buildFunnelChart, chartSkipReason } from "../lib/chart";
import { FunnelSeries } from "../lib/types";

const DAYS = ["2026-08-18", "2026-08-19"];
const series = (over: Partial<FunnelSeries> = {}): FunnelSeries => ({
  published: [],
  views: [],
  joins: [],
  store: [],
  ...over,
});

const full = series({
  published: [{ date: "2026-08-18", value: 5 }, { date: "2026-08-19", value: 6 }],
  views: [{ date: "2026-08-18", value: 1000 }, { date: "2026-08-19", value: 1500 }],
  joins: [{ date: "2026-08-19", value: 12 }],
  store: [{ date: "2026-08-19", value: 4 }],
});

describe("buildFunnelChart title", () => {
  it("names the account on the chart when asked", () => {
    const cfg = buildFunnelChart(DAYS, full, "Воронка за 14 дней · @qurany_app") as any;
    expect(cfg.options.plugins.title.text).toBe("Воронка за 14 дней · @qurany_app");
  });

  it("keeps the plain title by default and explains the three levels under it", () => {
    const cfg = buildFunnelChart(DAYS, full) as any;
    expect(cfg.options.plugins.title.text).toBe("Воронка за 14 дней");
    expect(cfg.options.plugins.subtitle.text).toContain("Вход");
    expect(cfg.options.plugins.subtitle.text).toContain("Выход");
  });
});

describe("buildFunnelChart with missing levels", () => {
  it("does not draw a line for a series that has no data at all", () => {
    // Первый день аккаунта: прирост просмотров считается между замерами, поэтому
    // точек по просмотрам ещё нет. Пустая легенда и шкала 0–1 читаются как поломка.
    const cfg = buildFunnelChart(DAYS, series({ joins: [{ date: "2026-08-19", value: 12 }] })) as any;

    expect(cfg.data.datasets.map((d: any) => d.label)).toEqual(["Заходы в сообщество"]);
    expect(Object.keys(cfg.options.scales)).toEqual(["x", "yOut"]);
    expect(cfg.options.scales.yOut.title.text).toBe("Выход/день");
  });

  it("drops the stacking when only one level is left", () => {
    // Один этаж делить по высоте не с кем: stack без соседей только путает Chart.js.
    const cfg = buildFunnelChart(DAYS, series({ published: [{ date: "2026-08-19", value: 5 }] })) as any;
    expect(cfg.options.scales.yIn.stack).toBeUndefined();
    expect(cfg.options.scales.yIn.stackWeight).toBeUndefined();
  });

  it("keeps both output series on one scale", () => {
    // Заходы и переходы в стор — числа одного порядка, две шкалы для них лишние.
    const cfg = buildFunnelChart(DAYS, full) as any;
    const out = cfg.data.datasets.filter((d: any) => d.yAxisID === "yOut");
    expect(out.map((d: any) => d.label)).toEqual(["Заходы в сообщество", "Переходы в стор"]);
  });
});

describe("chartSkipReason", () => {
  it("draws the chart as soon as one level has two points", () => {
    expect(chartSkipReason(full)).toBeNull();
    expect(
      chartSkipReason(series({ published: [{ date: "2026-08-18", value: 3 }, { date: "2026-08-19", value: 4 }] }))
    ).toBeNull();
  });

  it("explains the skip while an account is still collecting data", () => {
    // Первый день второго аккаунта: один замер и почти нет заходов — рисовать нечего.
    expect(chartSkipReason(series({ views: [{ date: "2026-08-19", value: 10 }] }))).toBe(
      "мало данных (дней с роликами: 0, с просмотрами: 1, с заходами: 0, с переходами в стор: 0)"
    );
  });
});
