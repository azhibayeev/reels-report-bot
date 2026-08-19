import { describe, it, expect } from "vitest";
import { buildTrendChart, chartSkipReason } from "../lib/chart";
import { DayPoint } from "../lib/types";

const views: DayPoint[] = [
  { date: "2026-08-18", value: 1000 },
  { date: "2026-08-19", value: 1500 },
];
const clicks: DayPoint[] = [{ date: "2026-08-19", value: 12 }];

describe("buildTrendChart title", () => {
  it("names the account on the chart when asked", () => {
    const cfg = buildTrendChart(views, clicks, "Динамика за 14 дней · @qurany_app") as any;
    expect(cfg.options.plugins.title.text).toBe("Динамика за 14 дней · @qurany_app");
  });

  it("keeps the plain title by default", () => {
    const cfg = buildTrendChart(views, clicks) as any;
    expect(cfg.options.plugins.title.text).toBe("Динамика за 14 дней");
  });
});

describe("buildTrendChart with one empty series", () => {
  it("does not draw a line for a series that has no data at all", () => {
    // Первый день аккаунта: прирост просмотров считается между замерами, поэтому
    // точек по просмотрам ещё нет. Пустая легенда и шкала 0–1 читаются как поломка.
    const cfg = buildTrendChart([], clicks) as any;

    expect(cfg.data.datasets.map((d: any) => d.label)).toEqual(["Заходы за день"]);
    expect(Object.keys(cfg.options.scales)).toEqual(["y"]);
    expect(cfg.options.scales.y.title.text).toBe("Заходы/день");
  });

  it("keeps the lone views line on the left axis too", () => {
    const cfg = buildTrendChart(views, []) as any;

    expect(cfg.data.datasets.map((d: any) => d.label)).toEqual(["Просмотры за день"]);
    expect(Object.keys(cfg.options.scales)).toEqual(["y"]);
    expect(cfg.options.scales.y.title.text).toBe("Просмотры/день");
  });

  it("still puts views left and clicks right when both have data", () => {
    const cfg = buildTrendChart(views, clicks) as any;
    expect(cfg.data.datasets.map((d: any) => d.label)).toEqual(["Просмотры за день", "Заходы за день"]);
    expect(cfg.options.scales.y.position).toBe("left");
    expect(cfg.options.scales.y1.position).toBe("right");
  });
});

describe("chartSkipReason", () => {
  it("draws the chart as soon as one line has two points", () => {
    expect(chartSkipReason(views, [])).toBeNull();
    expect(chartSkipReason([], [{ date: "2026-08-18", value: 3 }, { date: "2026-08-19", value: 4 }])).toBeNull();
  });

  it("explains the skip while an account is still collecting data", () => {
    // Первый день второго аккаунта: один замер и почти нет заходов — рисовать нечего.
    expect(chartSkipReason([{ date: "2026-08-19", value: 10 }], [])).toBe(
      "мало данных (дней с просмотрами: 1, с заходами: 0)"
    );
  });
});
