import { createDubPreferClean, DubSource, getSubscription } from "./elevenlabs";
import { DubJob, saveJob } from "./jobs";
import {
  DOWNLOAD_LIMIT,
  editMessage,
  getFileBuffer,
  pickMedia,
  sendMessage,
  TgUpdate,
} from "./telegram";

export const HELP =
  "Кидай сюда видео (или аудио) на русском — верну его же с индонезийской озвучкой.\n\n" +
  "• Шли ролик файлом (скрепка → «Файл»), а не как видео: так Telegram не пережимает исходник " +
  "и озвучка ложится на оригинальную картинку.\n" +
  "• Telegram не отдаёт ботам файлы больше 20 МБ. Если ролик тяжелее — пришли ссылку " +
  "на него текстом, ElevenLabs скачает сам.\n" +
  "• /balance — остаток кредитов ElevenLabs.";

/** Пустой список — открыто всем: так бот работает сразу после деплоя, до того как узнан chat id. */
export function isAllowed(chatId: number): boolean {
  const allowed = (process.env.DUB_ALLOWED_CHAT_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.length === 0 || allowed.includes(String(chatId));
}

export function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(0);
}

/** Сырые ответы API человеку ничего не говорят — переводим известные на русский. */
export function explain(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/file is too big/i.test(raw)) {
    return "Telegram не отдаёт ботам файлы больше 20 МБ. Пришли ссылку на ролик текстом или сожми его";
  }
  if (/concurrent|too_many_dubbing/i.test(raw)) {
    return "ElevenLabs держит максимум 3 дубляжа разом — этот подождёт, пришли его снова через пару минут";
  }
  if (/quota|credits|character_limit/i.test(raw)) {
    return "закончились кредиты ElevenLabs — проверь /balance";
  }
  return raw;
}

export async function handleUpdate(update: TgUpdate): Promise<void> {
  const msg = update.message;
  if (!msg) return;
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) {
    console.log(`dub: чужой чат ${chatId} — игнор`);
    return;
  }

  const text = (msg.text || "").trim();

  if (/^\/(start|help)/.test(text)) {
    await sendMessage(chatId, HELP);
    return;
  }

  if (/^\/balance/.test(text)) {
    const s = await getSubscription();
    await sendMessage(chatId, `Тариф ${s.tier}: ${s.used} из ${s.limit} кредитов израсходовано.`);
    return;
  }

  const media = pickMedia(msg);
  if (media) {
    if ((media.file_size ?? 0) > DOWNLOAD_LIMIT) {
      await sendMessage(
        chatId,
        `Ролик ${mb(media.file_size as number)} МБ, а Telegram не отдаёт ботам больше 20 МБ.\n` +
          "Пришли ссылку на файл текстом — ElevenLabs скачает его сам, — или сожми ролик."
      );
      return;
    }
    const filename = media.file_name || `video-${media.file_unique_id}.mp4`;
    await start(
      chatId,
      msg.message_id,
      filename,
      async () => ({ file: { buffer: await getFileBuffer(media.file_id), filename }, name: filename }),
      { width: media.width, height: media.height, duration: media.duration }
    );
    return;
  }

  if (/^https?:\/\//i.test(text)) {
    const url = text.split(/\s+/)[0];
    const filename = (url.split("/").pop() || "video").split("?")[0];
    await start(chatId, msg.message_id, filename, async () => ({ url, name: filename }));
    return;
  }

  await sendMessage(chatId, HELP);
}

// Задача заводится под детерминированным id: повторная доставка того же апдейта
// Телеграмом перезапишет ту же запись, а не заведёт второй дубляж за те же деньги.
async function start(
  chatId: number,
  messageId: number,
  filename: string,
  source: () => Promise<Omit<DubSource, "watermark">>,
  meta: { width?: number; height?: number; duration?: number } = {}
): Promise<void> {
  const statusMessageId = await sendMessage(chatId, "Отправляю в ElevenLabs…");

  let created;
  try {
    created = await createDubPreferClean(await source());
  } catch (e) {
    // Правим то же сообщение: иначе в чате остаётся вечное «Отправляю…», а
    // объяснение приходит отдельной строкой ниже и выглядит как чужой ответ.
    await editMessage(chatId, statusMessageId, `Не вышло: ${explain(e)}`);
    throw e;
  }

  const job: DubJob = {
    jobId: `${chatId}-${messageId}`,
    chatId,
    statusMessageId,
    dubbingId: created.dubbingId,
    filename,
    watermarked: created.watermarked,
    ...meta,
    createdAt: new Date().toISOString(),
  };
  await saveJob(job);
  console.log(`dub: задача ${job.jobId} → ${created.dubbingId}`);
}
