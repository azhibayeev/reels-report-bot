import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildFunnelChart,
  computeDailyPublished,
  computeDailyViewGains,
  renderChartPng,
} from "../lib/chart";
import { FunnelSeries, Snapshot } from "../lib/types";

function snap(takenAt: string, ...views: number[]): Snapshot {
  return {
    takenAt,
    reels: views.map((v, i) => ({
      id: `r${i}`,
      permalink: `https://www.instagram.com/reel/r${i}/`,
      publishedAt: "2026-07-01T00:00:00Z",
      caption: "",
      views: v,
    })),
  };
}

const DAYS = ["2026-07-20", "2026-07-21"];
const series = (over: Partial<FunnelSeries> = {}): FunnelSeries => ({
  published: [],
  views: [],
  joins: [],
  store: [],
  ...over,
});

describe("computeDailyViewGains", () => {
  it("returns daily total-view gains between consecutive snapshots", () => {
    const snaps: Snapshot[] = [
      snap("2026-07-19T05:30:00Z", 100), // total 100
      snap("2026-07-20T05:30:00Z", 180), // total 180 → gain 80
      snap("2026-07-21T05:30:00Z", 200, 50), // total 250 → gain 70
    ];
    expect(computeDailyViewGains(snaps)).toEqual([
      { date: "2026-07-20", value: 80 },
      { date: "2026-07-21", value: 70 },
    ]);
  });

  it("returns [] when fewer than 2 snapshots", () => {
    expect(computeDailyViewGains([])).toEqual([]);
    expect(computeDailyViewGains([snap("2026-07-20T05:30:00Z", 100)])).toEqual([]);
  });
});

describe("computeDailyPublished", () => {
  // Снапшот из одних дат публикации: для входа воронки больше ничего не нужно.
  const published = (takenAt: string, ...reels: Array<[string, string]>): Snapshot => ({
    takenAt,
    reels: reels.map(([id, publishedAt]) => ({ id, permalink: "", publishedAt, caption: "", views: 0 })),
  });

  it("counts reels by the sprint day they were published in", () => {
    // Сутки отчёта: 12:30 Джакарты → 12:30. Ролик, вышедший вечером 25-го (13:00 UTC),
    // относится к суткам, которые закрылись 26-го, — как и прирост просмотров за них.
    const points = computeDailyPublished([
      published(
        "2026-08-26T05:30:00Z",
        ["a", "2026-08-25T04:00:00+0000"], // 11:00 Джакарты 25-го → сутки 25-го
        ["b", "2026-08-25T13:00:00+0000"], // 20:00 Джакарты 25-го → сутки 26-го
        ["c", "2026-08-26T01:00:00+0000"] // 08:00 Джакарты 26-го → сутки 26-го
      ),
    ]);
    expect(points).toEqual([
      { date: "2026-08-25", value: 1 },
      { date: "2026-08-26", value: 2 },
    ]);
  });

  it("keeps the 12:30 boundary itself in the next sprint", () => {
    // 05:30 UTC = ровно 12:30 Джакарты: замер этого момента закрывает прошлые сутки,
    // значит сам ролик принадлежит уже следующим.
    expect(
      computeDailyPublished([published("2026-08-26T05:30:00Z", ["a", "2026-08-26T05:30:00+0000"])])
    ).toEqual([{ date: "2026-08-27", value: 1 }]);
  });

  it("counts one reel once, in how many snapshots it ever appeared", () => {
    const day = ["a", "2026-08-26T01:00:00+0000"] as [string, string];
    const points = computeDailyPublished([
      published("2026-08-26T05:30:00Z", day),
      published("2026-08-27T05:30:00Z", day),
    ]);
    expect(points).toEqual([{ date: "2026-08-26", value: 1 }]);
  });

  it("keeps a deleted reel in the day it was published", () => {
    // Ролик сняли за музыку — из свежего замера он исчез. Если считать только по нему,
    // вчерашний столбик входа завтра станет ниже, и картинки перестанут сходиться.
    const points = computeDailyPublished([
      published("2026-08-26T05:30:00Z", ["a", "2026-08-26T01:00:00+0000"], ["b", "2026-08-26T02:00:00+0000"]),
      published("2026-08-27T05:30:00Z", ["a", "2026-08-26T01:00:00+0000"]),
    ]);
    expect(points).toEqual([{ date: "2026-08-26", value: 2 }]);
  });

  it("skips reels with an unparsable timestamp instead of dropping the chart", () => {
    const points = computeDailyPublished([
      published("2026-08-26T05:30:00Z", ["a", ""], ["b", "2026-08-26T01:00:00+0000"]),
    ]);
    expect(points).toEqual([{ date: "2026-08-26", value: 1 }]);
  });
});

