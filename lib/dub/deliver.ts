import { downloadDub, DubStatus, getDubStatus } from "./elevenlabs";
import { deleteJob, DubJob, isDeliveryStuck, listJobs, saveJob } from "./jobs";
import { deleteMessage, editMessage, sendAudio, sendMessage, sendVideo, UPLOAD_LIMIT, VideoMeta } from "./telegram";

// Дольше ждать нечего: либо ElevenLabs завис, либо ролик неподъёмный. Иначе
// задача осталась бы в Blob навсегда и опрашивалась каждую минуту впустую.
export const JOB_DEADLINE_MS = 40 * 60 * 1000;

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
  await deps.deleteJob(job.jobId);
}

async function deliver(deps: PollDeps, job: DubJob, contentType: string | null): Promise<void> {
  // Не блокировка, а сужение окна: у Blob нет compare-and-set, но крон ходит раз
  // в минуту, а отметка сокращает окно двойной отправки до времени одного вызова.
  await deps.saveJob({ ...job, deliveringAt: new Date().toISOString() });

  const video = await deps.download(job.dubbingId);

  if (video.length > UPLOAD_LIMIT) {
    await deps.editMessage(
      job.chatId,
      job.statusMessageId,
      `Дубляж готов, но весит ${(video.length / 1024 / 1024).toFixed(0)} МБ — ` +
        "Telegram не даёт боту отправлять больше 50 МБ.\nПришли ролик покороче или сожми исходник."
    );
    await deps.deleteJob(job.jobId);
    return;
  }

  const note = job.watermarked ? "\n⚠️ с водяным знаком ElevenLabs" : "";
  const caption = `Bahasa Indonesia 🇮🇩${note}`;
  // Голосовое и аудиофайл возвращаются дорожкой, а не видео: sendVideo показал бы
  // их чёрным прямоугольником, если бы вообще принял.
  if (contentType?.startsWith("audio/")) {
    await deps.sendAudio(job.chatId, video, dubbedName(job.filename, true), caption);
  } else {
    await deps.sendVideo(job.chatId, video, dubbedName(job.filename), caption, {
      width: job.width,
      height: job.height,
      duration: job.duration,
    });
  }
  await deps.deleteMessage(job.chatId, job.statusMessageId);
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

  return result;
}

export async function notifyStartFailed(chatId: number, error: unknown): Promise<void> {
  const text = error instanceof Error ? error.message : String(error);
  await sendMessage(chatId, `Не вышло: ${text}`).catch(() => {});
}
