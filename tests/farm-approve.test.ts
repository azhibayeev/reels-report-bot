import { describe, expect, it, vi } from "vitest";
import { ApproveDeps, handleCallback, handleEditReply } from "../lib/farm/approve";
import { farmCaption } from "../lib/farm/telegram";
import { MAX_CAPTION } from "../lib/farm/parse";
import { Item } from "../lib/farm/types";

const base: Item = {
  itemId: "i1", batchId: "b1", chatId: -1, threadId: null, index: 2, total: 30,
  hook: "Хук", caption: "Описание", sourceUrl: "https://x/s.mp4", videoUrl: "https://out/video.mp4",
  messageId: 777, editPromptId: null, status: "review",
  renderingAt: null, postingAt: null, scheduledAt: null,
  igMediaId: null, permalink: null, error: null, createdAt: "2026-08-19T00:00:00.000Z",
};
const NOW = Date.parse("2026-08-19T01:00:00.000Z");
const SLOT = "2026-08-20T02:00:00.000Z";

// Стенд: массив items играет роль стора, остальные deps — шпионы.
function makeDeps(items: Item[], overrides: Partial<ApproveDeps> = {}): { deps: ApproveDeps; items: Item[] } {
  const deps: ApproveDeps = {
    now: () => NOW,
    loadItem: async (itemId) => items.find((i) => i.itemId === itemId) ?? null,
    listItems: async () => items.map((i) => ({ ...i })),
    saveItem: vi.fn(async (item: Item) => {
      const idx = items.findIndex((i) => i.itemId === item.itemId);
      if (idx === -1) items.push(item);
      else items[idx] = item;
    }),
    deleteBlobQuiet: vi.fn(async () => {}),
    nextFreeSlot: vi.fn(() => SLOT),
    answerCallback: vi.fn(async () => {}),
    dropKeyboard: vi.fn(async () => {}),
    editCaption: vi.fn(async () => {}),
    askForReply: vi.fn(async () => 999),
    sendVideoWithButtons: vi.fn(async () => 888),
    notify: vi.fn(async () => {}),
    formatSlot: (iso: string) => `слот:${iso}`,
    ...overrides,
  };
  return { deps, items };
}

describe("handleEditReply: возврат в расписание", () => {
  it("после правки описания ролик возвращается в очередь, а не выпадает из неё", async () => {
    // При ручном апруве review был честной остановкой: человек всё равно жал
    // «Залить». С автозаливкой это ловушка — поправил текст, и ролик тихо
    // перестал быть запланированным, а сообщить об этом некому.
    const editing: Item = {
      ...base,
      status: "editing",
      editPromptId: 999,
      scheduledAt: null,
      videoUrl: "https://out/video.mp4",
    };
    const { deps, items } = makeDeps([editing]);

    const handled = await handleEditReply(
      { chatId: -1, threadId: null, text: "Новое описание", replyToMessageId: 999 },
      deps
    );

    expect(handled).toBe(true);
    expect(items[0].status).toBe("queued");
    expect(items[0].scheduledAt).toBe(SLOT);
    expect(items[0].caption).toBe("Новое описание");
    // Новая карточка приходит без «Залить» и называет время.
    expect(deps.sendVideoWithButtons).toHaveBeenCalledWith(
      expect.objectContaining({ queued: true, caption: expect.stringContaining("слот:") })
    );
  });
});

