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
const SLOT = "2026-08-20T02:00:00.000Z";
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
    queueRendered: vi.fn(async (item: Item) => {
      const idx = items.findIndex((i) => i.itemId === item.itemId);
      const queued = { ...item, status: "queued" as const, scheduledAt: SLOT };
      if (idx === -1) items.push(queued);
      else items[idx] = queued;
      return SLOT;
    }),
    formatSlot: (iso: string) => `слот:${iso}`,
    sendVideoWithButtons: vi.fn(async () => 555),
    deleteBlobQuiet: vi.fn(async () => {}),
    notify: vi.fn(async () => {}),
    triggerRender: vi.fn(async () => {}),
    ...overrides,
  };
  return { deps, items, nowRef };
}

describe("runRenderTick", () => {
  it("собранный ролик встаёт в очередь сам, без нажатия «Залить»", async () => {
    // Пачка — это шестьдесят роликов, и шестьдесят подтверждений превращают
    // ферму в ручную работу. Ролики уходят в Trial Reels, где их видят только
    // не-подписчики, поэтому апрув руками отменён. Страховка осталась в
    // карточке: пока слот не наступил, ролик можно выкинуть кнопкой.
    const item = { ...base, itemId: "i1" };
    const { deps, items } = makeDeps([item]);

    await runRenderTick("b1", deps);

    const saved = items.find((i) => i.itemId === "i1")!;
    expect(saved.status).toBe("queued");
    expect(saved.scheduledAt).toBe(SLOT);
    expect(saved.videoUrl).toBe("https://out/video.mp4");
    expect(saved.messageId).toBe(555);
    // Карточка приходит без «Залить» и сообщает выданное время.
    expect(deps.sendVideoWithButtons).toHaveBeenCalledWith(
      expect.objectContaining({ queued: true, caption: expect.stringContaining("слот:") })
    );
  });

  it("слот выдан ДО отправки карточки: отвалившийся Telegram не отменяет публикацию", async () => {
    // Порядок принципиален. Карточка — уведомление, а не разрешение: если
    // Telegram недоступен, ролик всё равно обязан выйти по расписанию.
    const item = { ...base, itemId: "i1" };
    const { deps, items } = makeDeps([item], {
      sendVideoWithButtons: vi.fn(async () => {
        throw new Error("telegram 502");
      }),
    });

    await runRenderTick("b1", deps);

    const saved = items.find((i) => i.itemId === "i1")!;
    expect(saved.status).toBe("queued");
    expect(saved.scheduledAt).toBe(SLOT);
    expect(saved.messageId).toBeNull();
  });

  it("подложку не удаляем, пока на ней висит сбойный ролик: иначе /retry нечем пересобирать", async () => {
    // Так и вышло на проде. Подложки раздаются по кругу, одна на десяток хуков.
    // Пока пачка молола, часть роликов упала; когда последний pending
    // дорендерился, исходники снесло — а следом /retry вернул тридцать четыре
    // задачи, которые тут же легли с 404 на удалённой подложке. Доделать пачку
    // означало убить возможность её пересобрать.
    const ok = { ...base, itemId: "i1", index: 1, status: "pending" as const };
    const broken = {
      ...base,
      itemId: "i2",
      index: 2,
      status: "failed" as const,
      videoUrl: null,
      error: "ffmpeg вышел с кодом 8",
    };
    const { deps } = makeDeps([ok, broken]);

    await runRenderTick("b1", deps);

    expect(deps.deleteBlobQuiet).not.toHaveBeenCalledWith(base.sourceUrl);
  });

  it("а вот собранного соседа подложка уже не держит: он своё видео получил", async () => {
    const ok = { ...base, itemId: "i1", index: 1, status: "pending" as const };
    const done = { ...base, itemId: "i2", index: 2, status: "review" as const, videoUrl: "https://out/2.mp4" };
    const { deps } = makeDeps([ok, done]);

    await runRenderTick("b1", deps);

    expect(deps.deleteBlobQuiet).toHaveBeenCalledWith(base.sourceUrl);
  });

  it("сбойный на публикации подложку не держит: видео у него есть, пересобирать нечего", async () => {
    const ok = { ...base, itemId: "i1", index: 1, status: "pending" as const };
    const postFail = {
      ...base,
      itemId: "i2",
      index: 2,
      status: "failed" as const,
      videoUrl: "https://out/2.mp4",
      error: "IG отбраковал ролик",
    };
    const { deps } = makeDeps([ok, postFail]);

    await runRenderTick("b1", deps);

    expect(deps.deleteBlobQuiet).toHaveBeenCalledWith(base.sourceUrl);
  });

  it("успешный ролик: очередь + videoUrl + messageId, исходник удалён, triggerRender не звали", async () => {
    const item = { ...base, itemId: "i1" };
    const { deps, items } = makeDeps([item]);

    await runRenderTick("b1", deps);

    const saved = items.find((i) => i.itemId === "i1")!;
    expect(saved.status).toBe("queued");
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
        caption: `${farmCaption(1, 3, "Хук", "Описание")}\n\n🗓 В очереди на слот:${SLOT}`,
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
    expect(deps.notify).toHaveBeenCalledWith(
      expect.stringContaining("1/3"),
      item.threadId,
      item.chatId
    );
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

  it("сбой saveItem при отметке rendering: notify зван, triggerRender НЕ зван — иначе бесконечный самовызов", async () => {
    const item = { ...base, itemId: "i1" };
    const { deps } = makeDeps([item], {
      saveItem: vi.fn(async () => {
        throw new Error("Blob 429");
      }),
    });

    await runRenderTick("b1", deps);

    // Третий аргумент — чат задачи: пачку могли завести в личке, и уведомление
    // должно прийти туда же, а не в общую группу.
    expect(deps.notify).toHaveBeenCalledWith(
      expect.stringContaining("Не смог отметить"),
      item.threadId,
      item.chatId
    );
    expect(deps.triggerRender).not.toHaveBeenCalled();
  });

  it("сбой listItems: тик не бросает, шлёт одно уведомление, triggerRender НЕ зван", async () => {
    const { deps } = makeDeps([], {
      listItems: vi.fn(async () => {
        throw new Error("Blob list down");
      }),
    });

    await expect(runRenderTick("b1", deps)).resolves.toBeUndefined();

    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.triggerRender).not.toHaveBeenCalled();
  });

  it("сбой listItems и упавший notify: тик всё равно не бросает", async () => {
    const { deps } = makeDeps([], {
      listItems: vi.fn(async () => {
        throw new Error("Blob list down");
      }),
      notify: vi.fn(async () => {
        throw new Error("telegram тоже лежит");
      }),
    });

    await expect(runRenderTick("b1", deps)).resolves.toBeUndefined();
    expect(deps.triggerRender).not.toHaveBeenCalled();
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
