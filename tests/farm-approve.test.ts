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

describe("handleCallback", () => {
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

  it("уже не review — сообщает статус, снимает кнопки, статус НЕ трогает", async () => {
    const { deps, items } = makeDeps([{ ...base, status: "queued" }]);
    await handleCallback({ id: "cb1", data: "a:i1", chatId: -1 }, deps);
    expect(deps.answerCallback).toHaveBeenCalledWith("cb1", "Уже обработано: queued");
    expect(deps.dropKeyboard).toHaveBeenCalledWith(base.chatId, base.messageId);
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

  it("валидный текст — меняет описание, возвращает review, шлёт новую карточку", async () => {
    const { deps, items } = makeDeps([{ ...base, status: "editing", editPromptId: 999 }]);

    const result = await handleEditReply(
      { chatId: base.chatId, threadId: null, text: "Новое описание ролика", replyToMessageId: 999 },
      deps
    );

    expect(result).toBe(true);
    const saved = items.find((i) => i.itemId === "i1")!;
    expect(saved.status).toBe("review");
    expect(saved.caption).toBe("Новое описание ролика");
    expect(saved.editPromptId).toBeNull();
    expect(saved.messageId).toBe(888);
    expect(deps.sendVideoWithButtons).toHaveBeenCalledWith({
      chatId: base.chatId,
      threadId: base.threadId,
      videoUrl: base.videoUrl,
      caption: farmCaption(base.index, base.total, base.hook, "Новое описание ролика"),
      itemId: base.itemId,
    });
  });
});
