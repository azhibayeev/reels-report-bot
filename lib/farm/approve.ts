import { escapeHtml } from "../format";
import { sendMessage } from "../telegram";
import { formatSlot, parseCallback } from "./commands";
import { MAX_CAPTION } from "./parse";
import { nextFreeSlot, slotConfigFromEnv } from "./slots";
import { deleteBlobQuiet, listItems, loadItem, saveItem } from "./store";
import {
  answerCallback,
  askForReply,
  dropKeyboard,
  editCaption,
  farmCaption,
  sendVideoWithButtons,
} from "./telegram";
import { Item } from "./types";

export interface ApproveDeps {
  now: () => number;
  loadItem: (itemId: string) => Promise<Item | null>;
  listItems: () => Promise<Item[]>;
  saveItem: (item: Item) => Promise<void>;
  deleteBlobQuiet: (url: string) => Promise<void>;
  nextFreeSlot: (taken: string[], nowMs: number) => string;
  answerCallback: (callbackId: string, text: string) => Promise<void>;
  dropKeyboard: (chatId: number, messageId: number) => Promise<void>;
  editCaption: (chatId: number, messageId: number, caption: string) => Promise<void>;
  askForReply: (args: { chatId: number; threadId: number | null; text: string }) => Promise<number>;
  sendVideoWithButtons: (args: {
    chatId: number;
    threadId: number | null;
    videoUrl: string;
    caption: string;
    itemId: string;
  }) => Promise<number>;
  notify: (text: string, threadId: number | null) => Promise<void>;
  formatSlot: (iso: string) => string;
}

export function liveApproveDeps(): ApproveDeps {
  const cfg = slotConfigFromEnv();
  return {
    now: () => Date.now(),
    loadItem,
    listItems,
    saveItem,
    deleteBlobQuiet,
    nextFreeSlot: (taken, nowMs) => nextFreeSlot(taken, nowMs, cfg),
    answerCallback,
    dropKeyboard,
    editCaption,
    askForReply,
    sendVideoWithButtons,
    notify: (text, threadId) => sendMessage(escapeHtml(text), { thread: threadId }),
    formatSlot: (iso) => formatSlot(iso, cfg.tz),
  };
}

// Статусы, чьи слоты уже кому-то принадлежат: их нельзя выдать второй раз.
const SLOT_TAKEN_STATUSES = new Set(["queued", "posting", "posted"]);

export async function handleCallback(
  cb: { id: string; data: string; chatId: number },
  deps: ApproveDeps
): Promise<void> {
  const parsed = parseCallback(cb.data);
  if (!parsed) {
    await deps.answerCallback(cb.id, "Не понял кнопку");
    return;
  }

  const item = await deps.loadItem(parsed.itemId);
  if (!item) {
    await deps.answerCallback(cb.id, "Ролик не найден");
    return;
  }

  if (item.status !== "review") {
    // Листать чат вверх и жать повторно — норма: не трогаем статус и не пишем в стор.
    await deps.answerCallback(cb.id, `Уже обработано: ${item.status}`);
    if (item.messageId !== null) await deps.dropKeyboard(item.chatId, item.messageId);
    return;
  }

  if (parsed.action === "approve") {
    const taken = (await deps.listItems())
      .filter((i) => SLOT_TAKEN_STATUSES.has(i.status))
      .map((i) => i.scheduledAt)
      .filter((s): s is string => s !== null);
    const slot = deps.nextFreeSlot(taken, deps.now());
    await deps.saveItem({ ...item, status: "queued", scheduledAt: slot });
    await deps.answerCallback(cb.id, "В очередь");
    if (item.messageId !== null) {
      await deps.dropKeyboard(item.chatId, item.messageId);
      await deps.editCaption(
        item.chatId,
        item.messageId,
        `✅ ${item.index}/${item.total} — в очереди на ${deps.formatSlot(slot)}`
      );
    }
    return;
  }

  if (parsed.action === "reject") {
    await deps.saveItem({ ...item, status: "rejected" });
    if (item.videoUrl) await deps.deleteBlobQuiet(item.videoUrl);
    await deps.answerCallback(cb.id, "Выкинул");
    if (item.messageId !== null) {
      await deps.dropKeyboard(item.chatId, item.messageId);
      await deps.editCaption(item.chatId, item.messageId, `❌ ${item.index}/${item.total} — выкинут`);
    }
    return;
  }

  // edit: правится только описание, хук вжарен в пиксели рендера.
  const promptId = await deps.askForReply({
    chatId: item.chatId,
    threadId: item.threadId,
    text: `Ответьте на это сообщение новым описанием для ролика ${item.index}/${item.total}. Хук останется прежним.`,
  });
  await deps.saveItem({ ...item, status: "editing", editPromptId: promptId });
  await deps.answerCallback(cb.id, "Жду новое описание");
  // Снимаем кнопки со старой карточки сразу: иначе после правки в чате будет
  // две карточки с живыми кнопками на один и тот же ролик — это путает при апруве.
  if (item.messageId !== null) await deps.dropKeyboard(item.chatId, item.messageId);
}

export async function handleEditReply(
  msg: { chatId: number; threadId: number | null; text: string; replyToMessageId: number | null },
  deps: ApproveDeps
): Promise<boolean> {
  if (!msg.replyToMessageId) return false;

  const items = await deps.listItems();
  const item = items.find((i) => i.status === "editing" && i.editPromptId === msg.replyToMessageId);
  if (!item) return false;

  const text = msg.text.trim();
  if (text.length === 0) {
    await deps.notify("Пустое описание не принято: пришлите текст ещё раз.", msg.threadId);
    return true;
  }
  if (text.length > MAX_CAPTION) {
    await deps.notify(
      `Слишком длинное описание: ${text.length} знаков при лимите ${MAX_CAPTION}. Пришлите короче.`,
      msg.threadId
    );
    return true;
  }

  const messageId = await deps.sendVideoWithButtons({
    chatId: item.chatId,
    threadId: item.threadId,
    // При статусе editing ролик уже прошёл рендер, значит videoUrl всегда заполнен.
    videoUrl: item.videoUrl as string,
    caption: farmCaption(item.index, item.total, item.hook, text),
    itemId: item.itemId,
  });
  await deps.saveItem({ ...item, caption: text, status: "review", editPromptId: null, messageId });
  return true;
}
