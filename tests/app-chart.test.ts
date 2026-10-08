import { describe, it, expect } from "vitest";
import { appChartSkipReason, buildAppChart } from "../lib/chart";

const DAYS = ["2026-10-02", "2026-10-03", "2026-10-04"];

type Dataset = { type: string; label: string; data: (number | null)[]; yAxisID: string };

describe("график приложения", () => {
  const config = buildAppChart(
    DAYS,
    DAYS.map((date, i) => ({ date, value: 100 + i })),
    DAYS.map((date, i) => ({ date, value: i }))
  ) as { data: { labels: string[]; datasets: Dataset[] }; options: { scales: Record<string, unknown> } };

  it("DAU — линия, установки — столбики, на общей оси дней", () => {
    expect(config.data.labels).toEqual(["02.10", "03.10", "04.10"]);
    const [dau, installs] = config.data.datasets;
    expect(dau).toMatchObject({ type: "line", label: "DAU", data: [100, 101, 102] });
    expect(installs).toMatchObject({ type: "bar", label: "Новые установки", data: [0, 1, 2] });
  });

  it("у каждого ряда своя шкала: сотни DAU не сплющивают единицы установок", () => {
    const [dau, installs] = config.data.datasets;
    expect(dau.yAxisID).not.toBe(installs.yAxisID);
    expect(config.options.scales[dau.yAxisID]).toBeDefined();
    expect(config.options.scales[installs.yAxisID]).toBeDefined();
  });
});

describe("appChartSkipReason", () => {
  it("один день — не график", () => {
    expect(appChartSkipReason([{ date: "2026-10-04", value: 5 }])).toMatch(/мало данных/);
  });

  it("одни нули — не график", () => {
    expect(appChartSkipReason(DAYS.map((date) => ({ date, value: 0 })))).toMatch(/мало данных/);
  });

  it("два дня с пользователями — рисуем", () => {
    expect(
      appChartSkipReason([
        { date: "2026-10-03", value: 0 },
        { date: "2026-10-04", value: 3 },
        { date: "2026-10-02", value: 4 },
      ])
    ).toBeNull();
  });
});
