import { del } from "@vercel/blob";
import { isActive, Job, jobPath, listJobs } from "./jobs";

// Сутки: готовый ролик к этому времени уже забран из Telegram.
export const RETENTION_MS = 24 * 60 * 60 * 1000;

export function staleJobs(jobs: Job[], nowMs: number): Job[] {
  return jobs.filter(
    (job) => !isActive(job) && nowMs - Date.parse(job.createdAt) > RETENTION_MS
  );
}

export async function cleanup(nowMs: number): Promise<number> {
  const stale = staleJobs(await listJobs(), nowMs);
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
  return stale.length;
}
