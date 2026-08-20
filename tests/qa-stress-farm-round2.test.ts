// Раунд 2, измерение «нагрузка и параллелизм»: повторы, обрывы, 5xx/429 снаружи.
// Каждый тест сформулирован от ОЖИДАЕМОГО поведения, поэтому красный тест здесь —
// это доказанный дефект, а не сломанный тест.
import { describe, expect, it, vi } from "vitest";
import { handleCallback, handleEditReply, ApproveDeps } from "../lib/farm/approve";
import { startBatch, StartDeps } from "../lib/farm/start";
import { runRenderTick, RenderTickDeps } from "../lib/farm/tick";
import { Item } from "../lib/farm/types";

const NOW = Date.parse("2026-08-19T02:00:00.000Z");

const base: Item = {
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
  status: "review",
  renderingAt: null,
  postingAt: null,
  scheduledAt: null,
  igMediaId: null,
  permalink: null,
  error: null,
  createdAt: "2026-08-19T00:00:00.000Z",
};

function approveDeps(item: Item, over: Partial<ApproveDeps> = {}): ApproveDeps {
  return {
    now: () => NOW,
    loadItem: async () => ({ ...item }),
    listItems: async () => [{ ...item }],
    saveItem: vi.fn(async () => {}),
    deleteBlobQuiet: vi.fn(async () => {}),
    nextFreeSlot: () => "2026-08-19T02:45:00.000Z",
    answerCallback: vi.fn(async () => {}),
    dropKeyboard: vi.fn(async () => {}),
    editCaption: vi.fn(async () => {}),
    askForReply: vi.fn(async () => 77),
    sendVideoWithButtons: vi.fn(async () => 99),
    notify: vi.fn(async () => {}),
    formatSlot: () => "19 авг, 09:45",
    ...over,
  };
}

// Telegram запрещает боту править собственные сообщения старше 48 часов, а на
// серии апрувов подряд отдаёт 429. Карточка ролика по спеке живёт в review до
// 7 суток (REVIEW_EXPIRY_MS) — то есть отказ на editMessage* здесь штатный.
const tooOld = () =>
  vi.fn(async () => {
    throw new Error("Telegram editMessageReplyMarkup failed (400): message can't be edited");
  });

