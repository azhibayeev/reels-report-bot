import { describe, expect, it, vi } from "vitest";
import { handleCallback, ApproveDeps } from "../lib/farm/approve";
import { classifyForCleanup, runDaily, DailyDeps } from "../lib/farm/daily";
import { waitForContainer } from "../lib/farm/instagram";
import { postOne, PostDeps } from "../lib/farm/post";
import { DEFAULT_SLOTS, nextFreeSlot } from "../lib/farm/slots";
import { runRenderTick, RenderTickDeps } from "../lib/farm/tick";
import { Item } from "../lib/farm/types";

// Блоб-стор с латентностью: чтение и запись не мгновенные, как в проде.
// Именно этот зазор между loadItem и saveItem и есть окно гонки.
function makeStore(items: Item[]) {
  const db = new Map(items.map((i) => [i.itemId, { ...i }]));
  const io = () => new Promise<void>((r) => setTimeout(r, 2));
  return {
    db,
    loadItem: async (id: string) => {
      await io();
      const found = db.get(id);
      return found ? { ...found } : null;
    },
    listItems: async () => {
      await io();
      return [...db.values()].map((i) => ({ ...i }));
    },
    saveItem: async (item: Item) => {
      await io();
      db.set(item.itemId, { ...item });
    },
  };
}

const baseItem: Item = {
  itemId: "i1",
  batchId: "b1",
  chatId: -100,
  threadId: null,
  index: 1,
  total: 2,
  hook: "Хук",
  caption: "Описание",
  sourceUrl: "https://blob/src.mp4",
  videoUrl: "https://blob/out/i1.mp4",
  messageId: 10,
  editPromptId: null,
  status: "queued",
  renderingAt: null,
  postingAt: null,
  scheduledAt: "2026-08-19T02:00:00.000Z",
  igMediaId: null,
  permalink: null,
  error: null,
  createdAt: "2026-08-19T00:00:00.000Z",
};

const NOW = Date.parse("2026-08-19T02:00:00.000Z");

describe("A. два тика заливки на один ролик", () => {
  it("публикует один и тот же ролик дважды: media_publish вызван 2 раза", async () => {
    const store = makeStore([baseItem]);
    const publishContainer = vi.fn(async () => "M1");
    const createTrialContainer = vi.fn(async () => "C1");
    const deps = (): PostDeps => ({
      now: () => NOW,
      loadItem: store.loadItem,
      saveItem: store.saveItem,
      createTrialContainer,
      waitForContainer: async () => {},
      publishContainer,
      fetchPermalink: async () => "https://instagram.com/reel/M1",
      deleteBlobQuiet: async () => {},
      notify: async () => {},
      recordPublication: async () => {},
      loadCooldown: async () => null,
      loadPace: async () => null,
      savePace: async () => {},
      saveCooldown: async () => {},
    });

    // Внешний таймер /api/farm/post и добор из суточного крона стартуют независимо:
    // оба роута возвращают ответ сразу, а работу крутят после ответа.
    await Promise.all([postOne({ ...baseItem }, deps()), postOne({ ...baseItem }, deps())]);

    expect(createTrialContainer).toHaveBeenCalledTimes(1);
    expect(publishContainer).toHaveBeenCalledTimes(1);
  });
});

describe("B. два апрува подряд", () => {
  it("двум разным роликам достаётся один и тот же слот", async () => {
    const review = (id: string, index: number): Item => ({
      ...baseItem,
      itemId: id,
      index,
      status: "review",
      scheduledAt: null,
      messageId: index * 10,
    });
    const store = makeStore([review("a", 1), review("b", 2)]);
    const deps = (): ApproveDeps => ({
      now: () => NOW,
      loadItem: store.loadItem,
      listItems: store.listItems,
      saveItem: store.saveItem,
      deleteBlobQuiet: async () => {},
      nextFreeSlot: (taken, nowMs) => nextFreeSlot(taken, nowMs, DEFAULT_SLOTS),
      answerCallback: async () => {},
      dropKeyboard: async () => {},
      editCaption: async () => {},
      askForReply: async () => 1,
      sendVideoWithButtons: async () => 1,
      notify: async () => {},
      formatSlot: (iso) => iso,
    });

    await Promise.all([
      handleCallback({ id: "cb1", data: "a:a", chatId: -100 }, deps()),
      handleCallback({ id: "cb2", data: "a:b", chatId: -100 }, deps()),
    ]);

    const slots = [...store.db.values()].map((i) => i.scheduledAt);
    expect(new Set(slots).size).toBe(2);
  });
});

function renderDeps(store: ReturnType<typeof makeStore>, over: Partial<RenderTickDeps> = {}): RenderTickDeps {
  return {
    now: () => Date.now(),
    listItems: store.listItems,
    saveItem: store.saveItem,
    queueRendered: async (item) => {
      const slot = new Date(Date.now() + 3_600_000).toISOString();
      await store.saveItem({ ...item, status: "queued", scheduledAt: slot });
      return slot;
    },
    formatSlot: (iso: string) => iso,
    renderItem: async (item) => {
      await new Promise<void>((r) => setTimeout(r, 5));
      return `https://blob/out/${item.itemId}.mp4`;
    },
    sendVideoWithButtons: vi.fn(async () => 77),
    deleteBlobQuiet: vi.fn(async () => {}),
    notify: async () => {},
    triggerRender: async () => {},
    ...over,
  };
}

