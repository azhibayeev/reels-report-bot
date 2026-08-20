import { describe, expect, it, vi } from "vitest";
import { handleCommand, parseCommand } from "../lib/commands";
import type { Job } from "../lib/jobs";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    jobId: "job-1",
    chatId: 42,
    sourceUrl: "https://blob/source.mov",
    resultUrl: null,
    status: "pending",
    durationSec: 90,
    deliveringAt: null,
    createdAt: new Date().toISOString(),
    error: null,
    ...overrides,
  };
}

describe("parseCommand", () => {
  it("распознаёт команды, в том числе с упоминанием бота", () => {
    expect(parseCommand("/sub")).toBe("sub");
    expect(parseCommand("/sub@my_bot")).toBe("sub");
    expect(parseCommand("  /status  ")).toBe("status");
    expect(parseCommand("/help")).toBe("help");
    expect(parseCommand("/start")).toBe("help");
  });

  it("игнорирует всё остальное", () => {
    expect(parseCommand("привет")).toBeNull();
    expect(parseCommand("")).toBeNull();
  });
});

describe("handleCommand", () => {
  const deps = {
    uploadUrl: (chatId: number) => `https://sub.example/u/token-${chatId}`,
    listJobs: vi.fn(),
  };

  it("на /sub отдаёт ссылку загрузки", async () => {
    const text = await handleCommand("sub", 42, { ...deps, listJobs: vi.fn() });
    expect(text).toContain("https://sub.example/u/token-42");
  });

  it("на /status сообщает, что задач нет", async () => {
    const listJobs = vi.fn().mockResolvedValue([]);
    const text = await handleCommand("status", 42, { ...deps, listJobs });
    expect(text).toContain("нет");
  });

  it("на /status перечисляет активные задачи", async () => {
    const listJobs = vi.fn().mockResolvedValue([makeJob()]);
    const text = await handleCommand("status", 42, { ...deps, listJobs });
    expect(text).toContain("1:30");
  });

  it("на /status показывает задачу в доставке", async () => {
    const listJobs = vi.fn().mockResolvedValue([makeJob({ status: "delivering" })]);
    const text = await handleCommand("status", 42, { ...deps, listJobs });
    expect(text).toContain("delivering");
  });

  it("на /status не показывает чужие и завершённые задачи", async () => {
    const listJobs = vi.fn().mockResolvedValue([
      makeJob({ jobId: "other", chatId: 99 }),
      makeJob({ jobId: "finished", status: "done" }),
    ]);
    const text = await handleCommand("status", 42, { ...deps, listJobs });
    expect(text).toContain("нет");
  });

  it("на /help перечисляет команды", async () => {
    const text = await handleCommand("help", 42, { ...deps, listJobs: vi.fn() });
    expect(text).toContain("/sub");
    expect(text).toContain("/status");
  });
});
