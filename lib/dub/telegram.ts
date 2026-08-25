import { requireEnv } from "./elevenlabs";

// Телеграм не отдаёт ботам файлы больше 20 МБ и не принимает отправку больше 50 МБ.
// Это лимиты Bot API: обойти их из кода нельзя, только объяснить человеку.
export const DOWNLOAD_LIMIT = 20 * 1024 * 1024;
export const UPLOAD_LIMIT = 50 * 1024 * 1024;

function api(method: string): string {
  return `https://api.telegram.org/bot${requireEnv("DUB_BOT_TOKEN")}/${method}`;
}

async function call<T>(method: string, payload: unknown): Promise<T> {
  const res = await fetch(api(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
  return data.result as T;
}

async function upload<T>(method: string, form: FormData): Promise<T> {
  const res = await fetch(api(method), { method: "POST", body: form, cache: "no-store" });
  const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
  return data.result as T;
}

/** Возвращает message_id: статус живёт в одном сообщении, которое потом правится. */
export async function sendMessage(chatId: number | string, text: string): Promise<number> {
  const msg = await call<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
  });
  return msg.message_id;
}

// Правка статуса — не главное: сорвалась она или нет, дубляж всё равно должен доехать.
export async function editMessage(chatId: number | string, messageId: number, text: string): Promise<void> {
  try {
    await call("editMessageText", { chat_id: chatId, message_id: messageId, text });
  } catch {
    /* пусто: сообщение могли удалить, текст мог не измениться */
  }
}

export async function deleteMessage(chatId: number | string, messageId: number): Promise<void> {
  try {
    await call("deleteMessage", { chat_id: chatId, message_id: messageId });
  } catch {
    /* пусто */
  }
}

export async function getFileBuffer(fileId: string): Promise<Buffer> {
  const file = await call<{ file_path: string }>("getFile", { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${requireEnv("DUB_BOT_TOKEN")}/${file.file_path}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Файл не скачался из Telegram: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export interface VideoMeta {
  width?: number;
  height?: number;
  duration?: number;
}

// Без width/height Telegram рисует ролик квадратом, пока не обработает файл сам:
// размеры берём из исходного сообщения — дубляж не меняет картинку.
export async function sendVideo(
  chatId: number | string,
  video: Buffer,
  filename: string,
  caption: string,
  meta: VideoMeta = {}
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("video", new Blob([new Uint8Array(video)], { type: "video/mp4" }), filename);
  form.append("caption", caption);
  form.append("supports_streaming", "true");
  if (meta.width) form.append("width", String(meta.width));
  if (meta.height) form.append("height", String(meta.height));
  if (meta.duration) form.append("duration", String(Math.round(meta.duration)));
  await upload("sendVideo", form);
}

// Дубляж голосового или аудиофайла — это аудио, а не видео: sendVideo такой
// файл либо отвергнет, либо покажет чёрным прямоугольником.
export async function sendAudio(
  chatId: number | string,
  audio: Buffer,
  filename: string,
  caption: string
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("audio", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), filename);
  form.append("caption", caption);
  await upload("sendAudio", form);
}

export async function setWebhook(url: string, secret: string): Promise<void> {
  await call("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
}

export interface TgMedia {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_name?: string;
  mime_type?: string;
  width?: number;
  height?: number;
  duration?: number;
}

export interface TgMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  video?: TgMedia;
  audio?: TgMedia;
  voice?: TgMedia;
  video_note?: TgMedia;
  document?: TgMedia;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

/** Видео, аудио, кружок или документ с медийным mime — всё, что имеет смысл дублировать. */
export function pickMedia(msg: TgMessage): TgMedia | null {
  const doc = /^(video|audio)\//.test(msg.document?.mime_type || "") ? msg.document : null;
  return msg.video || msg.audio || msg.voice || msg.video_note || doc || null;
}
