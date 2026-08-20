import { del } from "@vercel/blob";
import { requireEnv } from "./config";
import { deleteBlob, isActive, Job, jobPath, listJobs, saveJob } from "./jobs";
import { sendMessage } from "./telegram";

// Дольше получаса ждать нечего: либо обработка зависла, либо ролик неподъёмный.
export const JOB_DEADLINE_MS = 30 * 60 * 1000;

// Сутки: готовый ролик к этому времени уже забран из Telegram.
export const RETENTION_MS = 24 * 60 * 60 * 1000;

// Не утверждаем, что ролик не пришёл: процесс мог умереть уже после отправки,
// не успев записать «done», — и тогда видео в чате есть, а задача выглядит
// зависшей. Поэтому просим сначала посмотреть выше по чату.
export const HUNG_JOB_MESSAGE =
  "Задача не отчиталась о завершении и закрыта. Посмотри выше в чате: если ролик так и не пришёл — попробуй ещё раз через /sub.";

export function staleJobs(jobs: Job[], nowMs: number): Job[] {
  return jobs.filter(
    (job) => !isActive(job) && nowMs - Date.parse(job.createdAt) > RETENTION_MS
  );
}

// У зависшей задачи обработка либо не запустилась, либо оборвалась молча —
// добить её и освободить хранилище больше некому, кроме этого cron.
export function hungJobs(jobs: Job[], nowMs: number): Job[] {
  return jobs.filter(
    (job) => isActive(job) && nowMs - Date.parse(job.createdAt) > JOB_DEADLINE_MS
  );
}

export interface CleanupResult {
  /** Задачи, чьи файлы удалены по сроку хранения. */
  removed: number;
  /** Зависшие задачи, закрытые этим прогоном. */
  closed: number;
}

export async function cleanup(nowMs: number): Promise<CleanupResult> {
  const jobs = await listJobs();

  const hung = hungJobs(jobs, nowMs);
  for (const job of hung) {
    try {
      await sendMessage(requireEnv("TELEGRAM_SUB_BOT_TOKEN"), job.chatId, HUNG_JOB_MESSAGE);
    } catch (error) {
      // Уведомление не должно мешать закрыть задачу и освободить хранилище.
      console.error("cleanup notify failed", job.jobId, error);
    }
    await saveJob({ ...job, status: "failed", error: HUNG_JOB_MESSAGE });
    // Дублировать исходник уже некому, а весит он сотни мегабайт.
    await deleteBlob(job.sourceUrl);
  }

  // Запись о задаче переживает закрытие: её заберёт следующий прогон по сроку
  // хранения, когда сообщение в Telegram точно прочитано.
  const stale = staleJobs(jobs, nowMs);
  for (const job of stale) {
    const targets = [job.sourceUrl, job.resultUrl].filter((url): url is string => Boolean(url));
    for (const url of targets) {
      try {
        await del(url);
      } catch (error) {
        console.error("cleanup delete failed", url, error);
      }
    }
    try {
      await del(jobPath(job.jobId));
    } catch (error) {
      console.error("cleanup delete job failed", job.jobId, error);
    }
  }

  return { removed: stale.length, closed: hung.length };
}
