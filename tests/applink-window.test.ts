import { describe, it, expect, vi, beforeEach } from "vitest";

// Стор блобов, в котором list() умеет и постраничность, и folded-режим —
// без этого не проверить ни разбор папок-слагов, ни выход за первую тысячу.
const store = vi.hoisted(() => ({ blobs: [] as string[], bodies: 0, pageSize: 1000, listCalls: 0 }));

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async () => ({ url: "https://blob.test/x" })),
  list: vi.fn(async (opts: { prefix: string; cursor?: string; mode?: string }) => {
    store.listCalls += 1;
    const matched = store.blobs.filter((p) => p.startsWith(opts.prefix)).sort();

    if (opts.mode === "folded") {
      const folders = new Set<string>();
      const blobs: Array<{ pathname: string }> = [];
      for (const p of matched) {
        const rest = p.slice(opts.prefix.length);
        const slash = rest.indexOf("/");
        if (slash === -1) blobs.push({ pathname: p });
        else folders.add(opts.prefix + rest.slice(0, slash + 1));
      }
      return { blobs, folders: [...folders], cursor: undefined, hasMore: false };
    }

    const start = opts.cursor ? Number(opts.cursor) : 0;
    const page = matched.slice(start, start + store.pageSize);
    const end = start + page.length;
    const hasMore = end < matched.length;
    return {
      blobs: page.map((pathname) => ({ pathname })),
      cursor: hasMore ? String(end) : undefined,
      hasMore,
    };
  }),
}));

const { loadStoreClicks } = await import("../lib/applink-store");

// Клик в Blob лежит именем файла: платформа, метка времени и случайный хвост.
function click(slug: string, platform: string, iso: string): void {
  const at = new Date(iso);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(at);
  store.blobs.push(`applink/${slug}/${day}/${platform}-${at.getTime()}-rAnd0m.json`);
}

beforeEach(() => {
  store.blobs.length = 0;
  store.bodies = 0;
  store.pageSize = 1000;
  store.listCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      store.bodies += 1;
      return { ok: true, json: async () => ({}) } as never;
    })
  );
});

// Суточный спринт отчёта: 12:30 Джакарты = 05:30 UTC.
const FROM = new Date("2026-08-20T05:30:00Z");
const TO = new Date("2026-08-21T05:30:00Z");

const row = (rows: Awaited<ReturnType<typeof loadStoreClicks>>, slug: string) =>
  rows.find((r) => r.slug === slug)!;

describe("переходы в стор за окно", () => {
  it("делит переходы по витринам, а компьютер держит отдельно", async () => {
    click("bara", "android", "2026-08-20T10:00:00Z");
    click("bara", "android", "2026-08-20T11:00:00Z");
    click("bara", "ios", "2026-08-20T12:00:00Z");
    click("bara", "other", "2026-08-20T13:00:00Z");

    const rows = await loadStoreClicks(FROM, TO);

    expect(row(rows, "bara")).toMatchObject({ android: 2, ios: 1, desktop: 1 });
  });

  it("режет окно по времени клика, а не по календарному дню Джакарты", async () => {
    // Оба клика — в один день Джакарты (21.08), но по разные стороны от 12:30.
    click("bara", "android", "2026-08-21T04:00:00Z"); // 11:00 Джакарты — прошлый спринт
    click("bara", "android", "2026-08-21T05:00:00Z"); // 12:00 Джакарты — прошлый спринт
    click("bara", "android", "2026-08-21T05:29:59Z"); // 12:29:59 — ещё внутри окна
    click("bara", "android", "2026-08-21T06:00:00Z"); // 13:00 — уже следующий спринт

    const rows = await loadStoreClicks(FROM, TO);

    expect(row(rows, "bara").android).toBe(3);
  });

  it("не берёт клики до начала окна", async () => {
    click("bara", "android", "2026-08-20T05:29:59Z"); // за секунду до 12:30
    click("bara", "android", "2026-08-20T05:30:00Z"); // ровно 12:30 — первый в окне

    const rows = await loadStoreClicks(FROM, TO);

    expect(row(rows, "bara").android).toBe(1);
  });

  it("показывает амбассадора с нулём, даже если он не привёл никого", async () => {
    click("bara", "android", "2026-08-20T10:00:00Z");

    const rows = await loadStoreClicks(FROM, TO);

    // Ноль в отчёте — это факт, а не отсутствие данных: строка обязана быть.
    expect(row(rows, "zahid")).toMatchObject({ android: 0, ios: 0, desktop: 0 });
  });

  it("подхватывает новый слаг из Blob, но молчит о пустом чужом", async () => {
    click("novichok", "ios", "2026-08-20T10:00:00Z");
    store.blobs.push("applink/staryi/2026-07-01/android-1751000000000-rAnd0m.json");

    const rows = await loadStoreClicks(FROM, TO);

    expect(row(rows, "novichok").ios).toBe(1);
    expect(rows.some((r) => r.slug === "staryi")).toBe(false);
  });

  it("считает всё, что вышло за первую тысячу записей", async () => {
    store.pageSize = 100;
    for (let i = 0; i < 250; i += 1) {
      click("bara", "android", new Date(FROM.getTime() + i * 1000).toISOString());
    }

    const rows = await loadStoreClicks(FROM, TO);

    expect(row(rows, "bara").android).toBe(250);
  });

  it("считает по именам файлов, не скачивая тела", async () => {
    click("bara", "android", "2026-08-20T10:00:00Z");

    await loadStoreClicks(FROM, TO);

    expect(store.bodies).toBe(0);
  });

  it("сортирует по переходам в стор, компьютерные заходы места не поднимают", async () => {
    click("zahid", "ios", "2026-08-20T10:00:00Z");
    click("zahid", "android", "2026-08-20T10:00:01Z");
    click("bara", "android", "2026-08-20T10:00:02Z");
    click("daristeppe", "other", "2026-08-20T10:00:03Z");
    click("daristeppe", "other", "2026-08-20T10:00:04Z");

    const rows = await loadStoreClicks(FROM, TO);

    expect(rows.map((r) => r.slug).slice(0, 2)).toEqual(["zahid", "bara"]);
  });
});
