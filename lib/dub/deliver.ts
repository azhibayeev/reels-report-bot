import { downloadDub, DubStatus, getDubStatus } from "./elevenlabs";
import { deleteJob, DubJob, isDeliveryStuck, listJobs, saveJob } from "./jobs";
import { deleteBlobQuiet, putResult, sweepStaleBlobs } from "./storage";
import { deleteMessage, editMessage, sendAudio, sendMessage, sendVideo, UPLOAD_LIMIT, VideoMeta } from "./telegram";
import { resultPath } from "./uploads";

// Дольше ждать нечего: либо ElevenLabs завис, либо ролик неподъёмный. Иначе
// задача осталась бы в Blob навсегда и опрашивалась каждую минуту впустую.
export const JOB_DEADLINE_MS = 40 * 60 * 1000;

/** Минута часа, на которой тик заодно убирает Blob. Любая — лишь бы одна. */
export const SWEEP_MINUTE = 7;

export interface PollDeps {
  listJobs: () => Promise<DubJob[]>;
  saveJob: (job: DubJob) => Promise<void>;
  deleteJob: (jobId: string) => Promise<void>;
  getStatus: (dubbingId: string) => Promise<DubStatus>;
  download: (dubbingId: string) => Promise<Buffer>;
  sendVideo: (chatId: number, video: Buffer, filename: string, caption: string, meta: VideoMeta) => Promise<void>;
  sendAudio: (chatId: number, audio: Buffer, filename: string, caption: string) => Promise<void>;
  editMessage: (chatId: number, messageId: number, text: string) => Promise<void>;
  deleteMessage: (chatId: number, messageId: number) => Promise<void>;
  /** Исходник из страницы загрузки: после закрытия задачи он больше никому не нужен. */
  deleteBlob: (url: string | undefined) => Promise<void>;
  /** Запасной выход для дубляжа тяжелее 50 МБ — вернуть ссылкой, а не потерять. */
  putResult: (pathname: string, video: Buffer, contentType: string) => Promise<string>;
  /** Уборка за задачами, которые не дожили до закрытия. Необязательна: тикам без неё ничего не грозит. */
  sweep?: (keep: Set<string>, nowMs: number) => Promise<number>;
  /** Вжигает субтитры в готовый дубляж. Сбой не фатален — ролик уйдёт без них. */
  burnSubtitles?: (video: Buffer, dubbingId: string) => Promise<Buffer>;
}

export function livePollDeps(): PollDeps {
  return {
    listJobs,
    saveJob,
    deleteJob,
    getStatus: getDubStatus,
    download: downloadDub,
    sendVideo,
    sendAudio,
    editMessage,
    deleteMessage,
    deleteBlob: deleteBlobQuiet,
    putResult,
    sweep: sweepStaleBlobs,
  };
}

export interface PollResult {
  checked: number;
  delivered: number;
  failed: number;
}

export function ageSec(job: DubJob, nowMs: number): number {
  return Math.max(0, Math.round((nowMs - Date.parse(job.createdAt)) / 1000));
}

export function dubbedName(filename: string, audio = false): string {
  return `${filename.replace(/\.[^.]+$/, "") || "video"}-id.${audio ? "mp3" : "mp4"}`;
}

async function fail(deps: PollDeps, job: DubJob, reason: string): Promise<void> {
  await deps.editMessage(job.chatId, job.statusMessageId, `Не вышло: ${reason}`);
  await deps.deleteBlob(job.blobUrl);
  await deps.deleteJob(job.jobId);
}

