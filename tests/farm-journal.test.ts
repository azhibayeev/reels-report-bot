import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Ин-мемори Blob вместо @vercel/blob: путь данных настоящий (журнал читает
// содержимое через fetch по url, как в проде), но без сети.
const store = vi.hoisted(() => {
  const BASE = "https://journal.public.blob.vercel-storage.com/";
  const files = new Map<string, { pathname: string; url: string; body: string; uploadedAt: Date }>();
  // Размер страницы листинга: в проде это 1000, в тесте про пагинацию — 2.
  const cfg = { pageSize: 1000, now: Date.parse("2026-08-20T00:00:00.000Z"), putFails: false };
  return { BASE, files, cfg };
});

vi.mock("@vercel/blob", () => ({
  put: async (pathname: string, body: string) => {
    if (store.cfg.putFails) throw new Error("blob put refused");
    const entry = {
      pathname,
      url: store.BASE + pathname,
      body,
      uploadedAt: new Date((store.cfg.now += 1000)),
    };
    store.files.set(pathname, entry);
    return { url: entry.url, pathname };
  },
  list: async ({ prefix, cursor }: { prefix?: string; cursor?: string } = {}) => {
    const all = [...store.files.values()].filter((b) => !prefix || b.pathname.startsWith(prefix));
    const start = cursor ? Number(cursor) : 0;
    const page = all.slice(start, start + store.cfg.pageSize);
    const end = start + page.length;
    const hasMore = end < all.length;
    return {
      blobs: page.map((b) => ({ pathname: b.pathname, url: b.url, uploadedAt: b.uploadedAt, size: b.body.length })),
      hasMore,
      cursor: hasMore ? String(end) : undefined,
    };
  },
  del: async () => undefined,
}));

import {
  JOURNAL_PREFIX,
  journalPath,
  listJournalBatches,
  loadJournal,
  recordPublication,
  toRecord,
} from "../lib/farm/journal";
import { Item } from "../lib/farm/types";

const base: Item = {
  itemId: "i1",
  batchId: "b1",
  chatId: -1002200000000,
  threadId: null,
  index: 1,
  total: 3,
  hook: "Ты не поверишь, что случилось",
  caption: "Описание ролика",
  sourceUrl: "https://blob/source-1.mp4",
  videoUrl: "https://blob/out-1.mp4",
  messageId: null,
  editPromptId: null,
  status: "posted",
  renderingAt: null,
  postingAt: null,
  scheduledAt: "2026-08-20T13:00:00.000Z",
  igMediaId: "M1",
  permalink: "https://instagram.com/reel/AAA",
  error: null,
  createdAt: "2026-08-20T09:00:00.000Z",
};

const PUBLISHED_AT = "2026-08-20T13:00:07.000Z";

/** Урлы, по которым журнал реально ходил — по ним проверяем cache-busting. */
let fetched: string[] = [];

beforeEach(() => {
  store.files.clear();
  store.cfg.pageSize = 1000;
  store.cfg.now = Date.parse("2026-08-20T00:00:00.000Z");
  store.cfg.putFails = false;
  fetched = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const full = String(input);
    fetched.push(full);
    const path = decodeURIComponent(full.split("?")[0].slice(store.BASE.length));
    const entry = store.files.get(path);
    if (!entry) return new Response("not found", { status: 404 });
    return new Response(entry.body, { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Кладёт в Blob запись мимо recordPublication — так подсовываем битые данные. */
function plant(pathname: string, body: string): void {
  store.files.set(pathname, {
    pathname,
    url: store.BASE + pathname,
    body,
    uploadedAt: new Date((store.cfg.now += 1000)),
  });
}

async function publish(item: Partial<Item>): Promise<void> {
  const rec = toRecord({ ...base, ...item }, PUBLISHED_AT);
  if (!rec) throw new Error("тест ожидал опубликованный ролик");
  await recordPublication(rec);
}

describe("loadJournal: сигнал о неполноте", () => {
  it("число пропущенных переживает фильтрацию массива", async () => {
    // Ненумеруемое поле на массиве терялось на первом же .filter()/.map(), и
    // читатель получал undefined ?? 0 — уверенное «прочитано всё» ровно тогда,
    // когда данные неполны. Отчёт на этом объявил бы победителем хук, которого
    // могло не быть в прочитанной половине.
    const journal = await loadJournal("b1");
    const kept = journal.records.filter(() => true);
    expect(Array.isArray(kept)).toBe(true);
    expect(journal.skipped).toBeTypeOf("number");
  });
});

describe("toRecord", () => {
  it("ролик без igMediaId в журнал не попадает — журнал не имеет права утверждать, что публикация была", () => {
    expect(toRecord({ ...base, igMediaId: null, status: "failed" }, PUBLISHED_AT)).toBeNull();
  });

  it("сохраняет хук и обстоятельства съёмки, чтобы через месяц было с чем сверить просмотры", () => {
    const rec = toRecord({ ...base, position: "bottom", seconds: 15, musicUrl: "https://blob/m.mp3" }, PUBLISHED_AT);
    expect(rec).toEqual({
      itemId: "i1",
      batchId: "b1",
      index: 1,
      total: 3,
      hook: "Ты не поверишь, что случилось",
      caption: "Описание ролика",
      sourceUrl: "https://blob/source-1.mp4",
      musicUrl: "https://blob/m.mp3",
      position: "bottom",
      seconds: 15,
      scheduledAt: "2026-08-20T13:00:00.000Z",
      publishedAt: PUBLISHED_AT,
      igMediaId: "M1",
      permalink: "https://instagram.com/reel/AAA",
    });
  });

  it("у старого ролика без позиции и длительности запись всё равно полная — отчёт не должен спотыкаться на пропусках", () => {
    const rec = toRecord(base, PUBLISHED_AT);
    expect(rec?.position).toBe("top");
    expect(rec?.seconds).toBe(7);
    expect(rec?.musicUrl).toBeNull();
  });
});

describe("recordPublication", () => {
  it("две публикации подряд ложатся в разные блобы — вторая не стирает память о первой", async () => {
    await publish({ itemId: "i1", index: 1 });
    await publish({ itemId: "i2", index: 2, hook: "Второй хук", igMediaId: "M2" });

    expect([...store.files.keys()].sort()).toEqual([
      journalPath("b1", 1, "i1"),
      journalPath("b1", 2, "i2"),
    ]);

    const journal = await loadJournal();
    expect(journal.records.map((r) => r.hook)).toEqual(["Ты не поверишь, что случилось", "Второй хук"]);
    // Blob отдаётся через CDN: без cache-busting отчёт увидел бы вчерашний журнал.
    expect(fetched.every((u) => u.includes("?ts="))).toBe(true);
  });

  it("сбой журнала не роняет уже опубликованный ролик, но и не проходит молча", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    store.cfg.putFails = true;

    const rec = toRecord(base, PUBLISHED_AT);
    await expect(recordPublication(rec!)).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalled();
  });
});

describe("loadJournal", () => {
  it("отчёт по одной пачке не тянет ролики соседних пачек", async () => {
    await publish({ itemId: "i1", index: 1 });
    await publish({ itemId: "z1", batchId: "b2", index: 1, hook: "Чужой хук", igMediaId: "M9" });

    const mine = await loadJournal("b1");
    expect(mine.records.map((r) => r.itemId)).toEqual(["i1"]);
    expect((await loadJournal()).records).toHaveLength(2);
  });

  it("возвращает ролики по порядку в пачке, а не в порядке листинга блобов", async () => {
    await publish({ itemId: "i10", index: 10, igMediaId: "M10" });
    await publish({ itemId: "i2", index: 2, igMediaId: "M2" });
    await publish({ itemId: "i1", index: 1 });

    expect((await loadJournal("b1")).records.map((r) => r.index)).toEqual([1, 2, 10]);
  });

  it("битая запись не уносит с собой остальной журнал, но и не притворяется, что всё прочитано", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await publish({ itemId: "i1", index: 1 });
    plant(`${JOURNAL_PREFIX}b1/2-i2.json`, "{ это не json");
    plant(`${JOURNAL_PREFIX}b1/3-i3.json`, JSON.stringify({ itemId: "i3", hook: "без igMediaId" }));

    const journal = await loadJournal("b1");
    expect(journal.records.map((r) => r.itemId)).toEqual(["i1"]);
    expect(journal.skipped).toBe(2);
    expect(errors).toHaveBeenCalled();
  });

  it("журнал длиннее страницы листинга читается целиком — хвост пачки не теряется", async () => {
    store.cfg.pageSize = 2;
    for (let index = 1; index <= 7; index += 1) {
      await publish({ itemId: `i${index}`, index, igMediaId: `M${index}` });
    }

    const journal = await loadJournal("b1");
    expect(journal.records.map((r) => r.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(journal.skipped).toBe(0);
  });
});

describe("listJournalBatches", () => {
  it("перечисляет пачки без повторов и начиная со свежей — отчёту нужна последняя, а UUID по времени не сортируется", async () => {
    await publish({ itemId: "i1", index: 1 });
    await publish({ itemId: "i2", index: 2, igMediaId: "M2" });
    await publish({ itemId: "z1", batchId: "b2", index: 1, igMediaId: "M9" });

    expect(await listJournalBatches()).toEqual(["b2", "b1"]);
  });

  it("пустой журнал — это пустой список, а не отказ", async () => {
    expect(await listJournalBatches()).toEqual([]);
  });
});
