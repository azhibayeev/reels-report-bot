import { describe, it, expect, vi, beforeEach } from "vitest";

// Тот же стор блобов, что и в applink-window: list() умеет постраничность,
// а считаем мы по именам файлов, не скачивая тела.
const store = vi.hoisted(() => ({ blobs: [] as string[], bodies: 0, pageSize: 1000 }));

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async () => ({ url: "https://blob.test/x" })),
  list: vi.fn(async (opts: { prefix: string; cursor?: string; mode?: string }) => {
    const matched = store.blobs.filter((p) => p.startsWith(opts.prefix)).sort();
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const page = matched.slice(start, start + store.pageSize);
    const end = start + page.length;
    const hasMore = end < matched.length;
    return { blobs: page.map((pathname) => ({ pathname })), cursor: hasMore ? String(end) : undefined, hasMore };
  }),
}));

const { loadDailyStoreClicks } = await import("../lib/applink-store");

function click(slug: string, platform: string, iso: string): void {
  const at = new Date(iso);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(at);
  store.blobs.push(`applink/${slug}/${day}/${platform}-${at.getTime()}-rAnd0m.json`);
}

beforeEach(() => {
  store.blobs.length = 0;
  store.bodies = 0;
  store.pageSize = 1000;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      store.bodies += 1;
      return { ok: true, json: async () => ({}) } as never;
    })
  );
});

// Окно графика: трое суток по 12:30 Джакарты (05:30 UTC) → дни 19, 20 и 21 августа.
const FROM = new Date("2026-08-18T05:30:00Z");
const TO = new Date("2026-08-21T05:30:00Z");

describe("переходы в стор по дням", () => {
  it("раскладывает клики по суткам 12:30→12:30, а не по календарным дням", async () => {
    // Оба клика — 20.08 по календарю Джакарты, но по разные стороны от 12:30.
    click("bara", "android", "2026-08-20T04:00:00Z"); // 11:00 Джакарты → сутки 20.08
    click("bara", "android", "2026-08-20T06:00:00Z"); // 13:00 Джакарты → сутки 21.08

    const points = await loadDailyStoreClicks(["bara"], FROM, TO);

    expect(points).toEqual([
      { date: "2026-08-19", value: 0 },
      { date: "2026-08-20", value: 1 },
      { date: "2026-08-21", value: 1 },
    ]);
  });

  it("отдаёт нули за дни без переходов: разрыв линии читался бы как «не мерили»", async () => {
    const points = await loadDailyStoreClicks(["bara"], FROM, TO);
    expect(points.map((p) => p.value)).toEqual([0, 0, 0]);
    expect(points.map((p) => p.date)).toEqual(["2026-08-19", "2026-08-20", "2026-08-21"]);
  });

  it("считает только уходы в стор: с компьютера человека в стор никто не увёл", async () => {
    click("bara", "android", "2026-08-19T10:00:00Z");
    click("bara", "ios", "2026-08-19T11:00:00Z");
    click("bara", "other", "2026-08-19T12:00:00Z");

    const points = await loadDailyStoreClicks(["bara"], FROM, TO);

    expect(points.find((p) => p.date === "2026-08-20")!.value).toBe(2);
  });

  it("складывает несколько ссылок одного аккаунта в одну линию", async () => {
    // У @daristeppe две двери в стор: шапка профиля и третье письмо DM-воронки.
    click("daristeppe", "android", "2026-08-19T10:00:00Z");
    click("join", "ios", "2026-08-19T11:00:00Z");

    const points = await loadDailyStoreClicks(["daristeppe", "join"], FROM, TO);

    expect(points.find((p) => p.date === "2026-08-20")!.value).toBe(2);
  });

  it("не берёт чужие слаги", async () => {
    click("bara", "android", "2026-08-19T10:00:00Z");

    const points = await loadDailyStoreClicks(["daristeppe"], FROM, TO);

    expect(points.every((p) => p.value === 0)).toBe(true);
  });

  it("режет окно по краям", async () => {
    click("bara", "android", "2026-08-18T05:29:59Z"); // за секунду до начала окна
    click("bara", "android", "2026-08-18T05:30:00Z"); // ровно начало окна
    click("bara", "android", "2026-08-21T05:30:00Z"); // ровно конец окна — уже вне

    const points = await loadDailyStoreClicks(["bara"], FROM, TO);

    expect(points.reduce((s, p) => s + p.value, 0)).toBe(1);
  });

  it("считает всё, что вышло за первую страницу листинга", async () => {
    store.pageSize = 100;
    for (let i = 0; i < 250; i += 1) {
      click("bara", "android", new Date(Date.parse("2026-08-19T10:00:00Z") + i * 1000).toISOString());
    }

    const points = await loadDailyStoreClicks(["bara"], FROM, TO);

    expect(points.find((p) => p.date === "2026-08-20")!.value).toBe(250);
  });

  it("считает по именам файлов, не скачивая тела", async () => {
    click("bara", "android", "2026-08-19T10:00:00Z");

    await loadDailyStoreClicks(["bara"], FROM, TO);

    expect(store.bodies).toBe(0);
  });
});