async function deliver(deps: PollDeps, job: DubJob, contentType: string | null): Promise<void> {
  // Не блокировка, а сужение окна: у Blob нет compare-and-set, но крон ходит раз
  // в минуту, а отметка сокращает окно двойной отправки до времени одного вызова.
  await deps.saveJob({ ...job, deliveringAt: new Date().toISOString() });

  let video = await deps.download(job.dubbingId);
  const audio = Boolean(contentType?.startsWith("audio/"));

  // Субтитры — поверх звука, а не вместо: у голосового вжигать их некуда.
  let subtitlesFailed = false;
  if (job.subtitles && !audio && deps.burnSubtitles) {
    await deps.editMessage(job.chatId, job.statusMessageId, "Вжигаю субтитры…");
    try {
      video = await deps.burnSubtitles(video, job.dubbingId);
    } catch (e) {
      // Готовый дубляж дороже субтитров: отдаём как есть и честно говорим, что
      // вышло, — молчаливая отправка без них выглядела бы как проигнорированная кнопка.
      subtitlesFailed = true;
      console.error(`dub: субтитры для ${job.jobId} — ${e instanceof Error ? e.message : e}`);
    }
  }

  const note =
    (job.watermarked ? "\n⚠️ с водяным знаком ElevenLabs" : "") +
    (subtitlesFailed ? "\n⚠️ субтитры не легли — держи дубляж как есть" : "");
  const caption = `Bahasa Indonesia 🇮🇩${note}`;

  // Telegram не примет от бота больше 50 МБ, но выбрасывать из-за этого готовый
  // дубляж глупо: кладём в Blob и отдаём ссылкой — Blob у бота уже есть под приём.
  if (video.length > UPLOAD_LIMIT) {
    const name = dubbedName(job.filename, audio);
    const url = await deps.putResult(resultPath(job.jobId, name), video, audio ? "audio/mpeg" : "video/mp4");
    await deps.editMessage(
      job.chatId,
      job.statusMessageId,
      `Дубляж готов, но весит ${(video.length / 1024 / 1024).toFixed(0)} МБ — ` +
        `Telegram не даёт боту отправлять больше 50 МБ.\nЗабирай по ссылке, она живёт двое суток:\n${url}${note}`
    );
    await deps.deleteBlob(job.blobUrl);
    await deps.deleteJob(job.jobId);
    return;
  }

  // Голосовое и аудиофайл возвращаются дорожкой, а не видео: sendVideo показал бы
  // их чёрным прямоугольником, если бы вообще принял.
  if (audio) {
    await deps.sendAudio(job.chatId, video, dubbedName(job.filename, true), caption);
  } else {
    await deps.sendVideo(job.chatId, video, dubbedName(job.filename), caption, {
      width: job.width,
      height: job.height,
      duration: job.duration,
    });
  }
  await deps.deleteMessage(job.chatId, job.statusMessageId);
  await deps.deleteBlob(job.blobUrl);
  await deps.deleteJob(job.jobId);
}

/**
 * Один проход крона: опрашивает все задачи, доставляет готовые.
 * Доставка за проход одна — скачать и выгрузить 50 МБ дольше, чем опросить статус,
 * и две такие в одном вызове рискуют не уложиться в maxDuration.
 */
export async function pollJobs(deps: PollDeps, now = Date.now()): Promise<PollResult> {
  const jobs = await deps.listJobs();
  const result: PollResult = { checked: jobs.length, delivered: 0, failed: 0 };
  let deliveredOne = false;

  for (const job of jobs) {
    try {
      // Чужая доставка ещё жива — не мешаем: ролик уже качается в другом вызове.
      if (job.deliveringAt && !isDeliveryStuck(job, now)) continue;

      if (now - Date.parse(job.createdAt) > JOB_DEADLINE_MS) {
        await fail(deps, job, "ElevenLabs не закончил за 40 минут");
        result.failed++;
        continue;
      }

      const status = await deps.getStatus(job.dubbingId);

      if (status.status === "failed") {
        await fail(deps, job, `ElevenLabs не справился — ${status.error || "без объяснения"}`);
        result.failed++;
        continue;
      }

      if (status.status !== "dubbed") {
        await deps.editMessage(job.chatId, job.statusMessageId, `Дублирую… ${ageSec(job, now)} с`);
        continue;
      }

      // Готовую, но не влезшую в этот проход, заберёт следующий тик через минуту.
      if (deliveredOne) continue;
      await deliver(deps, job, status.contentType);
      deliveredOne = true;
      result.delivered++;
    } catch (e) {
      // Падение на одной задаче не должно уносить весь проход: остальные ждут своей очереди.
      console.error(`dub: задача ${job.jobId} — ${e instanceof Error ? e.message : e}`);
    }
  }

  // Раз в час подчищаем Blob: заливка, на которой ElevenLabs отказал, задачи не
  // заводит — и сотня мегабайт осталась бы там навсегда. Чаще незачем: тик ходит
  // раз в минуту, а список файлов — лишний запрос к хранилищу на каждом.
  if (deps.sweep && new Date(now).getUTCMinutes() === SWEEP_MINUTE) {
    try {
      const keep = new Set(jobs.map((j) => j.blobUrl).filter((u): u is string => Boolean(u)));
      const removed = await deps.sweep(keep, now);
      if (removed) console.log(`dub: убрано осиротевших файлов — ${removed}`);
    } catch (e) {
      console.error(`dub: уборка Blob — ${e instanceof Error ? e.message : e}`);
    }
  }

  return result;
}

export async function notifyStartFailed(chatId: number, error: unknown): Promise<void> {
  const text = error instanceof Error ? error.message : String(error);
  await sendMessage(chatId, `Не вышло: ${text}`).catch(() => {});
}
