import { describe, expect, it } from "vitest";
import { RETENTION_MS, staleJobs } from "../lib/cleanup";
import type { Job } from "../lib/jobs";

const NOW = Date.parse("2026-08-13T12:00:00.000Z");

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    jobId: "job-1",
    chatId: 42,
    dubbingId: "dub-1",
    sourceUrl: "https://blob/source.mov",
    resultUrl: "https://blob/result.mp4",
    status: "done",
    durationSec: 60,
    createdAt: new Date(NOW).toISOString(),
    error: null,
    ...overrides,
  };
}

describe("staleJobs", () => {
  it("не трогает свежие задачи", () => {
    expect(staleJobs([makeJob()], NOW)).toEqual([]);
  });

  it("забирает завершённые задачи старше суток", () => {
    const old = makeJob({ createdAt: new Date(NOW - RETENTION_MS - 1).toISOString() });
    expect(staleJobs([old], NOW)).toHaveLength(1);
  });

  it("не удаляет активную задачу, даже если она старая — её добьёт дедлайн", () => {
    const stuck = makeJob({
      status: "dubbing",
      createdAt: new Date(NOW - RETENTION_MS - 1).toISOString(),
    });
    expect(staleJobs([stuck], NOW)).toEqual([]);
  });
});