describe("C. два тика рендера на одну пачку", () => {
  it("один ролик рендерится и уходит в чат дважды", async () => {
    const pending = { ...baseItem, status: "pending" as const, videoUrl: null, messageId: null, scheduledAt: null };
    const store = makeStore([pending]);
    const sendVideoWithButtons = vi.fn(async () => 77);
    const renderItem = vi.fn(async (item: Item) => {
      await new Promise<void>((r) => setTimeout(r, 5));
      return `https://blob/out/${item.itemId}.mp4`;
    });

    // Так бывает при /reels во время работающей цепочки: команда пинает пачку,
    // у которой ещё есть pending, и вторая цепочка идёт параллельно первой.
    await Promise.all([
      runRenderTick("b1", renderDeps(store, { renderItem, sendVideoWithButtons })),
      runRenderTick("b1", renderDeps(store, { renderItem, sendVideoWithButtons })),
    ]);

    expect(renderItem).toHaveBeenCalledTimes(1);
    expect(sendVideoWithButtons).toHaveBeenCalledTimes(1);
  });
});

describe("D. Telegram отдал 429 после успешного рендера", () => {
  it("готовый ролик не теряется: 429 на карточке не отменяет очередь", async () => {
    const pending = { ...baseItem, status: "pending" as const, videoUrl: null, messageId: null, scheduledAt: null };
    const store = makeStore([pending]);
    const deleteBlobQuiet = vi.fn(async (_url: string) => {});
    const deps = renderDeps(store, {
      deleteBlobQuiet,
      sendVideoWithButtons: async () => {
        throw new Error("Telegram sendVideo failed (429): Too Many Requests");
      },
    });

    await runRenderTick("b1", deps);

    // Раньше исходов было два — запомнить ссылку или снести блоб, — потому что
    // ролик считался потерянным. Теперь исход один: слот выдан до отправки, и
    // ролик выходит по расписанию даже без карточки в чате.
    const saved = store.db.get("i1")!;
    const rendered = "https://blob/out/i1.mp4";
    expect(saved.status).toBe("queued");
    expect(saved.scheduledAt).not.toBeNull();
    expect(saved.videoUrl).toBe(rendered);
    expect(deleteBlobQuiet.mock.calls.some((call) => call[0] === rendered)).toBe(false);
  });
});

describe("E. Graph API отвечает 5xx на опросе контейнера", () => {
  it("разовая пятисотка не отменяет уже созданный контейнер", async () => {
    const responses = [
      new Response("upstream error", { status: 503 }),
      new Response(JSON.stringify({ status_code: "FINISHED" })),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => responses.shift()!));

    await expect(
      waitForContainer("C1", { token: "TK", igUserId: "IG", sleep: async () => {} })
    ).resolves.toBeUndefined();

    vi.unstubAllGlobals();
  });
});

describe("F. Graph API отвечает 429 при создании контейнера", () => {
  it("ролик не выбрасывается навсегда: слот остаётся за ним", async () => {
    const store = makeStore([baseItem]);
    const deps: PostDeps = {
      now: () => NOW,
      loadItem: store.loadItem,
      saveItem: store.saveItem,
      createTrialContainer: async () => {
        throw new Error("(#4) Application request limit reached");
      },
      waitForContainer: async () => {},
      publishContainer: async () => "M1",
      fetchPermalink: async () => "",
      deleteBlobQuiet: async () => {},
      notify: async () => {},
      recordPublication: async () => {},
      loadCooldown: async () => null,
      loadPace: async () => null,
      savePace: async () => {},
      saveCooldown: async () => {},
    };

    await postOne({ ...baseItem }, deps);

    const saved = store.db.get("i1")!;
    expect(saved.status).toBe("queued");
  });
});

describe("G. цепочка рендера умерла на середине пачки", () => {
  it("суточный крон возвращает недоделанные pending в работу", async () => {
    const day = 86_400_000;
    const items: Item[] = [
      { ...baseItem, itemId: "done", status: "review", videoUrl: "https://blob/out/done.mp4", scheduledAt: null },
      {
        ...baseItem,
        itemId: "lost",
        index: 2,
        status: "pending",
        videoUrl: null,
        scheduledAt: null,
        createdAt: new Date(NOW - 30 * day).toISOString(),
      },
    ];

    // Ни одна из трёх корзин уборки не видит pending — он не чистится и не перезапускается.
    const buckets = classifyForCleanup(items, NOW);
    expect([...buckets.purge, ...buckets.expire, ...buckets.unstick].map((i) => i.itemId)).not.toContain("lost");

    const saved: Item[] = [];
    const deps: DailyDeps = {
      now: () => NOW,
      listItems: async () => items,
      saveItem: async (i) => {
        saved.push(i);
      },
      deleteBlobQuiet: async () => {},
      deleteItemRecord: async () => {},
      listSources: async () => [],
      checkToken: async () => ({ valid: true, expiresAt: null, scopes: [] }),
      catchUpDue: async () => 0,
      notify: async () => {},
    };

    await runDaily(deps);

    // Ожидание: крон либо сам пинает цепочку рендера, либо помечает потерянный
    // ролик failed и пишет об этом в чат. Сейчас не делает ни того, ни другого.
    expect(saved.map((i) => i.itemId)).toContain("lost");
  });
});
