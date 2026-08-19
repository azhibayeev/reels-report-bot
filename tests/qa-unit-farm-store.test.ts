import { beforeEach, describe, expect, it, vi } from "vitest";

const { put, list, del } = vi.hoisted(() => ({ put: vi.fn(), list: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put, list, del }));

import { listItems } from "../lib/farm/store";
import { Item } from "../lib/farm/types";

const base: Item = {
  itemId: "i1", batchId: "b1", chatId: -1, threadId: null, index: 1, total: 30,
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

describe("B: listItems и пагинация Blob", () => {
  it("hasMore/cursor соблюдаются — вторая страница задач тоже видна ферме", async () => {
    list
      .mockResolvedValueOnce({
        blobs: [{ pathname: "farm/items/p1.json", url: "https://blob/p1.json" }],
        hasMore: true,
        cursor: "CURSOR_1",
      })
      .mockResolvedValueOnce({
        blobs: [{ pathname: "farm/items/p2.json", url: "https://blob/p2.json" }],
        hasMore: false,
        cursor: null,
      });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        new Response(JSON.stringify({ ...base, itemId: String(url).includes("p1") ? "p1" : "p2" }))
      )
    );

    const items = await listItems();

    expect(list).toHaveBeenCalledTimes(2);
    expect(items.map((i) => i.itemId)).toEqual(["p1", "p2"]);
  });
});
