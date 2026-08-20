import { describe, expect, it, vi } from "vitest";
import { pickDue, postOne, runPostTick, PostDeps, PostTickDeps } from "../lib/farm/post";
import { TAKEOVER_MS } from "../lib/farm/tick";
import { Item } from "../lib/farm/types";

const base: Item = {
  itemId: "i1", batchId: "b1", chatId: -1, threadId: null, index: 1, total: 3,
  hook: "Хук", caption: "Описание", sourceUrl: "https://x/s.mp4", videoUrl: "https://out/video.mp4",
  messageId: null, editPromptId: null, status: "queued",
  renderingAt: null, postingAt: null, scheduledAt: "2026-08-19T01:00:00.000Z",
  igMediaId: null, permalink: null, error: null, createdAt: "2026-08-19T00:00:00.000Z",
};
const NOW = Date.parse("2026-08-19T01:00:00.000Z");

describe("pickDue", () => {
  it("берёт самый ранний наступивший слот", () => {
    const early = { ...base, itemId: "early", scheduledAt: "2026-08-19T00:30:00.000Z" };
    const later = { ...base, itemId: "later", scheduledAt: "2026-08-19T00:45:00.000Z" };
    expect(pickDue([later, early], NOW)?.itemId).toBe("early");
  });

  it("ненаступивший слот не берётся", () => {
    const future = { ...base, itemId: "future", scheduledAt: "2026-08-19T02:00:00.000Z" };
    expect(pickDue([future], NOW)).toBeNull();
  });

  it("брошенный posting не возвращается в работу — постинг мог умереть уже после media_publish", () => {
    const stuck = { ...base, itemId: "stuck", status: "posting" as const, postingAt: new Date(NOW - TAKEOVER_MS - 1).toISOString() };
    expect(pickDue([stuck], NOW)).toBeNull();
  });

  it("не-queued задачи игнорирует", () => {
    expect(pickDue([{ ...base, status: "review" }], NOW)).toBeNull();
  });
});

