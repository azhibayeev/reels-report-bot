import { afterEach, describe, expect, it, vi } from "vitest";

const putMock = vi.fn();
const listMock = vi.fn();

vi.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => putMock(...args),
  list: (...args: unknown[]) => listMock(...args),
  del: vi.fn(),
  head: vi.fn(),
}));

import type { Job } from "../lib/jobs";

const { isActive, jobPath, loadJob, saveJob } = await import("../lib/jobs");

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    jobId: "job-1",
    chatId: 42,
    sourceUrl: "https://blob/source.mov",
    resultUrl: null,
    status: "pending",
    durationSec: 60,
    deliveringAt: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    error: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("jobPath", () => {
  it("складывает задачи под общий префикс", () => {
    expect(jobPath("job-1")).toBe("sub/jobs/job-1.json");
  });
});

describe("saveJob", () => {
  it("перезаписывает файл под фиксированным именем", async () => {
    await saveJob(makeJob());
    const [pathname, body, options] = putMock.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(pathname).toBe("sub/jobs/job-1.json");
    expect(JSON.parse(body)).toMatchObject({ jobId: "job-1", chatId: 42 });
    expect(options).toMatchObject({ addRandomSuffix: false, allowOverwrite: true });
  });
});

describe("loadJob", () => {
  it("возвращает null, если задачи нет", async () => {
    listMock.mockResolvedValue({ blobs: [] });
    await expect(loadJob("missing")).resolves.toBeNull();
  });

  it("читает задачу по ссылке из Blob", async () => {
    listMock.mockResolvedValue({
      blobs: [{ pathname: "sub/jobs/job-1.json", url: "https://blob/job-1.json" }],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(makeJob())));
    await expect(loadJob("job-1")).resolves.toMatchObject({ jobId: "job-1" });
  });

  it("возвращает null на битом JSON, а не падает", async () => {
    listMock.mockResolvedValue({
      blobs: [{ pathname: "sub/jobs/job-1.json", url: "https://blob/job-1.json" }],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("не json")));
    await expect(loadJob("job-1")).resolves.toBeNull();
  });
});

describe("isActive", () => {
  it("активны только незавершённые задачи", () => {
    expect(isActive(makeJob({ status: "pending" }))).toBe(true);
    // Задача в доставке ещё работает: /status её показывает, чистка не трогает.
    expect(isActive(makeJob({ status: "delivering" }))).toBe(true);
    expect(isActive(makeJob({ status: "done" }))).toBe(false);
    expect(isActive(makeJob({ status: "failed" }))).toBe(false);
  });
});