describe("buildFunnelChart", () => {
  it("puts every level on its own stacked scale: reels on top, then views, then outputs", () => {
    const cfg = buildFunnelChart(
      DAYS,
      series({
        published: [{ date: "2026-07-20", value: 5 }],
        views: [{ date: "2026-07-21", value: 100 }],
        joins: [{ date: "2026-07-21", value: 12 }],
        store: [{ date: "2026-07-21", value: 3 }],
      })
    ) as any;

    expect(cfg.data.labels).toEqual(["20.07", "21.07"]);
    // Порядок наборов = порядок воронки, он же порядок легенды.
    expect(cfg.data.datasets.map((d: any) => d.label)).toEqual([
      "Ролики за день",
      "Просмотры за день",
      "Заходы в сообщество",
      "Переходы в стор",
    ]);
    expect(cfg.data.datasets.map((d: any) => d.yAxisID)).toEqual(["yIn", "yMid", "yOut", "yOut"]);
    // Вход — столбики, остальное — линии.
    expect(cfg.data.datasets.map((d: any) => d.type)).toEqual(["bar", "line", "line", "line"]);
    // Шкалы объявлены снизу вверх: выход → просмотры → ролики.
    expect(Object.keys(cfg.options.scales)).toEqual(["x", "yOut", "yMid", "yIn"]);
    for (const id of ["yIn", "yMid", "yOut"]) {
      expect(cfg.options.scales[id].stack).toBe("funnel");
      expect(cfg.options.scales[id].stackWeight).toBeGreaterThan(0);
    }
  });

  it("keeps tick labels whole and lets only the bottom level print its zero", () => {
    // Этажи стоят вплотную и делят колонку подписей: «0» верхнего этажа печатался бы
    // поверх верхнего деления соседа снизу. И деления тут — штуки, дробных не бывает.
    const cfg = buildFunnelChart(
      DAYS,
      series({
        published: [{ date: "2026-07-20", value: 5 }],
        views: [{ date: "2026-07-21", value: 100 }],
        joins: [{ date: "2026-07-21", value: 3 }],
      })
    ) as any;

    for (const id of ["yIn", "yMid", "yOut"]) {
      expect(cfg.options.scales[id].ticks.precision).toBe(0);
      // count жёстко делит диапазон и даёт дробные деления вроде «7,5 роликов».
      expect(cfg.options.scales[id].ticks.count).toBeUndefined();
      expect(cfg.options.scales[id].ticks.maxTicksLimit).toBeGreaterThan(3);
    }
    // Нижний этаж — выход: он единственный со свободным местом под подпись нуля.
    expect(cfg.options.scales.yOut.ticks.callback).toBeUndefined();
    expect(cfg.options.scales.yMid.ticks.callback).toBeDefined();
    expect(cfg.options.scales.yIn.ticks.callback).toBeDefined();
  });

  it("aligns each series to the day axis and leaves gaps as null", () => {
    const cfg = buildFunnelChart(
      DAYS,
      series({
        published: [{ date: "2026-07-20", value: 5 }],
        views: [{ date: "2026-07-21", value: 100 }],
      })
    ) as any;

    expect(cfg.data.datasets[0].data).toEqual([5, null]);
    expect(cfg.data.datasets[1].data).toEqual([null, 100]);
  });

  it("ignores days outside the axis", () => {
    const cfg = buildFunnelChart(
      DAYS,
      series({ published: [{ date: "2026-07-19", value: 9 }, { date: "2026-07-20", value: 5 }] })
    ) as any;
    expect(cfg.data.datasets[0].data).toEqual([5, null]);
  });

  it("labels the short series and keeps seven-digit views clean", () => {
    const cfg = buildFunnelChart(
      DAYS,
      series({
        published: [{ date: "2026-07-20", value: 5 }],
        views: [{ date: "2026-07-21", value: 1_066_409 }],
        joins: [{ date: "2026-07-21", value: 12 }],
      })
    ) as any;

    const byLabel = Object.fromEntries(cfg.data.datasets.map((d: any) => [d.label, d.datalabels]));
    expect(byLabel["Ролики за день"].display).toBe("auto");
    expect(byLabel["Заходы в сообщество"].display).toBe("auto");
    expect(byLabel["Просмотры за день"].display).toBe(false);
  });
});

describe("renderChartPng", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests QuickChart with Chart.js version 4 (config uses v3/v4 scale syntax)", async () => {
    let sentUrl = "";
    let sentBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: any) => {
        sentUrl = String(url);
        sentBody = init.body as string;
        return { ok: true, arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer } as any;
      })
    );

    const png = await renderChartPng(
      buildFunnelChart(DAYS, series({ views: [{ date: "2026-07-20", value: 1 }] }))
    );

    expect(sentUrl).toContain("quickchart.io/chart");
    const body = JSON.parse(sentBody);
    expect(body.version).toBe("4");
    // Трём этажам нужна высота: на 500 пикселях выход схлопывается в полосу.
    expect(body.height).toBeGreaterThanOrEqual(600);
    expect(Buffer.isBuffer(png)).toBe(true);
  });

  it("inlines the zero-hiding formatter instead of shipping the marker", async () => {
    let sentBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: any) => {
        sentBody = init.body as string;
        return { ok: true, arrayBuffer: async () => new Uint8Array([137]).buffer } as any;
      })
    );

    await renderChartPng(
      buildFunnelChart(DAYS, series({ store: [{ date: "2026-07-20", value: 0 }, { date: "2026-07-21", value: 4 }] }))
    );

    const chart = JSON.parse(sentBody).chart as string;
    // Конфиг едет строкой: иначе QuickChart прочитает функцию как строку и подпишет ноль.
    expect(typeof chart).toBe("string");
    expect(chart).toContain("(v)=>(v===0?'':v)");
    expect(chart).not.toContain("__hide_zero__");
    expect(chart).not.toContain("__hide_lowest_tick__");
  });
});
