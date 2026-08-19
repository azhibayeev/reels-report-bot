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

export function liveApproveDeps(rhythm?: { minutes: number; perDay: number } | null): ApproveDeps {
  // Регулярность из состояния важнее переменных окружения: её меняют командой
  // /rhythm без редеплоя, а env остаётся значением по умолчанию.
  const cfg = { ...slotConfigFromEnv(), ...(rhythm ? { minutes: rhythm.minutes, perDay: rhythm.perDay } : {}) };
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

// Замок сериализует критическую секцию апрува («прочитать занятые слоты →
// выбрать свободный → записать queued») в пределах ЭТОГО инстанса: без него
// два параллельных апрува оба читают listItems() до того, как первый запишет
// свой слот, и получают один и тот же слот на двоих. Работает только внутри
// процесса — межинстансную гонку (два разных вызова Vercel одновременно) это
// не закрывает, там единственная защита — то же перечитывание после записи.
let approveChain: Promise<void> = Promise.resolve();

async function withApproveLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = approveChain.catch(() => {});
  let release: () => void = () => {};
  approveChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

// Косметика Telegram (снятие клавиатуры, перерисовка подписи, ответ на
// callback) не должна ронять апрув/реджект: сообщение бота старше 48 часов
// Telegram не даёт редактировать, а на серии нажатий отдаёт 429 — статус к
// этому моменту уже сохранён, и терять его из-за отказа косметики нельзя.
async function cosmetic(action: () => Promise<void>, label: string, itemId: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(`farm ${label} failed`, itemId, error);
  }
}

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
    await cosmetic(() => deps.answerCallback(cb.id, `Уже обработано: ${item.status}`), "answerCallback", item.itemId);
    const messageId = item.messageId;
    if (messageId !== null) {
      await cosmetic(() => deps.dropKeyboard(item.chatId, messageId), "dropKeyboard", item.itemId);
    }
    return;
  }

  if (parsed.action === "approve") {
    const slot = await withApproveLock(async () => {
      // Перечитываем задачу УЖЕ внутри замка: item выше захвачен ДО входа в
      // критическую секцию, и при двух нажатиях подряд по одной карточке
      // оба вызова handleCallback проходят проверку `status !== "review"` с
      // одним и тем же старым item, а слот выдаётся дважды. Здесь же второй
      // проход видит, что первый уже перевёл задачу в queued, и уходит без
      // saveItem.
      const fresh = await deps.loadItem(item.itemId);
      if (!fresh || fresh.status !== "review") return null;
      const taken = (await deps.listItems())
        .filter((i) => SLOT_TAKEN_STATUSES.has(i.status))
        .map((i) => i.scheduledAt)
        .filter((s): s is string => s !== null);
      const chosen = deps.nextFreeSlot(taken, deps.now());
      await deps.saveItem({ ...fresh, status: "queued", scheduledAt: chosen });
      return chosen;
    });
    if (slot === null) {
      // Задачу уже обработали (второй апрув по той же карточке) — трогать
      // стор больше не нужно, ограничиваемся косметикой.
      await cosmetic(() => deps.answerCallback(cb.id, "Уже обработано"), "answerCallback", item.itemId);
      return;
    }
    // Статус уже записан — дальше только косметика Telegram, её отказ (карточка
    // старше 48 часов, 429 на серии апрувов) не должен откатывать «В очереди».
    await cosmetic(() => deps.answerCallback(cb.id, "В очередь"), "answerCallback", item.itemId);
    const messageId = item.messageId;
    if (messageId !== null) {
      await cosmetic(() => deps.dropKeyboard(item.chatId, messageId), "dropKeyboard", item.itemId);
      await cosmetic(
        () =>
          deps.editCaption(
            item.chatId,
            messageId,
            `✅ ${item.index}/${item.total} — в очереди на ${deps.formatSlot(slot)}`
          ),
        "editCaption",
        item.itemId
      );
    }
    return;
  }

  if (parsed.action === "reject") {
    await deps.saveItem({ ...item, status: "rejected" });
    if (item.videoUrl) await deps.deleteBlobQuiet(item.videoUrl);
    await cosmetic(() => deps.answerCallback(cb.id, "Выкинул"), "answerCallback", item.itemId);
    const messageId = item.messageId;
    if (messageId !== null) {
      await cosmetic(() => deps.dropKeyboard(item.chatId, messageId), "dropKeyboard", item.itemId);
      await cosmetic(
        () => deps.editCaption(item.chatId, messageId, `❌ ${item.index}/${item.total} — выкинут`),
        "editCaption",
        item.itemId
      );
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
  await cosmetic(() => deps.answerCallback(cb.id, "Жду новое описание"), "answerCallback", item.itemId);
  // Снимаем кнопки со старой карточки сразу: иначе после правки в чате будет
  // две карточки с живыми кнопками на один и тот же ролик — это путает при апруве.
  const messageId = item.messageId;
  if (messageId !== null) {
    await cosmetic(() => deps.dropKeyboard(item.chatId, messageId), "dropKeyboard", item.itemId);
  }
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

  // Сохраняем новое описание ДО отправки карточки: раньше сначала уходила
  // карточка с живыми кнопками, а запись падала следом — ролик оставался
  // editing с висящей в чате кнопкой, которая отвечает «Уже обработано» и
  // запирает ролик до семисуточной уборки. Если саму отправку не удастся
  // выполнить дальше, ошибку пробрасываем — текст к этому моменту уже цел.
  await deps.saveItem({ ...item, caption: text, status: "review", editPromptId: null });

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
