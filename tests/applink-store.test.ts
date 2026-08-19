import { describe, it, expect, vi, beforeEach } from "vitest";

const store = vi.hoisted(() => ({ blobs: [] as string[], bodies: 0, suffix: 0 }));

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string, _body: string, opts: { addRandomSuffix?: boolean }) => {
    // Vercel сам дописывает уникальный суффикс, когда его просят; повторяем это
    // поведение, иначе тест не отличит запись с суффиксом от перезаписи файла.
    const name = opts.addRandomSuffix
      ? pathname.replace(/\.json$/, `-${(store.suffix += 1).toString(36)}.json`)
      : pathname;
    if (!opts.addRandomSuffix) store.blobs = store.blobs.filter((p) => p !== name);
    store.blobs.push(name);
    return { url: `https://blob.test/${name}` };
  }),
  list: vi.fn(async ({ prefix }: { prefix: string }) => ({
    blobs: store.blobs.filter((p) => p.startsWith(prefix)).map((p) => ({ pathname: p, url: `https://blob.test/${p}` })),
  })),
}));

const { recordAppLinkClick, loadAppLinkStats } = await import("../lib/applink-store");

beforeEach(() => {
  store.blobs.length = 0;
  store.bodies = 0;
  store.suffix = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    store.bodies += 1;
    return { ok: true, json: async () => ({}) } as never;
  }));
});

describe("app link clicks", () => {
  it("keeps every click, even two in the same millisecond", async () => {
    const at = new Date("2026-08-20T05:00:00Z");
    await recordAppLinkClick("bara", "ios", at);
    await recordAppLinkClick("bara", "ios", at);

    expect(store.blobs).toHaveLength(2);
    expect(new Set(store.blobs).size).toBe(2);
  });

  it("counts by person, day and platform without downloading anything", async () => {
    await recordAppLinkClick("bara", "ios", new Date("2026-08-20T05:00:00Z"));
    await recordAppLinkClick("bara", "android", new Date("2026-08-20T06:00:00Z"));
    await recordAppLinkClick("bara", "android", new Date("2026-08-21T06:00:00Z"));
    await recordAppLinkClick("zahid", "other", new Date("2026-08-20T07:00:00Z"));

    const stats = await loadAppLinkStats();

    expect(stats.bara.total).toBe(3);
    expect(stats.bara.byPlatform).toEqual({ android: 2, ios: 1, other: 0 });
    expect(stats.bara.byDay).toEqual({ "2026-08-20": 2, "2026-08-21": 1 });
    expect(stats.zahid.total).toBe(1);
    // Тела блобов читать не должны: счёт идёт по именам, иначе неделя кликов
    // превратится в тысячу лишних запросов.
    expect(store.bodies).toBe(0);
  });

  it("groups clicks by the Jakarta day, not by UTC", async () => {
    // 20.08 20:00 UTC — это уже 21.08 в Джакарте; неделя амбассадора считается по её дням.
    await recordAppLinkClick("bara", "ios", new Date("2026-08-20T20:00:00Z"));
    const stats = await loadAppLinkStats();
    expect(Object.keys(stats.bara.byDay)).toEqual(["2026-08-21"]);
  });

  it("returns nothing when no one has clicked yet", async () => {
    expect(await loadAppLinkStats()).toEqual({});
  });
});
