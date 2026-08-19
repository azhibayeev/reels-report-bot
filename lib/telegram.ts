function api(method: string): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return `https://api.telegram.org/bot${token}/${method}`;
}

function chatId(): string {
  const id = process.env.TELEGRAM_CHAT_ID;
  if (!id) throw new Error("TELEGRAM_CHAT_ID is not set");
  return id;
}

// Необязательный ID темы (вкладки) форум-группы: задан — пишем в неё, нет — в General.
function threadId(): string | undefined {
  return process.env.TELEGRAM_THREAD_ID || undefined;
}

export interface SendOptions {
  /** Тема форума для ответа: число — конкретная тема, null — General, undefined — тема из env. */
  thread?: number | null;
  /**
   * Чат для ответа. Задан — отвечаем туда, откуда пришла команда (это нужно для
   * лички); не задан — в группу из TELEGRAM_CHAT_ID, как было до появления лички.
   */
  chat?: number | string;
}

// Явный чат из опций важнее умолчания: иначе ответ на команду из лички улетел бы
// в группу, а человек в личке остался бы без ответа.
function targetChat(opts?: SendOptions): string {
  return opts?.chat !== undefined ? String(opts.chat) : chatId();
}

export async function sendMessage(html: string, opts?: SendOptions): Promise<void> {
  const thread = opts && "thread" in opts ? opts.thread : threadId() ? Number(threadId()) : null;
  const res = await fetch(api("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: targetChat(opts),
      ...(thread ? { message_thread_id: thread } : {}),
      text: html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    }),
  });
  if (!res.ok) {
    throw new Error(`Telegram sendMessage failed (${res.status}): ${await res.text()}`);
  }
}

export async function sendDocument(
  filename: string,
  content: string,
  caption?: string,
  opts?: SendOptions
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", targetChat(opts));
  const thread = opts && "thread" in opts ? opts.thread : threadId() ? Number(threadId()) : null;
  if (thread) form.append("message_thread_id", String(thread));
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([content], { type: "text/csv" }), filename);
  const res = await fetch(api("sendDocument"), { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`Telegram sendDocument failed (${res.status}): ${await res.text()}`);
  }
}

export async function sendPhoto(png: Buffer, caption?: string, opts?: SendOptions): Promise<void> {
  const form = new FormData();
  form.append("chat_id", targetChat(opts));
  const thread = opts && "thread" in opts ? opts.thread : threadId() ? Number(threadId()) : null;
  if (thread) form.append("message_thread_id", String(thread));
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
  }
  form.append("photo", new Blob([new Uint8Array(png)], { type: "image/png" }), "chart.png");
  const res = await fetch(api("sendPhoto"), { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`Telegram sendPhoto failed (${res.status}): ${await res.text()}`);
  }
}
