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
      loadCooldown: async () => null,
      onGrid: () => true,
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
      loadCooldown: async () => null,
      onGrid: () => true,
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
      loadCooldown: async () => null,
      onGrid: () => true,
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
      loadCooldown: async () => null,
      onGrid: () => true,
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
      loadCooldown: async () => null,
      onGrid: () => true,
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
      loadCooldown: async () => null,
      onGrid: () => true,
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
        loadCooldown: async () => null,
        onGrid: () => true,
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

describe("runSweep на паузе Instagram", () => {
  const PAUSED = {
    until: "2026-08-20T18:00:00.000Z",
    since: "2026-08-20T10:00:00.000Z",
    strikes: 4,
    reason: "IG не опубликовал ролик (HTTP 400): User is performing too many actions",
  };

  it("переносит просроченные за паузу ролики на сетку, а не копит их к её концу", async () => {
    // Пауза на восемь часов съедает полтора десятка слотов. Без переноса
    // очередь выгребает их подряд сразу после паузы — мимо дневного окна и
    // мимо лимита роликов в сутки; на проде так вышел ролик в 00:31.
    const saved: Item[] = [];
    const result = await runSweep({
      now: () => NOW,
      loadCooldown: async () => PAUSED,
      onGrid: () => true,
      listItems: async () => [
        item({ itemId: "a", index: 1, status: "queued", scheduledAt: "2026-08-20T11:00:00.000Z" }),
        item({ itemId: "b", index: 2, status: "queued", scheduledAt: "2026-08-20T12:00:00.000Z" }),
      ],
      saveItem: async (i) => {
        saved.push(i);
      },
      nextFreeSlot: (taken) =>
        ["2026-08-20T18:05:00.000Z", "2026-08-20T18:50:00.000Z"].find((s) => !taken.includes(s))!,
      triggerRender: async () => {},
    });

    expect(result.respaced).toBe(2);
    expect(saved.map((i) => [i.itemId, i.scheduledAt])).toEqual([
      ["a", "2026-08-20T18:05:00.000Z"],
      ["b", "2026-08-20T18:50:00.000Z"],
    ]);
  });

  it("кончившаяся пауза расписание не трогает: просрочка догоняется как обычно", async () => {
    const saved: Item[] = [];
    await runSweep({
      now: () => NOW,
      loadCooldown: async () => ({ ...PAUSED, until: "2026-08-20T09:00:00.000Z" }),
      onGrid: () => true,
      listItems: async () => [
        item({ itemId: "a", index: 1, status: "queued", scheduledAt: "2026-08-20T08:00:00.000Z" }),
      ],
      saveItem: async (i) => {
        saved.push(i);
      },
      nextFreeSlot: () => "2026-08-20T18:05:00.000Z",
      triggerRender: async () => {},
    });

    expect(saved).toEqual([]);
  });

  it("нечитаемая пауза не срывает будильник: расселение и пинки идут своим ходом", async () => {
    const triggerRender = vi.fn(async (_batchId: string) => {});
    const result = await runSweep({
      now: () => NOW,
      loadCooldown: async () => {
        throw new Error("blob down");
      },
      onGrid: () => true,
      listItems: async () => [item({ itemId: "a", batchId: "b1", status: "pending" })],
      saveItem: async () => {},
      nextFreeSlot: () => "2026-08-20T18:05:00.000Z",
      triggerRender,
    });

    expect(triggerRender).toHaveBeenCalledWith("b1");
    expect(result.respaced).toBe(0);
  });
});

describe("runSweep: очередь на сетке текущего темпа", () => {
  it("темп сменился — очередь пересобирается на новую сетку", async () => {
    const saved: Item[] = [];
    const result = await runSweep({
      now: () => NOW,
      loadCooldown: async () => null,
      // Слоты сетки 45 минут после смены темпа на 180 перестали ей принадлежать.
      onGrid: (iso) => iso === "2026-08-21T03:00:00.000Z" || iso === "2026-08-21T06:00:00.000Z",
      listItems: async () => [
        item({ itemId: "a", index: 1, status: "queued", scheduledAt: "2026-08-21T02:00:00.000Z" }),
        item({ itemId: "b", index: 2, status: "queued", scheduledAt: "2026-08-21T02:45:00.000Z" }),
      ],
      saveItem: async (i) => {
        saved.push(i);
      },
      nextFreeSlot: (taken) =>
        taken.includes("2026-08-21T03:00:00.000Z") ? "2026-08-21T06:00:00.000Z" : "2026-08-21T03:00:00.000Z",
      triggerRender: async () => {},
    });

    expect(result.respaced).toBe(2);
    expect(saved.map((i) => i.scheduledAt)).toEqual(["2026-08-21T03:00:00.000Z", "2026-08-21T06:00:00.000Z"]);
  });

  it("очередь уже на сетке — не пишет ничего", async () => {
    const saveItem = vi.fn(async (_i: Item) => {});
    const result = await runSweep({
      now: () => NOW,
      loadCooldown: async () => null,
      onGrid: () => true,
      listItems: async () => [
        item({ itemId: "a", index: 1, status: "queued", scheduledAt: "2026-08-21T03:00:00.000Z" }),
      ],
      saveItem,
      nextFreeSlot: () => "2026-08-21T09:00:00.000Z",
      triggerRender: async () => {},
    });

    expect(result.respaced).toBe(0);
    expect(saveItem).not.toHaveBeenCalled();
  });

  it("вне паузы опоздавший ролик очередь не перетряхивает", async () => {
    const saveItem = vi.fn(async (_i: Item) => {});
    const result = await runSweep({
      now: () => NOW,
      loadCooldown: async () => null,
      onGrid: () => true,
      listItems: async () => [
        // Слот прошёл десять минут назад: внешний таймер опоздал, но ролик цел.
        item({ itemId: "a", index: 1, status: "queued", scheduledAt: new Date(NOW - 600_000).toISOString() }),
      ],
      saveItem,
      nextFreeSlot: () => "2026-08-21T09:00:00.000Z",
      triggerRender: async () => {},
    });

    expect(result.respaced).toBe(0);
    expect(saveItem).not.toHaveBeenCalled();
  });
});