describe("handleCallback", () => {
  it("ролик ещё собирается — карточка НЕ теряет кнопки", async () => {
    // Ловушка, на которую напоролись вживую. Карточка появляется в чате на
    // мгновение раньше, чем задача помечается review: видео сначала уходит в
    // Telegram, и только потом пишется статус. Нажатие в этот зазор попадало в
    // ветку «не review» — человеку отвечали «Уже обработано: rendering», а
    // клавиатуру снимали. Ролик через секунду становился годным к апруву, но
    // жать было уже нечего: единственная карточка осталась без кнопок.
    for (const status of ["pending", "rendering"] as const) {
      const { deps, items } = makeDeps([{ ...base, status }]);
      await handleCallback({ id: "cb1", data: "a:i1", chatId: -1 }, deps);

      expect(deps.dropKeyboard).not.toHaveBeenCalled();
      expect(deps.saveItem).not.toHaveBeenCalled();
      expect(items[0].status).toBe(status);
      const said = (deps.answerCallback as unknown as { mock: { calls: string[][] } }).mock.calls[0][1];
      expect(said).not.toContain("Уже обработано");
      expect(said).toMatch(/собирается|секунд/i);
    }
  });

  it("ролик из очереди можно выкинуть: слот ещё не наступил", async () => {
    // С отменой ручного апрува это единственная страховка. Ролик встаёт в
    // очередь сам, и «Выкинуть» — единственный способ снять его до слота.
    // Пока действовала проверка «только review», кнопка на такой карточке
    // отвечала «Уже обработано: queued» и снимала сама себя.
    const { deps, items } = makeDeps([
      { ...base, status: "queued", scheduledAt: SLOT, videoUrl: "https://out/video.mp4" },
    ]);

    await handleCallback({ id: "cb1", data: "r:i1", chatId: -1 }, deps);

    expect(items[0].status).toBe("rejected");
    expect(deps.deleteBlobQuiet).toHaveBeenCalledWith("https://out/video.mp4");
    expect(deps.answerCallback).toHaveBeenCalledWith("cb1", "Выкинул");
  });

  it("описание у ролика из очереди тоже правится: публикация ещё впереди", async () => {
    const { deps } = makeDeps([{ ...base, status: "queued", scheduledAt: SLOT }]);

    await handleCallback({ id: "cb1", data: "e:i1", chatId: -1 }, deps);

    expect(deps.askForReply).toHaveBeenCalled();
  });

  it("а вот уже улетевший в Instagram ролик кнопки теряет — жать по нему нечего", async () => {
    for (const status of ["posting", "posted", "rejected"] as const) {
      const { deps } = makeDeps([{ ...base, status }]);
      await handleCallback({ id: "cb1", data: "a:i1", chatId: -1 }, deps);

      expect(deps.dropKeyboard).toHaveBeenCalledWith(base.chatId, base.messageId);
      expect(deps.saveItem).not.toHaveBeenCalled();
      const said = (deps.answerCallback as unknown as { mock: { calls: string[][] } }).mock.calls[0][1];
      expect(said).toContain("Уже обработано");
    }
  });

  it("задача исчезла между двумя чтениями — говорим об этом прямо, а не «уже обработано»", async () => {
    // Разные беды с разными действиями: «уже обработано» значит «всё в порядке,
    // просто дважды нажали», а пропавшая задача — это сбой, о котором надо знать.
    let reads = 0;
    const { deps } = makeDeps([{ ...base, status: "review" }], {
      loadItem: async (itemId) => {
        reads += 1;
        return reads === 1 ? { ...base, itemId, status: "review" } : null;
      },
    });

    await handleCallback({ id: "cb1", data: "a:i1", chatId: -1 }, deps);

    const said = (deps.answerCallback as unknown as { mock: { calls: string[][] } }).mock.calls[0][1];
    expect(said).toContain("исчез");
    expect(deps.saveItem).not.toHaveBeenCalled();
  });

  it("мусорный callback_data — отвечает и ничего не грузит", async () => {
    const { deps } = makeDeps([]);
    const loadSpy = vi.spyOn(deps, "loadItem" as never);
    await handleCallback({ id: "cb1", data: "x:i1", chatId: -1 }, deps);
    expect(deps.answerCallback).toHaveBeenCalledWith("cb1", "Не понял кнопку");
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it("ролик не найден", async () => {
    const { deps } = makeDeps([]);
    await handleCallback({ id: "cb1", data: "a:missing", chatId: -1 }, deps);
    expect(deps.answerCallback).toHaveBeenCalledWith("cb1", "Ролик не найден");
    expect(deps.saveItem).not.toHaveBeenCalled();
  });

  it("«Залить» по ролику из очереди сообщает, что он уже там — но кнопки оставляет", async () => {
    // Кнопки снимать нельзя: рядом «Выкинуть», и она ещё нужна — слот впереди.
    const { deps, items } = makeDeps([{ ...base, status: "queued", scheduledAt: SLOT }]);
    await handleCallback({ id: "cb1", data: "a:i1", chatId: -1 }, deps);
    expect(deps.answerCallback).toHaveBeenCalledWith("cb1", "Уже обработано");
    expect(deps.dropKeyboard).not.toHaveBeenCalled();
    expect(deps.saveItem).not.toHaveBeenCalled();
    expect(items[0].status).toBe("queued");
  });

  it("approve: собирает занятые слоты только из queued/posting/posted, переводит в queued", async () => {
    const busy = { ...base, itemId: "busy", status: "queued" as const, scheduledAt: "2026-08-20T00:00:00.000Z" };
    const posting = { ...base, itemId: "post1", status: "posting" as const, scheduledAt: "2026-08-20T01:00:00.000Z" };
    const posted = { ...base, itemId: "post2", status: "posted" as const, scheduledAt: "2026-08-20T03:00:00.000Z" };
    const irrelevant = { ...base, itemId: "rej", status: "rejected" as const, scheduledAt: "2026-08-20T04:00:00.000Z" };
    const { deps, items } = makeDeps([{ ...base }, busy, posting, posted, irrelevant]);

    await handleCallback({ id: "cb1", data: "a:i1", chatId: -1 }, deps);

    expect(deps.nextFreeSlot).toHaveBeenCalledWith(
      expect.arrayContaining([busy.scheduledAt, posting.scheduledAt, posted.scheduledAt]),
      NOW
    );
    expect((deps.nextFreeSlot as ReturnType<typeof vi.fn>).mock.calls[0][0]).toHaveLength(3);
    const saved = items.find((i) => i.itemId === "i1")!;
    expect(saved.status).toBe("queued");
    expect(saved.scheduledAt).toBe(SLOT);
    expect(deps.answerCallback).toHaveBeenCalledWith("cb1", "В очередь");
    expect(deps.dropKeyboard).toHaveBeenCalledWith(base.chatId, base.messageId);
    expect(deps.editCaption).toHaveBeenCalledWith(base.chatId, base.messageId, `✅ 2/30 — в очереди на ${deps.formatSlot(SLOT)}`);
  });

  it("reject: помечает rejected, удаляет videoUrl из блоба, переписывает подпись", async () => {
    const { deps, items } = makeDeps([{ ...base }]);

    await handleCallback({ id: "cb1", data: "r:i1", chatId: -1 }, deps);

    const saved = items.find((i) => i.itemId === "i1")!;
    expect(saved.status).toBe("rejected");
    expect(deps.deleteBlobQuiet).toHaveBeenCalledWith(base.videoUrl);
    expect(deps.answerCallback).toHaveBeenCalledWith("cb1", "Выкинул");
    expect(deps.dropKeyboard).toHaveBeenCalledWith(base.chatId, base.messageId);
    expect(deps.editCaption).toHaveBeenCalledWith(base.chatId, base.messageId, "❌ 2/30 — выкинут");
  });

  it("reject без videoUrl — deleteBlobQuiet не звать", async () => {
    const { deps } = makeDeps([{ ...base, videoUrl: null }]);
    await handleCallback({ id: "cb1", data: "r:i1", chatId: -1 }, deps);
    expect(deps.deleteBlobQuiet).not.toHaveBeenCalled();
  });

  it("повторный апрув той же задачи внутри замка не выдаёт второй слот", async () => {
    // Первый loadItem (до withApproveLock) ещё видит review — иначе тест не
    // дошёл бы до замка вообще. Второй loadItem — уже внутри критической
    // секции: к этому моменту «параллельный» апрув успел записать queued.
    // Именно это перечитывание внутри замка и обязана делать критическая
    // секция, чтобы не выдать слот дважды.
    let loadCalls = 0;
    const nextFreeSlot = vi.fn(() => SLOT);
    const saveItem = vi.fn(async () => {});
    const { deps } = makeDeps([{ ...base }], {
      saveItem,
      nextFreeSlot,
      loadItem: async () => {
        loadCalls += 1;
        return loadCalls === 1 ? { ...base } : { ...base, status: "queued", scheduledAt: SLOT };
      },
    });

    await handleCallback({ id: "cb1", data: "a:i1", chatId: -1 }, deps);

    expect(nextFreeSlot).not.toHaveBeenCalled();
    expect(saveItem).not.toHaveBeenCalled();
    expect(deps.answerCallback).toHaveBeenCalledWith("cb1", "Уже обработано");
  });

  it("edit: просит новое описание, переводит в editing, снимает кнопки со старой карточки", async () => {
    const { deps, items } = makeDeps([{ ...base }]);

    await handleCallback({ id: "cb1", data: "e:i1", chatId: -1 }, deps);

    expect(deps.askForReply).toHaveBeenCalledWith({
      chatId: base.chatId,
      threadId: base.threadId,
      text: "Ответьте на это сообщение новым описанием для ролика 2/30. Хук останется прежним.",
    });
    const saved = items.find((i) => i.itemId === "i1")!;
    expect(saved.status).toBe("editing");
    expect(saved.editPromptId).toBe(999);
    expect(deps.answerCallback).toHaveBeenCalledWith("cb1", "Жду новое описание");
    expect(deps.dropKeyboard).toHaveBeenCalledWith(base.chatId, base.messageId);
  });
});

describe("handleEditReply", () => {
  it("без reply_to_message — false, стор не трогаем", async () => {
    const { deps } = makeDeps([{ ...base, status: "editing", editPromptId: 999 }]);
    const listSpy = vi.spyOn(deps, "listItems" as never);
    const result = await handleEditReply(
      { chatId: base.chatId, threadId: null, text: "новое описание", replyToMessageId: null },
      deps
    );
    expect(result).toBe(false);
    expect(listSpy).not.toHaveBeenCalled();
  });

  it("ответ на чужое сообщение — false", async () => {
    const { deps } = makeDeps([{ ...base, status: "editing", editPromptId: 999 }]);
    const result = await handleEditReply(
      { chatId: base.chatId, threadId: null, text: "новое описание", replyToMessageId: 12345 },
      deps
    );
    expect(result).toBe(false);
  });

  it("пустой текст — ошибка через notify, ролик остаётся в editing", async () => {
    const { deps, items } = makeDeps([{ ...base, status: "editing", editPromptId: 999 }]);
    const result = await handleEditReply(
      { chatId: base.chatId, threadId: null, text: "   ", replyToMessageId: 999 },
      deps
    );
    expect(result).toBe(true);
    expect(deps.notify).toHaveBeenCalled();
    expect(deps.saveItem).not.toHaveBeenCalled();
    expect(items[0].status).toBe("editing");
  });

  it("слишком длинный текст — ошибка через notify с числом знаков и лимитом", async () => {
    const { deps } = makeDeps([{ ...base, status: "editing", editPromptId: 999 }]);
    const longText = "a".repeat(MAX_CAPTION + 1);
    const result = await handleEditReply(
      { chatId: base.chatId, threadId: null, text: longText, replyToMessageId: 999 },
      deps
    );
    expect(result).toBe(true);
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining(String(longText.length)), null);
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining(String(MAX_CAPTION)), null);
    expect(deps.saveItem).not.toHaveBeenCalled();
  });

  it("валидный текст — меняет описание, возвращает в очередь, шлёт новую карточку", async () => {
    const { deps, items } = makeDeps([{ ...base, status: "editing", editPromptId: 999 }]);

    const result = await handleEditReply(
      { chatId: base.chatId, threadId: null, text: "Новое описание ролика", replyToMessageId: 999 },
      deps
    );

    expect(result).toBe(true);
    const saved = items.find((i) => i.itemId === "i1")!;
    expect(saved.status).toBe("queued");
    expect(saved.scheduledAt).toBe(SLOT);
    expect(saved.caption).toBe("Новое описание ролика");
    expect(saved.editPromptId).toBeNull();
    expect(saved.messageId).toBe(888);
    expect(deps.sendVideoWithButtons).toHaveBeenCalledWith({
      chatId: base.chatId,
      threadId: base.threadId,
      videoUrl: base.videoUrl,
      caption: `${farmCaption(base.index, base.total, base.hook, "Новое описание ролика")}\n\n🗓 В очереди на слот:${SLOT}`,
      itemId: base.itemId,
      queued: true,
    });
  });
});
