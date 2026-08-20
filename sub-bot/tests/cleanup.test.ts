import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listJobsMock = vi.fn();
const saveJobMock = vi.fn();
const deleteBlobMock = vi.fn();
const sendMessageMock = vi.fn();
const delMock = vi.fn();

vi.mock("../lib/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/jobs")>()),
  listJobs: (...a: unknown[]) => listJobsMock(...a),
  saveJob: (...a: unknown[]) => saveJobMock(...a),
  deleteBlob: (...a: unknown[]) => deleteBlobMock(...a),
}));
vi.mock("../lib/telegram", () => ({ sendMessage: (...a: unknown[]) => sendMessageMock(...a) }));
vi.mock("@vercel/blob", () => ({
  del: (...a: unknown[]) => delMock(...a),
  put: vi.fn(),
  list: vi.fn(),
  head: vi.fn(),
}));

import type { Job } from "../lib/jobs";

const { cleanup, hungJobs, HUNG_JOB_MESSAGE, RETENTION_MS, staleJobs } =
  await import("../lib/cleanup");
const { AWAITING_DEADLINE_MS, WORK_DEADLINE_MS } = await import("../lib/jobs");

const NOW = Date.parse("2026-08-13T12:00:00.000Z");

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    jobId: "job-1",
    chatId: 42,
    sourceUrl: "https://blob/source.mov",
    resultUrl: "https://blob/result.mp4",
    status: "done",
    durationSec: 60,
    cues: [],
    deliveringAt: null,
    createdAt: new Date(NOW).toISOString(),
    error: null,
    ...overrides,
  };
}

beforeEach(() => {
  process.env.TELEGRAM_SUB_BOT_TOKEN = "tok";
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("staleJobs", () => {
  it("не трогает свежие задачи", () => {
    expect(staleJobs([makeJob()], NOW)).toEqual([]);
  });

  it("забирает завершённые задачи старше суток", () => {
    const old = makeJob({ createdAt: new Date(NOW - RETENTION_MS - 1).toISOString() });
    expect(staleJobs([old], NOW)).toHaveLength(1);
  });

  it("не удаляет файлы активной задачи, даже если она старая", () => {
    const stuck = makeJob({
      status: "transcribing",
      createdAt: new Date(NOW - RETENTION_MS - 1).toISOString(),
    });
    expect(staleJobs([stuck], NOW)).toEqual([]);
  });

  it("считает задачу в доставке активной и не сносит её файлы", () => {
    const delivering = makeJob({
      status: "delivering",
      createdAt: new Date(NOW - RETENTION_MS - 1).toISOString(),
    });
    expect(staleJobs([delivering], NOW)).toEqual([]);
  });
});

describe("hungJobs", () => {
  it("закрывает активную задачу старше дедлайна — добивать её больше некому", () => {
    const stuck = makeJob({
      status: "transcribing",
      createdAt: new Date(NOW - WORK_DEADLINE_MS - 1).toISOString(),
    });
    expect(hungJobs([stuck], NOW)).toHaveLength(1);
  });

  it("не трогает свежую активную задачу — она ещё в работе", () => {
    const fresh = makeJob({
      status: "transcribing",
      createdAt: new Date(NOW - 60_000).toISOString(),
    });
    expect(hungJobs([fresh], NOW)).toEqual([]);
  });

  it("не трогает завершённые задачи, как бы стары они ни были", () => {
    const old = makeJob({ createdAt: new Date(NOW - RETENTION_MS - 1).toISOString() });
    expect(hungJobs([old], NOW)).toEqual([]);
  });

  it("не трогает awaiting дольше получаса — у неё свой, суточный дедлайн", () => {
    const waiting = makeJob({
      status: "awaiting",
      createdAt: new Date(NOW - WORK_DEADLINE_MS - 1).toISOString(),
    });
    expect(hungJobs([waiting], NOW)).toEqual([]);
  });

  it("закрывает awaiting, простоявшую дольше суток", () => {
    const waiting = makeJob({
      status: "awaiting",
      createdAt: new Date(NOW - AWAITING_DEADLINE_MS - 1).toISOString(),
    });
    expect(hungJobs([waiting], NOW)).toHaveLength(1);
  });
});

describe("cleanup", () => {
  it("зависшую задачу помечает failed, пишет владельцу и удаляет исходник", async () => {
    listJobsMock.mockResolvedValue([
      makeJob({ status: "transcribing", createdAt: new Date(NOW - WORK_DEADLINE_MS - 1).toISOString() }),
    ]);

    const result = await cleanup(NOW);

    expect(result).toEqual({ removed: 0, closed: 1 });
    expect(sendMessageMock).toHaveBeenCalledWith("tok", 42, HUNG_JOB_MESSAGE);
    expect(saveJobMock).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
    expect(deleteBlobMock).toHaveBeenCalledWith("https://blob/source.mov");
  });

  it("свежую активную задачу оставляет в покое", async () => {
    listJobsMock.mockResolvedValue([makeJob({ status: "transcribing" })]);

    const result = await cleanup(NOW);

    expect(result).toEqual({ removed: 0, closed: 0 });
    expect(saveJobMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(delMock).not.toHaveBeenCalled();
  });

  it("удаляет файлы завершённой задачи старше суток", async () => {
    listJobsMock.mockResolvedValue([
      makeJob({ createdAt: new Date(NOW - RETENTION_MS - 1).toISOString() }),
    ]);

    const result = await cleanup(NOW);

    expect(result).toEqual({ removed: 1, closed: 0 });
    expect(delMock).toHaveBeenCalledWith("https://blob/source.mov");
    expect(delMock).toHaveBeenCalledWith("https://blob/result.mp4");
    expect(delMock).toHaveBeenCalledWith("sub/jobs/job-1.json");
  });
});
