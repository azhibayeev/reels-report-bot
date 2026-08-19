import { beforeEach, describe, expect, it, vi } from "vitest";

const { put, list, del } = vi.hoisted(() => ({ put: vi.fn(), list: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put, list, del }));

import { ITEMS_PREFIX, listItems } from "../lib/farm/store";
import { Item } from "../lib/farm/types";

const item = (id: string): Item => ({
  itemId: id,
  batchId: "b1",
  chatId: -100,
  threadId: null,
  index: 1,
  total: 1,
  hook: "Хук",
  caption: "Описание",
  sourceUrl: "https://blob/src.mp4",
  videoUrl: null,
  messageId: null,
  editPromptId: null,
  status: "queued",
  renderingAt: null,
  postingAt: null,
  scheduledAt: "2026-08-19T02:00:00.000Z",
  igMediaId: null,
  permalink: null,
  error: null,
  createdAt: "2026-08-19T00:00:00.000Z",
});

beforeEach(() => {
  put.mockReset();
  list.mockReset();
  del.mockReset();
  vi.unstubAllGlobals();
});

describe("H. в ферме больше 1000 блобов", () => {
  it("listItems дочитывает страницы до конца", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      pathname: `${ITEMS_PREFIX}p1-${i}.json`,
      url: `https://blob/p1-${i}.json`,
    }));
    const page2 = [{ pathname: `${ITEMS_PREFIX}p2-0.json`, url: "https://blob/p2-0.json" }];

    list.mockImplementation(async (opts: { cursor?: string }) =>
      opts.cursor === "CUR"
        ? { blobs: page2, hasMore: false, cursor: undefined }
        : { blobs: page1, hasMore: true, cursor: "CUR" }
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const id = String(input).split("/").pop()!.split(".json")[0];
        return new Response(JSON.stringify(item(id)));
      })
    );

    const items = await listItems();

    expect(items).toHaveLength(1001);
    expect(items.some((i) => i.itemId === "p2-0")).toBe(true);
  });
});

describe("I. сотни задач в хранилище", () => {
  it("listItems читает задачи не по одной последовательно", async () => {
    const n = 200;
    const blobs = Array.from({ length: n }, (_, i) => ({
      pathname: `${ITEMS_PREFIX}i${i}.json`,
      url: `https://blob/i${i}.json`,
    }));
    list.mockResolvedValue({ blobs, hasMore: false });

    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Реальное чтение блоба по HTTP — десятки миллисекунд; здесь 1 мс,
        // чтобы тест был быстрым, но последовательность осталась видна.
        await new Promise<void>((r) => setTimeout(r, 1));
        inFlight -= 1;
        const id = String(input).split("/").pop()!.split(".json")[0];
        return new Response(JSON.stringify(item(id)));
      })
    );

    const startedAt = Date.now();
    const items = await listItems();
    const elapsed = Date.now() - startedAt;

    expect(items).toHaveLength(n);
    // Последовательное чтение: 200 задач × сетевой round-trip. На проде это
    // десятки секунд на каждый вызов /reels, апрув и тик заливки.
    expect(maxInFlight).toBeGreaterThan(1);
    expect(elapsed).toBeLessThan(n);
  });
});
