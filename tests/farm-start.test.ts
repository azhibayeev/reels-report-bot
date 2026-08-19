import { describe, expect, it, vi } from "vitest";
import { startBatch, validateBatch } from "../lib/farm/start";
import { Item } from "../lib/farm/types";

const files = [
  { url: "https://blob.public.blob.vercel-storage.com/farm/sources/1.mp4", bytes: 10 },
  { url: "https://blob.public.blob.vercel-storage.com/farm/sources/2.mp4", bytes: 10 },
];
const pairs = [
  { hook: "Хук один", caption: "Описание" },
  { hook: "Хук два", caption: "Описание" },
];

describe("validateBatch", () => {
  it("несовпадение числа блоков и файлов — ошибка", () => {
    expect(validateBatch({ pairs: pairs.slice(0, 1), files })).toEqual([
      "блоков текста 1, а файлов 2 — должно совпадать",
    ]);
  });

  it("не переносимый хук — ошибка с номером", () => {
    const bad = [{ hook: "Assalamualaikumwarahmatullahi", caption: "Описание" }, pairs[1]];
    expect(validateBatch({ pairs: bad, files })).toEqual([
      "блок 1: хук не влезает в 3 строки по 26 знаков",
    ]);
  });

  it("тяжёлый файл и перегруженная пачка — ошибки", () => {
    const heavy = [{ url: files[0].url, bytes: 70 * 1024 * 1024 }, files[1]];
    expect(validateBatch({ pairs, files: heavy })).toContain("файл 1: 70 МБ, лимит 60 МБ");
  });
});

describe("startBatch", () => {
  it("создаёт задачи по числу пар и запускает рендер", async () => {
    const saveItem = vi.fn<(item: Item) => Promise<void>>(async () => {});
    const saveBatch = vi.fn(async () => {});
    const triggerRender = vi.fn(async () => {});

    const out = await startBatch(
      { chatId: -100, threadId: 7, pairs, files },
      { saveItem, saveBatch, triggerRender, deleteBlobQuiet: async () => {}, now: () => new Date("2026-08-19T00:00:00Z"), newId: (() => { let n = 0; return () => `id${++n}`; })() }
    );

    expect(out.total).toBe(2);
    expect(saveItem).toHaveBeenCalledTimes(2);
    const first = saveItem.mock.calls[0][0];
    expect(first).toMatchObject({ index: 1, total: 2, status: "pending", chatId: -100, threadId: 7 });
    expect(triggerRender).toHaveBeenCalledWith(out.batchId);
  });

  it("сорванное создание удаляет уже залитые файлы: иначе они висят в хранилище навсегда", async () => {
    const deleteBlobQuiet = vi.fn(async () => {});
    const saveItem = vi.fn(async () => {
      throw new Error("blob down");
    });

    await expect(
      startBatch(
        { chatId: -100, threadId: null, pairs, files },
        { saveItem, saveBatch: async () => {}, triggerRender: async () => {}, deleteBlobQuiet, now: () => new Date(), newId: () => "id" }
      )
    ).rejects.toThrow(/blob down/);

    expect(deleteBlobQuiet).toHaveBeenCalledTimes(2);
  });

  it("без явной позиции задачи и пачка получают дефолт top", async () => {
    const saveItem = vi.fn<(item: Item) => Promise<void>>(async () => {});
    const saveBatch = vi.fn(async () => {});

    await startBatch(
      { chatId: -100, threadId: null, pairs, files },
      { saveItem, saveBatch, triggerRender: async () => {}, deleteBlobQuiet: async () => {}, now: () => new Date(), newId: (() => { let n = 0; return () => `id${++n}`; })() }
    );

    expect(saveBatch).toHaveBeenCalledWith(expect.objectContaining({ position: "top" }));
    expect(saveItem).toHaveBeenCalledTimes(2);
    for (const call of saveItem.mock.calls) {
      expect(call[0]).toMatchObject({ position: "top" });
    }
  });

  it("явная позиция center уходит и в задачи, и в пачку", async () => {
    const saveItem = vi.fn<(item: Item) => Promise<void>>(async () => {});
    const saveBatch = vi.fn(async () => {});

    await startBatch(
      { chatId: -100, threadId: null, pairs, files, position: "center" },
      { saveItem, saveBatch, triggerRender: async () => {}, deleteBlobQuiet: async () => {}, now: () => new Date(), newId: (() => { let n = 0; return () => `id${++n}`; })() }
    );

    expect(saveBatch).toHaveBeenCalledWith(expect.objectContaining({ position: "center" }));
    expect(saveItem).toHaveBeenCalledTimes(2);
    for (const call of saveItem.mock.calls) {
      expect(call[0]).toMatchObject({ position: "center" });
    }
  });
});