// ─────────────────────────────────────────────────────────────────────────────
// A. Косметический отказ Telegram после успешной записи статуса
// ─────────────────────────────────────────────────────────────────────────────
describe("A. апрув: перерисовать карточку не вышло", () => {
  it("статус уже сохранён — подпись со слотом всё равно должна проставиться, а вебхук не должен ловить исключение", async () => {
    const saveItem = vi.fn(async () => {});
    const editCaption = vi.fn(async () => {});
    const deps = approveDeps(base, { saveItem, dropKeyboard: tooOld(), editCaption });

    await handleCallback({ id: "cb1", data: `a:${base.itemId}`, chatId: base.chatId }, deps);

    expect(saveItem).toHaveBeenCalledWith(
      expect.objectContaining({ status: "queued", scheduledAt: "2026-08-19T02:45:00.000Z" })
    );
    expect(editCaption).toHaveBeenCalled();
  });

  it("повторное нажатие по уже обработанному ролику не должно падать: выхода из ошибки иначе нет", async () => {
    // Ролик из очереди отвечает без упоминания статуса и кнопок не теряет:
    // рядом «Выкинуть», и она нужна, пока слот не наступил.
    const queued: Item = { ...base, status: "queued", scheduledAt: "2026-08-19T02:45:00.000Z" };
    const answerCallback = vi.fn(async () => {});
    const deps = approveDeps(queued, { dropKeyboard: tooOld(), answerCallback });

    await handleCallback({ id: "cb2", data: `a:${queued.itemId}`, chatId: queued.chatId }, deps);

    expect(answerCallback).toHaveBeenCalledWith("cb2", "Уже обработано");
  });

  it("уже опубликованный ролик отвечает статусом и снимает кнопки, даже если Telegram против", async () => {
    const posted: Item = { ...base, status: "posted", scheduledAt: "2026-08-19T02:45:00.000Z" };
    const answerCallback = vi.fn(async () => {});
    const deps = approveDeps(posted, { dropKeyboard: tooOld(), answerCallback });

    await handleCallback({ id: "cb3", data: `a:${posted.itemId}`, chatId: posted.chatId }, deps);

    expect(answerCallback).toHaveBeenCalledWith("cb3", "Уже обработано: posted");
  });

  it("отказ: ролик уже rejected и блоб удалён — подпись «выкинут» тоже обязана проставиться", async () => {
    const saveItem = vi.fn(async () => {});
    const deleteBlobQuiet = vi.fn(async () => {});
    const editCaption = vi.fn(async () => {});
    const deps = approveDeps(base, {
      saveItem,
      deleteBlobQuiet,
      editCaption,
      dropKeyboard: vi.fn(async () => {
        throw new Error("Telegram editMessageReplyMarkup failed (429): Too Many Requests");
      }),
    });

    await handleCallback({ id: "cb3", data: `r:${base.itemId}`, chatId: base.chatId }, deps);

    expect(saveItem).toHaveBeenCalledWith(expect.objectContaining({ status: "rejected" }));
    expect(deleteBlobQuiet).toHaveBeenCalledWith(base.videoUrl);
    expect(editCaption).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. Повторная отправка пачки после потерянного ответа
// ─────────────────────────────────────────────────────────────────────────────
describe("B. /api/farm/start вызван дважды с теми же файлами", () => {
  const input = {
    chatId: -100,
    threadId: null,
    pairs: [
      { hook: "Хук один", caption: "Описание один" },
      { hook: "Хук два", caption: "Описание два" },
    ],
    files: [
      { url: "https://blob/farm/sources/a.mp4", bytes: 1000 },
      { url: "https://blob/farm/sources/b.mp4", bytes: 1000 },
    ],
  };

  function startDeps(saved: Item[], batches: string[]): StartDeps {
    let n = 0;
    return {
      saveItem: async (item) => {
        saved.push(item);
      },
      saveBatch: async (batch) => {
        batches.push(batch.batchId);
      },
      triggerRender: async () => {},
      deleteBlobQuiet: async () => {},
      now: () => new Date(NOW),
      newId: () => `id-${(n += 1)}`,
    };
  }

  it("повтор той же пачки не должен плодить вторую задачу на тот же исходник", async () => {
    const saved: Item[] = [];
    const batches: string[] = [];
    // Первый POST дошёл до сервера и отработал, ответ до браузера не доехал:
    // maxDuration = 60 против 101 последовательного вызова Blob на 50 файлах.
    await startBatch(input, startDeps(saved, batches));
    // Человек жмёт «Загрузить пачку» ещё раз: форма кэширует url уже залитых
    // файлов и не перезаливает их, а токен пачки живёт 30 минут и не одноразовый.
    await startBatch(input, startDeps(saved, batches));

    const bySource = new Map<string, number>();
    for (const item of saved) bySource.set(item.sourceUrl, (bySource.get(item.sourceUrl) ?? 0) + 1);
    expect([...bySource.values()]).toEqual([1, 1]);
  });

  it("общая подложка не удаляется, пока её ждёт другой ролик", async () => {
    const item: Item = { ...base, itemId: "twin-1", status: "pending", videoUrl: null, messageId: null };
    const twin: Item = { ...item, itemId: "twin-2", batchId: "b2" };
    const db = new Map<string, Item>([
      [item.itemId, item],
      [twin.itemId, twin],
    ]);
    const deleted: string[] = [];

    const deps: RenderTickDeps = {
      now: () => NOW,
      listItems: async () => [...db.values()].map((i) => ({ ...i })),
      saveItem: async (i) => {
        db.set(i.itemId, { ...i });
      },
      renderItem: async () => "https://blob/out/twin-1.mp4",
      queueRendered: async (i) => {
        const slot = new Date(NOW + 3_600_000).toISOString();
        db.set(i.itemId, { ...i, status: "queued", scheduledAt: slot });
        return slot;
      },
      formatSlot: (iso: string) => iso,
      sendVideoWithButtons: async () => 42,
      deleteBlobQuiet: async (url) => {
        deleted.push(url);
      },
      notify: async () => {},
      triggerRender: async () => {},
    };

    await runRenderTick("b1", deps);

    // Подложки раздаются по кругу и обслуживают по десятку хуков, поэтому общий
    // sourceUrl — норма. Удалить его после первого же ролика значило бы оставить
    // остальных с мёртвой ссылкой, а пометить их сбойными — убить девять из
    // десяти. Ждущий ролик остаётся нетронутым, файл — на месте.
    expect(deleted).not.toContain(base.sourceUrl);
    expect(db.get("twin-2")!.sourceUrl).toBe(base.sourceUrl);
    expect(db.get("twin-2")!.status).toBe("pending");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. Сбой записи в Blob на отметке rendering
// ─────────────────────────────────────────────────────────────────────────────
describe("D. Blob отдал 429 на записи статуса rendering", () => {
  it("единичный сбой записи не должен убивать цепочку рендера всей пачки молча", async () => {
    const pending: Item[] = [1, 2, 3].map((n) => ({
      ...base,
      itemId: `p${n}`,
      index: n,
      total: 3,
      status: "pending" as const,
      videoUrl: null,
      messageId: null,
    }));
    const notify = vi.fn(async () => {});
    const triggerRender = vi.fn(async () => {});

    const deps: RenderTickDeps = {
      now: () => NOW,
      listItems: async () => pending.map((i) => ({ ...i })),
      saveItem: async () => {
        throw new Error("Blob put failed (429): rate limited");
      },
      renderItem: async () => "https://blob/out/p1.mp4",
      queueRendered: async () => new Date(NOW + 3_600_000).toISOString(),
      formatSlot: (iso: string) => iso,
      sendVideoWithButtons: async () => 42,
      deleteBlobQuiet: async () => {},
      notify,
      triggerRender,
    };

    // Ожидание: тик либо переживает сбой и идёт дальше, либо переназначает
    // цепочку/пишет в чат. Сейчас исключение вылетает наружу, а роут ловит его
    // в `after(...).catch(console.error)` — в чате тишина, пачка встала.
    await runRenderTick("b1", deps);
    expect(notify.mock.calls.length + triggerRender.mock.calls.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. Правка описания: карточка уходит в чат раньше записи
// ─────────────────────────────────────────────────────────────────────────────
describe("E. правка описания, запись в Blob упала", () => {
  it("карточка с кнопками не должна появляться в чате, если статус review не сохранился", async () => {
    const editing: Item = { ...base, status: "editing", editPromptId: 77 };
    const store = new Map<string, Item>([[editing.itemId, editing]]);
    const sendVideoWithButtons = vi.fn(async () => 500);

    const deps = approveDeps(editing, {
      listItems: async () => [...store.values()].map((i) => ({ ...i })),
      loadItem: async (id) => {
        const found = store.get(id);
        return found ? { ...found } : null;
      },
      sendVideoWithButtons,
      saveItem: async () => {
        throw new Error("Blob put failed (500)");
      },
    });

    await expect(
      handleEditReply(
        { chatId: base.chatId, threadId: null, text: "Новое описание", replyToMessageId: 77 },
        deps
      )
    ).rejects.toThrow(/500/);

    // Ролик остался editing, а в чате уже висит карточка с живыми кнопками:
    // нажатие на неё отвечает «Уже обработано: editing» и ролик заперт до
    // семисуточной уборки. Отправлять карточку до успешной записи нельзя.
    expect(store.get(editing.itemId)!.status).toBe("editing");
    expect(sendVideoWithButtons).not.toHaveBeenCalled();
  });
});
