import { describe, expect, it, vi } from "vitest";
import { runSweep } from "../lib/farm/sweep";
import { Item } from "../lib/farm/types";

const item = (over: Partial<Item>): Item => ({
  itemId: "i1", batchId: "b1", chatId: -1, threadId: null, index: 1, total: 3,
  hook: "Хук", caption: "Описание", sourceUrl: "https://x/s.mp4", videoUrl: null,
  messageId: null, editPromptId: null, status: "pending",
  renderingAt: null, postingAt: null, scheduledAt: null,
  igMediaId: null, permalink: null, error: null, createdAt: "2026-08-20T00:00:00.000Z",
  ...over,
});

const NOW = Date.parse("2026-08-20T10:00:00.000Z");

describe("runSweep", () => {
  it("расселяет слипшиеся слоты и говорит, скольких подвинул", async () => {
    // Вторая работа будильника. Замок при выдаче слотов действует внутри
    // процесса, а ролики рендерятся на разных инстансах одновременно — гонку
    // между ними закрывает только этот регулярный проход.
    const saved: Item[] = [];
    const result = await runSweep({
      now: () => NOW,
      listItems: async () => [
        item({ itemId: "a", index: 1, status: "queued", scheduledAt: "2026-08-21T02:00:00.000Z" }),
        item({ itemId: "b", index: 2, status: "queued", scheduledAt: "2026-08-21T02:00:00.000Z" }),
      ],
      saveItem: async (i) => {
        saved.push(i);
      },
      nextFreeSlot: () => "2026-08-21T02:45:00.000Z",
      triggerRender: async () => {},
    });

    expect(result.respaced).toBe(1);
    expect(saved).toHaveLength(1);
    expect(saved[0].itemId).toBe("b");
    expect(saved[0].scheduledAt).toBe("2026-08-21T02:45:00.000Z");
  });

  it("пинает каждую пачку с недоделанными роликами — по одному разу", async () => {
    const triggerRender = vi.fn(async (_batchId: string) => {});
    const result = await runSweep({
      now: () => NOW,
      listItems: async () => [
        item({ itemId: "a", batchId: "b1", status: "pending" }),
        item({ itemId: "b", batchId: "b1", status: "pending" }),
        item({ itemId: "c", batchId: "b2", status: "pending" }),
      ],
      saveItem: async () => {},
      nextFreeSlot: () => "2026-08-21T02:00:00.000Z",
      triggerRender,
    });

    expect(triggerRender).toHaveBeenCalledTimes(2);
    expect(triggerRender.mock.calls.map((c) => c[0]).sort()).toEqual(["b1", "b2"]);
    expect(result).toEqual({ kicked: ["b1", "b2"], failed: [], respaced: 0 });
  });

  it("нечего делать — ни одного вызова", async () => {
    const triggerRender = vi.fn(async () => {});
    const result = await runSweep({
      now: () => NOW,
      listItems: async () => [item({ status: "review" }), item({ itemId: "z", status: "posted" })],
      saveItem: async () => {},
      nextFreeSlot: () => "2026-08-21T02:00:00.000Z",
      triggerRender,
    });

    expect(triggerRender).not.toHaveBeenCalled();
    expect(result).toEqual({ kicked: [], failed: [], respaced: 0 });
  });

  it("живой rendering не трогаем: работа идёт, второй пинок только удвоил бы её", async () => {
    const triggerRender = vi.fn(async () => {});
    await runSweep({
      now: () => NOW,
      listItems: async () => [
        item({ status: "rendering", renderingAt: new Date(NOW - 30_000).toISOString() }),
      ],
      saveItem: async () => {},
      nextFreeSlot: () => "2026-08-21T02:00:00.000Z",
      triggerRender,
    });

    expect(triggerRender).not.toHaveBeenCalled();
  });

  it("брошенный rendering подхватываем: вызов, который его держал, давно мёртв", async () => {
    const triggerRender = vi.fn(async () => {});
    await runSweep({
      now: () => NOW,
      listItems: async () => [
        item({ status: "rendering", renderingAt: new Date(NOW - 10 * 60_000).toISOString() }),
      ],
      saveItem: async () => {},
      nextFreeSlot: () => "2026-08-21T02:00:00.000Z",
      triggerRender,
    });

    expect(triggerRender).toHaveBeenCalledWith("b1");
  });

  it("упавший пинок одной пачки не лишает пинка остальные", async () => {
    // Будильник — последняя линия обороны: если он бросит остальные пачки
    // из-за одной, они простоят до следующего срабатывания без причины.
    const triggerRender = vi.fn(async (id: string) => {
      if (id === "b1") throw new Error("508");
    });
    const result = await runSweep({
      now: () => NOW,
      listItems: async () => [
        item({ itemId: "a", batchId: "b1", status: "pending" }),
        item({ itemId: "b", batchId: "b2", status: "pending" }),
      ],
      saveItem: async () => {},
      nextFreeSlot: () => "2026-08-21T02:00:00.000Z",
      triggerRender,
    });

    expect(triggerRender).toHaveBeenCalledTimes(2);
    expect(result.kicked).toEqual(["b2"]);
    expect(result.failed).toEqual([{ batchId: "b1", error: "508" }]);
  });

  it("нечитаемый список — честная ошибка наружу, а не тихое «работы нет»", async () => {
    await expect(
      runSweep({
        now: () => NOW,
        listItems: async () => {
          throw new Error("блоб ответил 500");
        },
        saveItem: async () => {},
        nextFreeSlot: () => "2026-08-21T02:00:00.000Z",
        triggerRender: vi.fn(async () => {}),
      })
    ).rejects.toThrow(/блоб ответил 500/);
  });
});
