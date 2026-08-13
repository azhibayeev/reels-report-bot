import { del, list, put } from "@vercel/blob";

export type JobStatus = "pending" | "dubbing" | "done" | "failed";

export interface Job {
  jobId: string;
  chatId: number;
  dubbingId: string | null;
  sourceUrl: string;
  resultUrl: string | null;
  status: JobStatus;
  /** Ноль означает, что браузер не смог прочитать длительность файла. */
  durationSec: number;
  createdAt: string;
  error: string | null;
}

export const JOBS_PREFIX = "dub/jobs/";
export const RESULTS_PREFIX = "dub/results/";
export const SOURCES_PREFIX = "dub/sources/";

export function jobPath(jobId: string): string {
  return `${JOBS_PREFIX}${jobId}.json`;
}

export function isActive(job: Job): boolean {
  return job.status === "pending" || job.status === "dubbing";
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
