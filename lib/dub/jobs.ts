import { del, put } from "@vercel/blob";
import { listAllBlobs } from "../farm/store";

export const JOBS_PREFIX = "dub/jobs/";

export interface DubJob {
  jobId: string;
  chatId: number;
  /** Сообщение со статусом: его правит опрос и удаляет доставка. */
  statusMessageId: number;
  dubbingId: string;
  filename: string;
  watermarked: boolean;
  /** Размеры исходника: дубляж картинку не трогает, а Telegram без них рисует квадрат. */
  width?: number;
  height?: number;
  duration?: number;
  createdAt: string;
  /** Отметка начатой доставки — защита от двух тиков крона на одной задаче. */
  deliveringAt?: string;
  /** Исходник в Blob, если ролик пришёл через страницу загрузки: его удаляет
   *  доставка, потому что ElevenLabs он нужен только в момент создания дубляжа. */
  blobUrl?: string;
  /** Ответ на вопрос о субтитрах: вжигать ли их в готовый дубляж. */
  subtitles?: boolean;
}

export function jobPath(jobId: string): string {
  return `${JOBS_PREFIX}${jobId}.json`;
}

export async function saveJob(job: DubJob): Promise<void> {
  await put(jobPath(job.jobId), JSON.stringify(job), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

export async function deleteJob(jobId: string): Promise<void> {
  await del(jobPath(jobId)).catch(() => {});
}

// Blob кэшируется на CDN, поэтому читаем с cache-busting: иначе тик увидит
// устаревшую задачу и отправит ролик дважды.
export async function listJobs(): Promise<DubJob[]> {
  const blobs = await listAllBlobs(JOBS_PREFIX);
  const jobs: DubJob[] = [];
  for (const b of blobs) {
    const res = await fetch(`${b.url}?ts=${Date.now()}`, { cache: "no-store" });
    if (res.ok) jobs.push((await res.json()) as DubJob);
  }
  return jobs;
}

// Доставка не переживает свой вызов функции (300 с потолок), поэтому более
// старая отметка — это мёртвая доставка, а не занятая: её можно перехватить.
export const DELIVERY_TAKEOVER_MS = 300_000;

export function isDeliveryStuck(job: DubJob, nowMs: number): boolean {
  if (!job.deliveringAt) return true;
  const started = Date.parse(job.deliveringAt);
  if (Number.isNaN(started)) return true;
  return nowMs - started > DELIVERY_TAKEOVER_MS;
}
