export const CAPTION_BODY_LIMIT = 700;

interface Button {
  text: string;
  callback_data: string;
}

export interface Keyboard {
  inline_keyboard: Button[][];
}

function api(method: string): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function call(method: string, payload: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(api(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Telegram ${method} failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}

export function approvalKeyboard(itemId: string): Keyboard {
  return {
    inline_keyboard: [
      [
        { text: "✅ Залить", callback_data: `a:${itemId}` },
        { text: "❌ Выкинуть", callback_data: `r:${itemId}` },
        { text: "✏️ Текст", callback_data: `e:${itemId}` },
      ],
    ],
  };
}

/**
 * Клавиатура ролика, который уже стоит в очереди. «Залить» тут нет: ролик
 * попадает в очередь сам, сразу после сборки. Шестьдесят подтверждений на пачку
 * — это ручная работа, ради отмены которой ферма и затевалась, а уходят ролики
 * в Trial Reels, то есть видны только не-подписчикам.
 *
 * Обе оставшиеся кнопки работают до наступления слота и служат страховкой:
 * неудачный ролик можно снять, описание — переписать.
 */
export function queuedKeyboard(itemId: string): Keyboard {
  return {
    inline_keyboard: [
      [
        { text: "❌ Выкинуть", callback_data: `r:${itemId}` },
        { text: "✏️ Текст", callback_data: `e:${itemId}` },
      ],
    ],
  };
}

// Подпись к видео в Telegram ограничена 1024 знаками против 2200 в Instagram,
// поэтому описание здесь урезано: полный текст всё равно уходит в публикацию.
export function farmCaption(index: number, total: number, hook: string, caption: string): string {
  const body = caption.length > CAPTION_BODY_LIMIT ? `${caption.slice(0, CAPTION_BODY_LIMIT)}…` : caption;
  return `${index}/${total}\n\n${hook}\n\n${body}`;
}

export async function sendVideoWithButtons(args: {
  chatId: number;
  threadId: number | null;
  videoUrl: string;
  caption: string;
  itemId: string;
  /** Ролик уже в очереди — тогда без «Залить». */
  queued?: boolean;
}): Promise<number> {
  const result = await call("sendVideo", {
    chat_id: args.chatId,
    ...(args.threadId ? { message_thread_id: args.threadId } : {}),
    video: args.videoUrl,
    caption: args.caption,
    supports_streaming: true,
    reply_markup: args.queued ? queuedKeyboard(args.itemId) : approvalKeyboard(args.itemId),
  });
  return (result.result as { message_id: number }).message_id;
}

export async function editCaption(chatId: number, messageId: number, caption: string): Promise<void> {
  await call("editMessageCaption", { chat_id: chatId, message_id: messageId, caption });
}

export async function dropKeyboard(chatId: number, messageId: number): Promise<void> {
  await call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
}

// Без ответа на callback у человека в клиенте крутится вечный спиннер.
export async function answerCallback(callbackId: string, text: string): Promise<void> {
  await call("answerCallbackQuery", { callback_query_id: callbackId, text });
}

export async function askForReply(args: { chatId: number; threadId: number | null; text: string }): Promise<number> {
  const result = await call("sendMessage", {
    chat_id: args.chatId,
    ...(args.threadId ? { message_thread_id: args.threadId } : {}),
    text: args.text,
    reply_markup: { force_reply: true },
  });
  return (result.result as { message_id: number }).message_id;
}
