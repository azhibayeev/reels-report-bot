import { del, list, put } from "@vercel/blob";
import { Cue } from "./cues";

// Конвейер задачи: распознавание речи → перевод → ожидание правки человеком →
// рендер субтитров → доставка в Telegram. «delivering» — задача уже отдаётся
// в Telegram, отдельный статус нужен, чтобы параллельный запуск не отправил
// тот же ролик ещё раз.
export type JobStatus =
  | "transcribing"
  | "translating"
  | "awaiting"
  | "rendering"
  | "delivering"
  | "done"
  | "failed";

export interface Job {
  jobId: string;
  chatId: number;
  sourceUrl: string;
  resultUrl: string | null;
  status: JobStatus;
  /** Ноль означает, что браузер не смог прочитать длительность файла. */
  durationSec: number;
  /** Реплики субтитров: пусто до перевода, дальше — рабочая копия, которую правит человек в статусе awaiting. */
  cues: Cue[];
  /**
   * Когда началась текущая доставка (ISO), `null` — если доставка не идёт.
   * Нужна, чтобы отличить живую доставку от брошенной: вызов функции умирает
   * молча, и без отметки времени задача осталась бы в «delivering» навсегда.
   */
  deliveringAt: string | null;
  createdAt: string;
  error: string | null;
}

export const JOBS_PREFIX = "sub/jobs/";
export const RESULTS_PREFIX = "sub/results/";
export const SOURCES_PREFIX = "sub/sources/";

export function jobPath(jobId: string): string {
  return `${JOBS_PREFIX}${jobId}.json`;
}

// Рабочие статусы (машина работает) умирают за полчаса. «awaiting» ждёт
// человека — правка религиозного текста руками может занять часы, поэтому у
// неё отдельный, суточный дедлайн. Общий тридцатиминутный порог делал бы
// живучесть задачи лотереей: суточная уборка ходит в фиксированное время
// (04:00 UTC), и задача, созданная в 03:00, умирала бы через час, а созданная
// в 05:00 — жила почти сутки.
export const WORK_DEADLINE_MS = 30 * 60 * 1000;
export const AWAITING_DEADLINE_MS = 24 * 60 * 60 * 1000;

export function deadlineMs(status: JobStatus): number {
  return status === "awaiting" ? AWAITING_DEADLINE_MS : WORK_DEADLINE_MS;
}

export function isActive(job: Job): boolean {
  // Доставка и ожидание правки тоже считаются работой: /status должен такую
  // задачу показывать, а чистка — не трогать её файлы.
  return job.status !== "done" && job.status !== "failed";
}

export function isExpired(job: Job, nowMs: number): boolean {
  if (!isActive(job)) return false;
  return nowMs - Date.parse(job.createdAt) > deadlineMs(job.status);
}

export async function saveJob(job: Job): Promise<void> {
  await put(jobPath(job.jobId), JSON.stringify(job), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

// Blob кэшируется на CDN, поэтому читаем всегда с cache-busting параметром —
// иначе tick увидит устаревший статус задачи.
async function readJob(url: string): Promise<Job | null> {
  const res = await fetch(`${url}?ts=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  try {
    return (await res.json()) as Job;
  } catch {
    return null;
  }
}

export async function loadJob(jobId: string): Promise<Job | null> {
  const path = jobPath(jobId);
  const { blobs } = await list({ prefix: path });
  const blob = blobs.find((b) => b.pathname === path);
  if (!blob) return null;
  return readJob(blob.url);
}

export async function listJobs(): Promise<Job[]> {
  const { blobs } = await list({ prefix: JOBS_PREFIX });
  const jobs: Job[] = [];
  for (const blob of blobs) {
    const job = await readJob(blob.url);
    if (job) jobs.push(job);
  }
  return jobs;
}

export async function deleteBlob(url: string): Promise<void> {
  // Исходник больше не нужен, но упасть на уборке нельзя — результат уже отправлен.
  try {
    await del(url);
  } catch (error) {
    console.error("blob delete failed", url, error);
  }
}
