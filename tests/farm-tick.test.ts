import { describe, expect, it, vi } from "vitest";
import { isAbandoned, pickNext, TAKEOVER_MS, INVOCATION_BUDGET_MS, ITEM_RESERVE_MS, runRenderTick, RenderTickDeps } from "../lib/farm/tick";
import { farmCaption } from "../lib/farm/telegram";
import { Item } from "../lib/farm/types";

const base: Item = {
  itemId: "i1", batchId: "b1", chatId: -1, threadId: null, index: 1, total: 3,
  hook: "Хук", caption: "Описание", sourceUrl: "https://x/s.mp4", videoUrl: null,
  messageId: null, editPromptId: null, status: "pending",
  renderingAt: null, postingAt: null, scheduledAt: null,
  igMediaId: null, permalink: null, error: null, createdAt: "2026-08-19T00:00:00.000Z",
};
const NOW = Date.parse("2026-08-19T01:00:00.000Z");

describe("isAbandoned", () => {
  it("нет отметки — считаем брошенной: иначе статус залипнет навсегда", () => {
    expect(isAbandoned(null, NOW)).toBe(true);
  });

  it("свежая отметка — работа живая", () => {
    expect(isAbandoned(new Date(NOW - 1000).toISOString(), NOW)).toBe(false);
  });

  it("старше времени жизни вызова — брошена", () => {
    expect(isAbandoned(new Date(NOW - TAKEOVER_MS - 1).toISOString(), NOW)).toBe(true);
  });

  it("битая отметка — брошена", () => {
    expect(isAbandoned("не дата", NOW)).toBe(true);
  });
});

describe("pickNext", () => {
  it("берёт pending по порядку номеров", () => {
    const items = [
      { ...base, itemId: "i2", index: 2 },
      { ...base, itemId: "i1", index: 1 },
    ];
    expect(pickNext(items, "b1", NOW)?.itemId).toBe("i1");
  });

  it("чужую пачку не трогает", () => {
    expect(pickNext([{ ...base, batchId: "other" }], "b1", NOW)).toBeNull();
  });

  it("перехватывает брошенный rendering, живой — не трогает", () => {
    const abandoned = { ...base, itemId: "dead", status: "rendering" as const, renderingAt: new Date(NOW - TAKEOVER_MS - 1).toISOString() };
    const alive = { ...base, itemId: "alive", status: "rendering" as const, renderingAt: new Date(NOW - 1000).toISOString() };
    expect(pickNext([alive], "b1", NOW)).toBeNull();
    expect(pickNext([alive, abandoned], "b1", NOW)?.itemId).toBe("dead");
  });

  it("готовые и отвергнутые не берёт", () => {
    expect(pickNext([{ ...base, status: "review" }, { ...base, status: "rejected" }], "b1", NOW)).toBeNull();
  });
});

// Общий стенд для runRenderTick: локальный массив items играет роль стора,
// now — счётчик времени, который двигает сам тест, чтобы не гонять реальные таймеры.
function makeDeps(items: Item[], overrides: Partial<RenderTickDeps> = {}): { deps: RenderTickDeps; items: Item[]; nowRef: { current: number } } {
  const nowRef = { current: NOW };
  const deps: RenderTickDeps = {
    now: () => nowRef.current,
    listItems: async () => items.map((i) => ({ ...i })),
    saveItem: async (item) => {
      const idx = items.findIndex((i) => i.itemId === item.itemId);
      if (idx === -1) items.push(item);
      else items[idx] = item;
    },
    renderItem: vi.fn(async () => "https://out/video.mp4"),
    sendVideoWithButtons: vi.fn(async () => 555),
    deleteBlobQuiet: vi.fn(async () => {}),
    notify: vi.fn(async () => {}),
    triggerRender: vi.fn(async () => {}),
    ...overrides,
  };
  return { deps, items, nowRef };
}

describe("runRenderTick", () => {
  it("успешный ролик: review + videoUrl + messageId, исходник удалён, triggerRender не звали", async () => {
    const item = { ...base, itemId: "i1" };
    const { deps, items } = makeDeps([item]);

    await runRenderTick("b1", deps);

    const saved = items.find((i) => i.itemId === "i1")!;
    expect(saved.status).toBe("review");
    expect(saved.videoUrl).toBe("https://out/video.mp4");
    expect(saved.messageId).toBe(555);
    expect(saved.renderingAt).toBeNull();
    expect(deps.deleteBlobQuiet).toHaveBeenCalledWith(item.sourceUrl);
    expect(deps.sendVideoWithButtons).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: item.chatId,
        threadId: item.threadId,
        itemId: item.itemId,
        videoUrl: "https://out/video.mp4",
        caption: farmCaption(1, 3, "Хук", "Описание"),
      })
    );
    expect(deps.triggerRender).not.toHaveBeenCalled();
  });

  it("упавший рендер: failed + error + notify, без зацикливания", async () => {
    const item = { ...base, itemId: "i1" };
    const { deps, items } = makeDeps([item], {
      renderItem: vi.fn(async () => {
        throw new Error("ffmpeg сломался");
      }),
    });

    await runRenderTick("b1", deps);

    const saved = items.find((i) => i.itemId === "i1")!;
    expect(saved.status).toBe("failed");
    expect(saved.renderingAt).toBeNull();
    expect(saved.error).toContain("ffmpeg сломался");
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining("1/3"), item.threadId);
    // pickNext на следующем витке цикла уже ничего не находит — цикл завершился сам.
    expect(deps.triggerRender).not.toHaveBeenCalled();
  });

  it("исчерпанный бюджет: renderItem не звали, triggerRender зван с batchId", async () => {
    const item = { ...base, itemId: "i1" };
    const { deps, nowRef } = makeDeps([item]);
    let calls = 0;
    (deps as { now: () => number }).now = () => {
      calls += 1;
      // Первый вызов — точка старта; сразу после неё прыгаем за порог бюджета.
      if (calls === 1) return nowRef.current;
      nowRef.current += INVOCATION_BUDGET_MS - ITEM_RESERVE_MS + 1;
      return nowRef.current;
    };

    await runRenderTick("b1", deps);

    expect(deps.renderItem).not.toHaveBeenCalled();
    expect(deps.triggerRender).toHaveBeenCalledWith("b1");
  });

  it("упавший рендер и упавший notify на двух роликах: цикл не рвётся, обе задачи failed", async () => {
    const item1 = { ...base, itemId: "i1", index: 1 };
    const item2 = { ...base, itemId: "i2", index: 2 };
    const { deps, items } = makeDeps([item1, item2], {
      renderItem: vi.fn(async () => {
        throw new Error("ffmpeg сломался");
      }),
      notify: vi.fn(async () => {
        throw new Error("telegram 400");
      }),
    });

    await expect(runRenderTick("b1", deps)).resolves.toBeUndefined();

    expect(deps.renderItem).toHaveBeenCalledTimes(2);
    const saved1 = items.find((i) => i.itemId === "i1")!;
    const saved2 = items.find((i) => i.itemId === "i2")!;
    expect(saved1.status).toBe("failed");
    expect(saved2.status).toBe("failed");
  });
});
