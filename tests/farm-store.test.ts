import { beforeEach, describe, expect, it, vi } from "vitest";

const { put, list, del } = vi.hoisted(() => ({ put: vi.fn(), list: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put, list, del }));

import { isActive, itemPath, listAllBlobs, listItems, loadItem, saveItem } from "../lib/farm/store";
import { Item } from "../lib/farm/types";

const item: Item = {
  itemId: "i1", batchId: "b1", chatId: -1, threadId: null, index: 1, total: 2,
  hook: "Хук", caption: "Описание", sourceUrl: "https://x/s.mp4", videoUrl: null,
  messageId: null, editPromptId: null, status: "pending",
  renderingAt: null, postingAt: null, scheduledAt: null,
  igMediaId: null, permalink: null, error: null, createdAt: "2026-08-19T00:00:00.000Z",
};

beforeEach(() => {
  put.mockReset();
  list.mockReset();
  del.mockReset();
  vi.unstubAllGlobals();
});

describe("saveItem", () => {
  it("пишет по стабильному пути с перезаписью", async () => {
    await saveItem(item);
    expect(put).toHaveBeenCalledWith(
      "farm/items/i1.json",
      JSON.stringify(item),
      expect.objectContaining({ addRandomSuffix: false, allowOverwrite: true })
    );
  });
});

describe("loadItem", () => {
  it("читает с cache-busting: без него тик увидел бы устаревший статус", async () => {
    list.mockResolvedValue({ blobs: [{ pathname: itemPath("i1"), url: "https://blob/i1.json" }] });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ...item, status: "review" })));
    vi.stubGlobal("fetch", fetchMock);

    const loaded = await loadItem("i1");

    expect(loaded?.status).toBe("review");
    expect(String(fetchMock.mock.calls[0][0])).toContain("?ts=");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });

  it("нет блоба — null", async () => {
    list.mockResolvedValue({ blobs: [] });
    expect(await loadItem("nope")).toBeNull();
  });
});

describe("isActive", () => {
  it("активны все промежуточные статусы, включая заливку", () => {
    for (const status of ["pending", "rendering", "review", "editing", "queued", "posting"] as const) {
      expect(isActive({ ...item, status })).toBe(true);
    }
    for (const status of ["rejected", "posted", "failed"] as const) {
      expect(isActive({ ...item, status })).toBe(false);
    }
  });
});

describe("listItems: 404 между list() и чтением — честное отсутствие, а не сбой", () => {
  it("404 на одной задаче не роняет весь список — остальные задачи возвращаются", async () => {
    list.mockResolvedValue({
      blobs: [
        { pathname: itemPath("gone"), url: "https://blob/gone.json" },
        { pathname: itemPath("i1"), url: "https://blob/i1.json" },
      ],
      hasMore: false,
      cursor: undefined,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        // "gone" уже удалён (уборкой или откатом startBatch) между list() и чтением.
        if (url.includes("gone")) return new Response("not found", { status: 404 });
        return new Response(JSON.stringify(item));
      })
    );

    const items = await listItems();

    expect(items.map((i) => i.itemId)).toEqual(["i1"]);
  });

  it("настоящий сбой чтения (не 404) после повтора всё равно роняет listItems", async () => {
    list.mockResolvedValue({
      blobs: [{ pathname: itemPath("i1"), url: "https://blob/i1.json" }],
      hasMore: false,
      cursor: undefined,
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream error", { status: 503 })));

    await expect(listItems()).rejects.toThrow(/список задач неполон/);
  });
});

describe("listAllBlobs: защита от зацикливания по курсору", () => {
  it("hasMore:true без курсора — не зацикливается, останавливается на первой странице", async () => {
    list.mockResolvedValue({
      blobs: [{ pathname: "farm/items/p1.json", url: "https://blob/p1.json" }],
      hasMore: true,
      cursor: undefined,
    });

    const blobs = await listAllBlobs("farm/items/");

    expect(list).toHaveBeenCalledTimes(1);
    expect(blobs.map((b) => b.pathname)).toEqual(["farm/items/p1.json"]);
  });

  it("hasMore:true с тем же курсором, что уже был — тоже останавливается, а не читает ту же страницу вечно", async () => {
    list
      .mockResolvedValueOnce({
        blobs: [{ pathname: "farm/items/p1.json", url: "https://blob/p1.json" }],
        hasMore: true,
        cursor: "SAME",
      })
      .mockResolvedValue({
        blobs: [{ pathname: "farm/items/p1.json", url: "https://blob/p1.json" }],
        hasMore: true,
        cursor: "SAME",
      });

    const blobs = await listAllBlobs("farm/items/");

    expect(list).toHaveBeenCalledTimes(2);
    expect(blobs).toHaveLength(2);
  });
});
