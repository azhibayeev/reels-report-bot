import { beforeEach, describe, expect, it, vi } from "vitest";

const { put, list, del } = vi.hoisted(() => ({ put: vi.fn(), list: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put, list, del }));

import { isActive, itemPath, loadItem, saveItem } from "../lib/farm/store";
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
