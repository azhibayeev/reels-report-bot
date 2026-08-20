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
import { queueRendered, takenSlots, withSlotLock } from "./queue";
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
    /** Ролик уже в очереди — тогда без «Залить». */
    queued?: boolean;
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

// Замок сериализует критическую секцию апрува («прочитать занятые слоты →
// выбрать свободный → записать queued») в пределах ЭТОГО инстанса: без него
// два параллельных апрува оба читают listItems() до того, как первый запишет
// свой слот, и получают один и тот же слот на двоих. Работает только внутри
// процесса — межинстансную гонку (два разных вызова Vercel одновременно) это
// не закрывает, там единственная защита — то же перечитывание после записи.
let approveChain: Promise<void> = Promise.resolve();


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

// Статусы, на которых карточка ещё что-то решает: ролик не улетел в Instagram,
// значит его можно выкинуть или переписать ему описание.
const REVOCABLE_STATUSES = new Set<string>(["review", "queued", "editing"]);

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

  // «Ещё не готов» и «уже поздно» — разные вещи, и путать их дорого.
  //
  // Карточка появляется в чате на мгновение раньше, чем задача помечается
  // review: видео сначала уходит в Telegram, и только потом пишется статус.
  // Нажатие в этот зазор попадало сюда же, куда и повторное нажатие по старой
  // карточке: человеку отвечали «Уже обработано: rendering» и снимали
  // клавиатуру. Через секунду ролик становился годным к апруву — но жать было
  // уже нечего, единственная карточка осталась без кнопок.
  if (item.status === "pending" || item.status === "rendering") {
    console.warn("farm approve: нажали до готовности", item.itemId, item.status);
    await cosmetic(
      () => deps.answerCallback(cb.id, "Ещё собирается — нажмите через несколько секунд"),
      "answerCallback",
      item.itemId
    );
    // Клавиатуру НЕ снимаем: она понадобится через мгновение.
    return;
  }

  // Пока слот не наступил, ролик ещё можно снять и поправить — а с отменой
  // ручного апрува он попадает в очередь сразу после сборки, минуя review.
  // Проверка «только review» оставила бы такие карточки без действующих
  // кнопок: единственная страховка от неудачного ролика перестала бы работать.
  if (!REVOCABLE_STATUSES.has(item.status)) {
    // Листать чат вверх и жать повторно — норма: не трогаем статус и не пишем в стор.
    console.warn("farm approve: карточка уже отработана", item.itemId, item.status);
    await cosmetic(() => deps.answerCallback(cb.id, `Уже обработано: ${item.status}`), "answerCallback", item.itemId);
    const messageId = item.messageId;
    if (messageId !== null) {
      await cosmetic(() => deps.dropKeyboard(item.chatId, messageId), "dropKeyboard", item.itemId);
    }
    return;
  }

  if (parsed.action === "approve") {
    const slot = await withSlotLock(async () => {
      // Перечитываем задачу УЖЕ внутри замка: item выше захвачен ДО входа в
      // критическую секцию, и при двух нажатиях подряд по одной карточке
      // оба вызова handleCallback проходят проверку `status !== "review"` с
      // одним и тем же старым item, а слот выдаётся дважды. Здесь же второй
      // проход видит, что первый уже перевёл задачу в queued, и уходит без
      // saveItem.
      const fresh = await deps.loadItem(item.itemId);
      // Различаем две причины отказа: задача пропала из стора (сбой, о котором
      // надо знать) и задачу уже обработал сосед по нажатию (штатное дело).
      if (!fresh) return "gone";
      if (fresh.status !== "review") return "taken";
      const chosen = deps.nextFreeSlot(takenSlots(await deps.listItems()), deps.now());
      await deps.saveItem({ ...fresh, status: "queued", scheduledAt: chosen });
      return chosen;
    });
    if (slot === "gone" || slot === "taken") {
      const text =
        slot === "gone"
          ? "Ролик исчез из хранилища — нажмите /reels"
          : "Уже обработано";
      console.warn("farm approve: слот не выдан", item.itemId, slot);
      // Стор трогать больше не нужно, ограничиваемся косметикой.
      await cosmetic(() => deps.answerCallback(cb.id, text), "answerCallback", item.itemId);
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

  // Возвращаем в очередь, а не в review. При ручном апруве review был честной
  // остановкой: человек всё равно жал «Залить». С автозаливкой это ловушка —
  // поправил описание, и ролик тихо перестал быть запланированным.
  //
  // Слот берём заново, а не возвращаем прежний: пока ролик лежал в editing, его
  // время было свободным и могло уйти соседу. queueRendered под общим замком
  // выдаст ближайшее незанятое.
  //
  // Запись идёт ДО отправки карточки: раньше сначала уходила карточка с живыми
  // кнопками, а запись падала следом — ролик оставался editing с висящей в чате
  // кнопкой, которая запирала его до семисуточной уборки.
  const edited = { ...item, caption: text, editPromptId: null };
  const slot = await queueRendered(edited, deps);

  const messageId = await deps.sendVideoWithButtons({
    chatId: item.chatId,
    threadId: item.threadId,
    // При статусе editing ролик уже прошёл рендер, значит videoUrl всегда заполнен.
    videoUrl: item.videoUrl as string,
    caption: `${farmCaption(item.index, item.total, item.hook, text)}\n\n🗓 В очереди на ${deps.formatSlot(slot)}`,
    itemId: item.itemId,
    queued: true,
  });
  await deps.saveItem({ ...edited, status: "queued", scheduledAt: slot, messageId });
  return true;
}