function makeDeps(overrides: Partial<PostDeps> = {}): PostDeps {
  return {
    now: () => NOW,
    loadItem: vi.fn(async () => ({ ...base })),
    saveItem: vi.fn(async () => {}),
    createTrialContainer: vi.fn(async () => "C1"),
    waitForContainer: vi.fn(async () => {}),
    publishContainer: vi.fn(async () => "M1"),
    fetchPermalink: vi.fn(async () => "https://instagram.com/reel/M1"),
    deleteBlobQuiet: vi.fn(async () => {}),
    notify: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("postOne: сломанный токен аккаунта", () => {
  // Это беда аккаунта, а не ролика, и сжигать за неё очередь нельзя. На проде
  // токен оказался нечитаемым, первый же ролик ушёл в failed — а за ним стояли
  // двадцать восемь, по одному каждые сорок пять минут. Вернуть их потом нечем:
  // /retry сознательно не трогает упавших на публикации, чтобы не задвоить пост.
  const AUTH = "IG контейнер не создан (HTTP 400): Invalid OAuth access token - Cannot parse access token";

  it("ролик остаётся в очереди, а не уходит в failed", async () => {
    const saveItem = vi.fn(async (_item: Item) => {});
    const deps = makeDeps({
      saveItem,
      createTrialContainer: vi.fn(async () => {
        throw new Error(AUTH);
      }),
    });

    await postOne(base, deps);

    const saved = saveItem.mock.calls.map((c) => c[0] as Item);
    const last = saved[saved.length - 1];
    expect(last.status).toBe("queued");
    expect(last.postingAt).toBeNull();
    // Слот не сдвигаем: когда токен починят, ролик выйдет первым же тиком.
    expect(last.scheduledAt).toBe(base.scheduledAt);
  });

  it("и не тратит попытки: чинится не повтором, а заменой токена", async () => {
    const saveItem = vi.fn(async (_item: Item) => {});
    const deps = makeDeps({
      saveItem,
      loadItem: vi.fn(async () => ({ ...base, postAttempts: 4 })),
      createTrialContainer: vi.fn(async () => {
        throw new Error(AUTH);
      }),
    });

    await postOne(base, deps);

    const saved = saveItem.mock.calls.map((c) => c[0] as Item);
    const last = saved[saved.length - 1];
    expect(last.status).toBe("queued");
    expect(last.postAttempts).toBe(4);
  });

  it("сообщает в чат, что стоит вся очередь, а не один ролик", async () => {
    const notify = vi.fn(async (_text: string) => {});
    const deps = makeDeps({
      notify,
      createTrialContainer: vi.fn(async () => {
        throw new Error(AUTH);
      }),
    });

    await postOne(base, deps);

    const text = notify.mock.calls.map((c) => String(c[0])).join(" ");
    expect(text).toContain("токен");
    expect(text).not.toContain("не залился");
  });
});

describe("postOne: куда уходят сообщения", () => {
  // Пачку заводит человек в личке, а сообщения о заливке сыпались в общий чат
  // команды: для всех шум, а для того, кто загрузил, — молчание.
  it("сообщение об успехе уходит в чат задачи, а не в чат по умолчанию", async () => {
    const notify = vi.fn(async (_t: string, _thread: number | null, _chat?: number) => {});
    const mine = { ...base, chatId: 738812437, threadId: null };
    await postOne(mine, makeDeps({ notify, loadItem: async () => ({ ...mine }) }));

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Залил"), null, 738812437);
  });

  it("и сообщение о сбое тоже", async () => {
    const notify = vi.fn(async (_t: string, _thread: number | null, _chat?: number) => {});
    const mine = { ...base, chatId: 738812437 };
    await postOne(
      mine,
      makeDeps({
        notify,
        loadItem: async () => ({ ...mine }),
        createTrialContainer: async () => {
          throw new Error("что-то сломалось");
        },
      })
    );

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("не залился"), null, 738812437);
  });
});

describe("postOne", () => {
  it("проходит контейнер → ожидание → публикацию, шлёт permalink в чат и удаляет videoUrl", async () => {
    const deps = makeDeps();

    await postOne(base, deps);

    expect(deps.createTrialContainer).toHaveBeenCalledWith(base.videoUrl, base.caption);
    expect(deps.waitForContainer).toHaveBeenCalledWith("C1");
    expect(deps.publishContainer).toHaveBeenCalledWith("C1");
    expect(deps.fetchPermalink).toHaveBeenCalledWith("M1");
    expect(deps.saveItem).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "posted",
        postingAt: null,
        igMediaId: "M1",
        permalink: "https://instagram.com/reel/M1",
      })
    );
    expect(deps.notify).toHaveBeenCalledWith(
      expect.stringContaining("https://instagram.com/reel/M1"),
      base.threadId,
      base.chatId
    );
    expect(deps.deleteBlobQuiet).toHaveBeenCalledWith(base.videoUrl);
  });

  it("публикация состоялась, но fetchPermalink упал — задача остаётся posted, а не failed", async () => {
    const deps = makeDeps({
      fetchPermalink: vi.fn(async () => {
        throw new Error("Graph 503");
      }),
    });

    await postOne(base, deps);

    expect(deps.saveItem).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "posted", igMediaId: "M1" })
    );
    expect(deps.saveItem).not.toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
    const lastNotify = vi.mocked(deps.notify).mock.calls.at(-1)?.[0] ?? "";
    expect(lastNotify).not.toContain("не залился");
    expect(lastNotify).toMatch(/ссылк/);
    expect(deps.deleteBlobQuiet).toHaveBeenCalledWith(base.videoUrl);
  });

  it("igMediaId сохраняется до запроса ссылки", async () => {
    const deps = makeDeps();

    await postOne(base, deps);

    const saveCalls = vi.mocked(deps.saveItem).mock.calls;
    const saveOrders = vi.mocked(deps.saveItem).mock.invocationCallOrder;
    const firstPostedCallIndex = saveCalls.findIndex(([saved]) => saved.status === "posted");
    expect(firstPostedCallIndex).toBeGreaterThanOrEqual(0);
    const firstPostedSaveOrder = saveOrders[firstPostedCallIndex];
    const fetchPermalinkOrder = vi.mocked(deps.fetchPermalink).mock.invocationCallOrder[0];

    expect(firstPostedSaveOrder).toBeLessThan(fetchPermalinkOrder);
  });

  it("первая запись после публикации упала — задача всё равно posted с igMediaId", async () => {
    let postedSaveCount = 0;
    const deps = makeDeps({
      saveItem: vi.fn(async (saved) => {
        if (saved.status === "posted") {
          postedSaveCount += 1;
          if (postedSaveCount === 1) {
            throw new Error("blob write failed");
          }
        }
      }),
    });

    await expect(postOne(base, deps)).resolves.toBeUndefined();

    expect(deps.saveItem).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "posted", igMediaId: "M1" })
    );
    expect(deps.saveItem).not.toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
    const lastNotify = vi.mocked(deps.notify).mock.calls.at(-1)?.[0] ?? "";
    expect(lastNotify).not.toContain("не залился");
  });

  it("статус изменился между чтениями (loadItem вернул posted) — publishContainer не вызывается", async () => {
    const deps = makeDeps({ loadItem: vi.fn(async () => ({ ...base, status: "posted" as const })) });

    await postOne(base, deps);

    expect(deps.createTrialContainer).not.toHaveBeenCalled();
    expect(deps.publishContainer).not.toHaveBeenCalled();
    expect(deps.saveItem).not.toHaveBeenCalled();
  });

  it("задача исчезла — тихо выходит", async () => {
    const deps = makeDeps({ loadItem: vi.fn(async () => null) });
    await expect(postOne(base, deps)).resolves.toBeUndefined();
    expect(deps.createTrialContainer).not.toHaveBeenCalled();
  });

  it("ошибка IG переводит в failed с текстом ошибки в чат", async () => {
    const deps = makeDeps({
      createTrialContainer: vi.fn(async () => {
        throw new Error("IG контейнер не создан: quota");
      }),
    });

    await postOne(base, deps);

    expect(deps.saveItem).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "failed", postingAt: null, error: expect.stringContaining("quota") })
    );
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining("quota"), base.threadId, base.chatId);
    expect(deps.deleteBlobQuiet).not.toHaveBeenCalled();
  });

  it("пустой videoUrl сразу failed, в IG не ходить", async () => {
    const item = { ...base, videoUrl: null };
    const deps = makeDeps({ loadItem: vi.fn(async () => ({ ...item })) });

    await postOne(item, deps);

    expect(deps.createTrialContainer).not.toHaveBeenCalled();
    expect(deps.saveItem).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("fetchPermalink упал — причина попадает в console.error вместе с itemId и mediaId", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const permalinkError = new Error("Graph 503");
      const deps = makeDeps({
        fetchPermalink: vi.fn(async () => {
          throw permalinkError;
        }),
      });

      await postOne(base, deps);

      const call = spy.mock.calls.find(([msg]) => msg === "farm fetchPermalink failed");
      expect(call).toBeDefined();
      expect(call).toContain(base.itemId);
      expect(call).toContain("M1");
      expect(call).toContain(permalinkError);
    } finally {
      spy.mockRestore();
    }
  });

  it("deleteBlobQuiet упал уже после того, как ссылка сохранена и отправлена в чат — postOne не бросает и не затирает permalink", async () => {
    const deps = makeDeps({
      deleteBlobQuiet: vi.fn(async () => {
        throw new Error("blob delete failed");
      }),
    });

    await expect(postOne(base, deps)).resolves.toBeUndefined();

    expect(deps.saveItem).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "posted", permalink: "https://instagram.com/reel/M1" })
    );
    const notifyMessages = vi.mocked(deps.notify).mock.calls.map(([text]) => text);
    expect(notifyMessages.some((m) => m.includes("не получил"))).toBe(false);
    expect(notifyMessages.some((m) => m.includes("не удалось"))).toBe(false);
  });

  it("упавший notify не роняет постинг", async () => {
    const deps = makeDeps({
      notify: vi.fn(async () => {
        throw new Error("telegram 400");
      }),
    });

    await expect(postOne(base, deps)).resolves.toBeUndefined();
    expect(deps.saveItem).toHaveBeenLastCalledWith(expect.objectContaining({ status: "posted" }));
  });

  it("временный отказ Graph: первая попытка остаётся queued со сдвинутым вперёд scheduledAt", async () => {
    const deps = makeDeps({
      createTrialContainer: vi.fn(async () => {
        throw new Error("IG контейнер не создан (HTTP 429): (#4) Application request limit reached");
      }),
    });

    await postOne(base, deps);

    expect(deps.saveItem).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "queued", postAttempts: 1 })
    );
    const saved = vi.mocked(deps.saveItem).mock.calls.at(-1)?.[0];
    expect(Date.parse(saved!.scheduledAt!)).toBeGreaterThan(Date.parse(base.scheduledAt!));
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it("пять подряд временных отказов уводят ролик в failed с уведомлением в чат", async () => {
    // Каждый вызов postOne через loadItem получает задачу с накопленным
    // postAttempts из предыдущей попытки — так же, как реально ведёт себя
    // Blob-стор между тиками /api/farm/post.
    let current: Item = { ...base };
    const deps = makeDeps({
      loadItem: vi.fn(async () => ({ ...current })),
      saveItem: vi.fn(async (saved) => {
        current = saved;
      }),
      createTrialContainer: vi.fn(async () => {
        throw new Error("IG контейнер не создан (HTTP 429): (#4) Application request limit reached");
      }),
    });

    for (let i = 0; i < 5; i += 1) {
      await postOne(current, deps);
    }

    expect(current.status).toBe("failed");
    expect(current.postAttempts).toBe(4);
    const lastNotify = vi.mocked(deps.notify).mock.calls.at(-1)?.[0] ?? "";
    expect(lastNotify).toContain("не залился");
  });
});

describe("runPostTick", () => {
  it("берёт не больше maxItems штук", async () => {
    const items: Item[] = [
      { ...base, itemId: "i1", scheduledAt: "2026-08-19T00:30:00.000Z" },
      { ...base, itemId: "i2", scheduledAt: "2026-08-19T00:31:00.000Z" },
    ];
    const store = new Map(items.map((i) => [i.itemId, i]));
    const deps: PostTickDeps = {
      ...makeDeps({
        loadItem: async (id) => store.get(id) ?? null,
        saveItem: async (item) => {
          store.set(item.itemId, item);
        },
      }),
      listItems: async () => Array.from(store.values()).map((i) => ({ ...i })),
    };

    const taken = await runPostTick(deps, 1);

    expect(taken).toBe(1);
    const posted = Array.from(store.values()).filter((i) => i.status === "posted");
    expect(posted).toHaveLength(1);
  });

  it("нечего брать — возвращает 0", async () => {
    const deps: PostTickDeps = { ...makeDeps(), listItems: async () => [] };
    expect(await runPostTick(deps, 1)).toBe(0);
  });
});
