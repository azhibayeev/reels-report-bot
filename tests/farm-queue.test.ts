import { describe, expect, it, vi } from "vitest";
import { beforeEach } from "vitest";
import { forgetHandedOutSlots, queueRendered, SlotDeps, takenSlots } from "../lib/farm/queue";
import { Item } from "../lib/farm/types";

const base: Item = {
  itemId: "i1", batchId: "b1", chatId: -1, threadId: null, index: 1, total: 60,
  hook: "Хук", caption: "Описание", sourceUrl: "https://x/s.mp4", videoUrl: "https://out/1.mp4",
  messageId: null, editPromptId: null, status: "rendering",
  renderingAt: null, postingAt: null, scheduledAt: null,
  igMediaId: null, permalink: null, error: null, createdAt: "2026-08-20T00:00:00.000Z",
};
const NOW = Date.parse("2026-08-20T12:00:00.000Z");

// Память о выданных слотах живёт на весь процесс — между тестами её чистим.
beforeEach(forgetHandedOutSlots);

describe("takenSlots", () => {
  it("занятыми считает только очередь, заливку и опубликованные", () => {
    const items: Item[] = [
      { ...base, itemId: "a", status: "queued", scheduledAt: "2026-08-20T13:00:00.000Z" },
      { ...base, itemId: "b", status: "posting", scheduledAt: "2026-08-20T14:00:00.000Z" },
      { ...base, itemId: "c", status: "posted", scheduledAt: "2026-08-20T15:00:00.000Z" },
      // Выкинутый слот держать не должен — иначе дыра в расписании навсегда.
      { ...base, itemId: "d", status: "rejected", scheduledAt: "2026-08-20T16:00:00.000Z" },
      { ...base, itemId: "e", status: "failed", scheduledAt: "2026-08-20T17:00:00.000Z" },
    ];
    expect(takenSlots(items)).toEqual([
      "2026-08-20T13:00:00.000Z",
      "2026-08-20T14:00:00.000Z",
      "2026-08-20T15:00:00.000Z",
    ]);
  });
});

describe("queueRendered", () => {
  function makeDeps(items: Item[], slots: string[]): { deps: SlotDeps; items: Item[] } {
    const deps: SlotDeps = {
      now: () => NOW,
      listItems: async () => items.map((i) => ({ ...i })),
      saveItem: async (item) => {
        const idx = items.findIndex((i) => i.itemId === item.itemId);
        if (idx === -1) items.push(item);
        else items[idx] = item;
      },
      // Как настоящий nextFreeSlot: сканирует сетку с начала, ничего не помня.
      nextFreeSlot: vi.fn((taken: string[]) => slots.find((s) => !taken.includes(s))!),
    };
    return { deps, items };
  }

  it("ставит ролик в очередь и возвращает выданный слот", async () => {
    const { deps, items } = makeDeps([], ["2026-08-20T13:00:00.000Z"]);
    const slot = await queueRendered(base, deps);

    expect(slot).toBe("2026-08-20T13:00:00.000Z");
    expect(items[0].status).toBe("queued");
    expect(items[0].scheduledAt).toBe(slot);
    expect(items[0].videoUrl).toBe("https://out/1.mp4");
  });

  it("два ролика, вставшие в очередь одновременно, получают РАЗНЫЕ слоты", async () => {
    // Ради этого модуль и существует. Без замка оба вызова читают список до
    // того, как первый запишет свой слот, и уезжают в одно и то же время.
    const slots = ["2026-08-20T13:00:00.000Z", "2026-08-20T13:45:00.000Z"];
    const { deps, items } = makeDeps([], slots);

    const [a, b] = await Promise.all([
      queueRendered({ ...base, itemId: "a" }, deps),
      queueRendered({ ...base, itemId: "b" }, deps),
    ]);

    expect(a).not.toBe(b);
    expect(new Set(items.map((i) => i.scheduledAt)).size).toBe(2);
  });

  it("список из Blob отстал — слот всё равно не выдаётся дважды", async () => {
    // Ровно то, что случилось на проде: восемнадцать роликов встали в очередь,
    // а уникальных слотов оказалось девять. Замок отработал, вызовы шли по
    // очереди — но Blob отдаёт список не сразу после записи, и каждый следующий
    // вызов не видел слот предыдущего. Полагаться на перечитывание нельзя:
    // выданное этим процессом надо помнить самому.
    const slots = [
      "2026-08-20T13:00:00.000Z",
      "2026-08-20T13:45:00.000Z",
      "2026-08-20T14:30:00.000Z",
    ];
    const written: Item[] = [];
    const deps: SlotDeps = {
      now: () => NOW,
      // Застрявший список: сколько бы ни записали, он всегда пуст.
      listItems: async () => [],
      saveItem: async (item) => {
        written.push(item);
      },
      // Как настоящий nextFreeSlot: каждый раз сканирует сетку с начала и
      // отдаёт первое незанятое время. Ничего между вызовами не помнит —
      // именно поэтому память нужна выдаче слотов, а не сетке.
      nextFreeSlot: (taken: string[]) => slots.find((s) => !taken.includes(s))!,
    };

    const given = [
      await queueRendered({ ...base, itemId: "a" }, deps),
      await queueRendered({ ...base, itemId: "b" }, deps),
      await queueRendered({ ...base, itemId: "c" }, deps),
    ];

    expect(new Set(given).size).toBe(3);
    expect(new Set(written.map((i) => i.scheduledAt)).size).toBe(3);
  });

  it("ролик, встающий в очередь заново, освобождает своё прежнее время", async () => {
    // Так происходит после правки описания. Без этого ролик конкурировал бы сам
    // с собой: его прежний слот остался бы в памяти как занятый, и в расписании
    // появилась бы дыра на сорок пять минут.
    const slots = ["2026-08-20T13:00:00.000Z", "2026-08-20T13:45:00.000Z"];
    const { deps } = makeDeps([], slots);

    const first = await queueRendered({ ...base, itemId: "a" }, deps);
    // Нажали «Текст»: ролик уходит в editing, и его слот перестаёт считаться
    // занятым по списку — но память процесса всё ещё держит это время.
    const editing = { ...base, itemId: "a", status: "editing" as const, scheduledAt: first };
    await deps.saveItem(editing);

    const again = await queueRendered(editing, deps);

    expect(again).toBe(first);
  });

  it("уже занятые слоты не выдаются повторно", async () => {
    const busy: Item = { ...base, itemId: "old", status: "queued", scheduledAt: "2026-08-20T13:00:00.000Z" };
    const { deps } = makeDeps([busy], ["2026-08-20T13:00:00.000Z", "2026-08-20T13:45:00.000Z"]);

    const slot = await queueRendered({ ...base, itemId: "new" }, deps);

    expect(slot).toBe("2026-08-20T13:45:00.000Z");
  });
});
