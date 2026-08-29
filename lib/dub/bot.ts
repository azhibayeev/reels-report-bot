import { createDubPreferClean, DubSource, getSubscription } from "./elevenlabs";
import { DubJob, saveJob } from "./jobs";
import { deletePending, loadPending, PendingDub, savePending } from "./pending";
import {
  answerCallback,
  DOWNLOAD_LIMIT,
  editMessage,
  getFileBuffer,
  pickMedia,
  sendMessage,
  sendMessageWithButtons,
  TgCallbackQuery,
  TgUpdate,
} from "./telegram";
import { signUploadToken, UPLOAD_TOKEN_TTL_MS, uploadSecret } from "./tokens";

export const HELP =
  "Кидай сюда видео (или аудио) на русском — верну его же с индонезийской озвучкой.\n\n" +
  "• Шли ролик файлом (скрепка → «Файл»), а не как видео: так Telegram не пережимает исходник " +
  "и озвучка ложится на оригинальную картинку.\n" +
  "• На каждый ролик спрошу, вжигать ли индонезийские субтитры.\n" +
  "• Telegram не отдаёт ботам файлы больше 20 МБ. На тяжёлый ролик бот ответит ссылкой " +
  "на страницу загрузки — залей файл там, дубляж придёт сюда же.\n" +
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

/** Один и тот же id и у задачи, и у пути исходника в Blob — по осиротевшему файлу видно, чей он. */
export function jobIdOf(chatId: number, messageId: number): string {
  return `${chatId}-${messageId}`;
}

/**
 * Ссылка на страницу загрузки. Токен подписан и живёт час: ни chat id, ни номер
 * сообщения на сервере не хранятся — они внутри подписи.
 */
export function uploadLink(baseUrl: string, chatId: number, messageId: number, now = Date.now()): string {
  const token = signUploadToken({ chatId, messageId }, now + UPLOAD_TOKEN_TTL_MS, uploadSecret());
  return `${baseUrl.replace(/\/+$/, "")}/dub/${token}`;
}

export function tooBigText(bytes: number, link: string): string {
  return (
    `Ролик ${mb(bytes)} МБ, а Telegram не отдаёт ботам больше 20 МБ.\n\n` +
    `Залей его здесь — файл пойдёт мимо Telegram, а дубляж вернётся в этот чат:\n${link}\n\n` +
    "Ссылка живёт час."
  );
}

/** Сырые ответы API человеку ничего не говорят — переводим известные на русский. */
export function explain(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/file is too big/i.test(raw)) {
    return "Telegram не отдаёт ботам файлы больше 20 МБ. Пришли ролик ещё раз — бот ответит ссылкой на загрузку";
  }
  if (/concurrent|too_many_dubbing/i.test(raw)) {
    return "ElevenLabs держит максимум 3 дубляжа разом — этот подождёт, пришли его снова через пару минут";
  }
  if (/quota|credits|character_limit/i.test(raw)) {
    return "закончились кредиты ElevenLabs — проверь /balance";
  }
  return raw;
}

// ── Вопрос про субтитры ─────────────────────────────────────────────────────

export const ASK_TEXT = "Вжечь индонезийские субтитры в ролик?";
const CB_PREFIX = "sub:";

export function callbackData(subtitles: boolean, jobId: string): string {
  return `${CB_PREFIX}${subtitles ? 1 : 0}:${jobId}`;
}

/** У callback_data всего 64 байта, поэтому в ней только флаг и id задачи. */
export function parseCallback(data: string | undefined): { subtitles: boolean; jobId: string } | null {
  if (!data || !data.startsWith(CB_PREFIX)) return null;
  const rest = data.slice(CB_PREFIX.length);
  const at = rest.indexOf(":");
  if (at <= 0) return null;
  const flag = rest.slice(0, at);
  const jobId = rest.slice(at + 1);
  if ((flag !== "0" && flag !== "1") || !jobId) return null;
  return { subtitles: flag === "1", jobId };
}

/**
 * Спрашиваем ДО дубляжа, а сам ролик откладываем: file_id в callback_data не
 * влезает, поэтому источник ждёт ответа в Blob, а не в кнопке.
 */
export async function ask(
  chatId: number,
  messageId: number,
  source: Pick<PendingDub, "filename" | "fileId" | "sourceUrl" | "blobUrl" | "width" | "height" | "duration">
): Promise<void> {
  const jobId = jobIdOf(chatId, messageId);
  const askMessageId = await sendMessageWithButtons(chatId, ASK_TEXT, [
    { text: "С субтитрами", data: callbackData(true, jobId) },
    { text: "Без", data: callbackData(false, jobId) },
  ]);
  await savePending({
    jobId,
    chatId,
    messageId,
    askMessageId,
    createdAt: new Date().toISOString(),
    ...source,
  });
}

