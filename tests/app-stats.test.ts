import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { APP_FEATURES, appReportDay, featureLabelSql, getAppStats } from "../lib/app-stats";

// Крон в 12:45 Джакарты = 05:45 UTC.
const NOW = new Date("2026-10-05T05:45:00Z");

describe("appReportDay", () => {
  it("берёт вчерашние сутки Джакарты целиком", () => {
    const d = appReportDay(NOW);
    expect(d.day).toBe("2026-10-04");
    expect(new Date(d.from * 1000).toISOString()).toBe("2026-10-03T17:00:00.000Z");
    expect(new Date(d.to * 1000).toISOString()).toBe("2026-10-04T17:00:00.000Z");
  });

  it("сразу после полуночи Джакарты отчётный день — только что закончившийся", () => {
    expect(appReportDay(new Date("2026-10-04T17:00:00Z")).day).toBe("2026-10-04");
  });
});

describe("featureLabelSql", () => {
  it("даёт каждой функции свою ветку и пустую метку всему остальному", () => {
    const sql = featureLabelSql();
    expect(sql.startsWith("multiIf(")).toBe(true);
    for (const f of APP_FEATURES) expect(sql).toContain(`'${f.name}'`);
    expect(sql.endsWith(", '')")).toBe(true);
  });

  it("включает функции из читалки, про которые спрашивали", () => {
    const names = APP_FEATURES.map((f) => f.name);
    for (const n of ["Тафсир", "Заметка к аяту", "Поделиться аятом", "Произношение слова", "Пауза приложений"]) {
      expect(names).toContain(n);
    }
  });

  it("названия не ломают строковый литерал HogQL", () => {
    for (const f of APP_FEATURES) expect(f.name).not.toMatch(/['\\]/);
  });
});

describe("getAppStats", () => {
  const queries: string[] = [];
  const urls: string[] = [];

  beforeEach(() => {
    queries.length = 0;
    urls.length = 0;
    vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "phx_test");
    vi.stubEnv("POSTHOG_PROJECT_ID", "111");
    vi.stubEnv("POSTHOG_APP_PROJECT_ID", "222");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        urls.push(url);
        const q = JSON.parse(init.body).query.query as string;
        queries.push(q);
        let results: unknown[][];
        if (q.includes("minIf(")) {
          // Новые установки: 03.10 — 5, 04.10 — 9.
          results = [["2026-10-03", 5], ["2026-10-04", 9]];
        } else if (q.includes("multiIf(")) {
          results = [["", 999], ["Аудио", 40], ["Чтение", 120], ["Тафсир", 40], ["Хатм", 75]];
        } else if (q.includes("GROUP BY d")) {
          // DAU: дня 02.10 в ответе нет вовсе (ни одного события).
          results = [["2026-09-21", 100], ["2026-10-03", 180], ["2026-10-04", 200]];
        } else {
          results = [[1500]]; // MAU
        }
        return new Response(JSON.stringify({ results }), { status: 200 });
      })
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("собирает DAU, MAU, установки и функции за вчера", async () => {
    const s = await getAppStats(NOW);

    expect(s.day).toBe("2026-10-04");
    expect(s.dau).toBe(200);
    expect(s.prevDau).toBe(180);
    expect(s.mau).toBe(1500);
    expect(s.newInstalls).toBe(9);
    expect(s.prevNewInstalls).toBe(5);
  });

  it("сортирует функции по людям и выкидывает события вне списка", async () => {
    const s = await getAppStats(NOW);
    // Ничья (Аудио и Тафсир по 40) решается по алфавиту — порядок не прыгает между запусками.
    expect(s.features).toEqual([
      { name: "Чтение", users: 120 },
      { name: "Хатм", users: 75 },
      { name: "Аудио", users: 40 },
      { name: "Тафсир", users: 40 },
    ]);
  });

  it("ряды за 14 дней без дыр: нет событий за день — ноль", async () => {
    const s = await getAppStats(NOW);
    expect(s.dauSeries).toHaveLength(14);
    expect(s.dauSeries[0]).toEqual({ date: "2026-09-21", value: 100 });
    expect(s.dauSeries.at(-1)).toEqual({ date: "2026-10-04", value: 200 });
    expect(s.dauSeries.find((p) => p.date === "2026-10-02")).toEqual({ date: "2026-10-02", value: 0 });
    expect(s.installSeries).toHaveLength(14);
    expect(s.installSeries.at(-1)).toEqual({ date: "2026-10-04", value: 9 });
  });

  it("ходит в проект приложения и считает только production", async () => {
    await getAppStats(NOW);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toContain("/api/projects/222/query/");
    for (const q of queries) expect(q).toContain("properties.environment = 'production'");
  });

  it("без отдельного проекта приложения берёт общий POSTHOG_PROJECT_ID", async () => {
    vi.stubEnv("POSTHOG_APP_PROJECT_ID", "");
    await getAppStats(NOW);
    for (const u of urls) expect(u).toContain("/api/projects/111/query/");
  });

  it("пустой ответ PostHog — нули, а не падение", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }))
    );
    const s = await getAppStats(NOW);
    expect(s.dau).toBe(0);
    expect(s.mau).toBe(0);
    expect(s.features).toEqual([]);
  });
});