export async function handleCallback(cb: TgCallbackQuery): Promise<void> {
  const chatId = cb.message?.chat.id;
  const parsed = parseCallback(cb.data);
  if (chatId === undefined || !parsed || !isAllowed(chatId)) {
    // Отвечаем всё равно: иначе у нажавшего крутятся часики до таймаута Telegram.
    await answerCallback(cb.id);
    return;
  }

  const pending = await loadPending(parsed.jobId);
  if (!pending) {
    // Всплывашкой, а не правкой сообщения: запись могли снять по сроку, но
    // правка затёрла бы строку статуса, если задача всё-таки уже идёт.
    await answerCallback(cb.id, "Этот ролик уже не жду — пришли его заново");
    return;
  }

  await answerCallback(cb.id, parsed.subtitles ? "Дублирую с субтитрами" : "Дублирую без субтитров");
  // Снимаем до запуска: второй тычок по тем же кнопкам иначе завёл бы второй дубляж.
  await deletePending(pending.jobId);

  const filename = pending.filename;
  const source = pending.fileId
    ? async () => ({ file: { buffer: await getFileBuffer(pending.fileId as string), filename }, name: filename })
    : async () => ({ url: pending.sourceUrl as string, name: filename });

  await start({
    chatId,
    messageId: pending.messageId,
    filename,
    source,
    // Вопрос превращается в строку статуса: отдельное сообщение оставило бы в
    // чате кнопки, на которые уже нельзя нажать.
    statusMessageId: pending.askMessageId,
    job: {
      width: pending.width,
      height: pending.height,
      duration: pending.duration,
      blobUrl: pending.blobUrl,
      subtitles: parsed.subtitles,
    },
  });
}

// ── Входящие ────────────────────────────────────────────────────────────────

export async function handleUpdate(update: TgUpdate, baseUrl: string): Promise<void> {
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }

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
      await sendMessage(chatId, tooBigText(media.file_size as number, uploadLink(baseUrl, chatId, msg.message_id)));
      return;
    }
    await ask(chatId, msg.message_id, {
      filename: media.file_name || `video-${media.file_unique_id}.mp4`,
      fileId: media.file_id,
      width: media.width,
      height: media.height,
      duration: media.duration,
    });
    return;
  }

  if (/^https?:\/\//i.test(text)) {
    const url = text.split(/\s+/)[0];
    await ask(chatId, msg.message_id, {
      filename: (url.split("/").pop() || "video").split("?")[0],
      sourceUrl: url,
    });
    return;
  }

  await sendMessage(chatId, HELP);
}

export interface StartOptions {
  chatId: number;
  messageId: number;
  filename: string;
  source: () => Promise<Omit<DubSource, "watermark">>;
  /** Готовое сообщение под статус: вопрос про субтитры становится им же. */
  statusMessageId?: number;
  job?: Pick<DubJob, "width" | "height" | "duration" | "blobUrl" | "subtitles">;
}

// Задача заводится под детерминированным id: повторная доставка того же апдейта
// Телеграмом перезапишет ту же запись, а не заведёт второй дубляж за те же деньги.
export async function start(opts: StartOptions): Promise<void> {
  const { chatId, messageId, filename } = opts;
  const statusMessageId = opts.statusMessageId ?? (await sendMessage(chatId, "Отправляю в ElevenLabs…"));
  if (opts.statusMessageId) await editMessage(chatId, statusMessageId, "Отправляю в ElevenLabs…");

  let created;
  try {
    created = await createDubPreferClean(await opts.source());
  } catch (e) {
    // Правим то же сообщение: иначе в чате остаётся вечное «Отправляю…», а
    // объяснение приходит отдельной строкой ниже и выглядит как чужой ответ.
    await editMessage(chatId, statusMessageId, `Не вышло: ${explain(e)}`);
    throw e;
  }

  const job: DubJob = {
    jobId: jobIdOf(chatId, messageId),
    chatId,
    statusMessageId,
    dubbingId: created.dubbingId,
    filename,
    watermarked: created.watermarked,
    ...opts.job,
    createdAt: new Date().toISOString(),
  };
  await saveJob(job);
  console.log(`dub: задача ${job.jobId} → ${created.dubbingId}${job.subtitles ? " (с субтитрами)" : ""}`);
}
