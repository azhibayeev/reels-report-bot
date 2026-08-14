import { describe, expect, it, vi } from "vitest";
import { handleCommand, parseCommand } from "../lib/commands";
import type { Job } from "../lib/jobs";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    jobId: "job-1",
    chatId: 42,
    dubbingId: "dub-1",
    sourceUrl: "https://blob/source.mov",
    resultUrl: null,
    status: "dubbing",
    durationSec: 90,
    deliveringAt: null,
    createdAt: new Date().toISOString(),
    error: null,
    ...overrides,
  };
}

describe("parseCommand", () => {
  it("распознаёт команды, в том числе с упоминанием бота", () => {
    expect(parseCommand("/dub")).toBe("dub");
    expect(parseCommand("/dub@my_bot")).toBe("dub");
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
    uploadUrl: (chatId: number) => `https://dub.example/u/token-${chatId}`,
    listJobs: vi.fn(),
    triggerTick: vi.fn(),
  };

  it("на /dub отдаёт ссылку загрузки", async () => {
    const text = await handleCommand("dub", 42, { ...deps, listJobs: vi.fn() });
    expect(text).toContain("https://dub.example/u/token-42");
  });

  it("на /status сообщает, что задач нет", async () => {
    const listJobs = vi.fn().mockResolvedValue([]);
    const text = await handleCommand("status", 42, { ...deps, listJobs });
    expect(text).toContain("нет");
  });

  it("на /status перечисляет активные задачи и пинает их", async () => {
    const listJobs = vi.fn().mockResolvedValue([makeJob()]);
    const triggerTick = vi.fn();
    const text = await handleCommand("status", 42, { ...deps, listJobs, triggerTick });
    expect(text).toContain("1:30");
    expect(triggerTick).toHaveBeenCalledWith("job-1");
  });

  it("на /status показывает задачу в доставке", async () => {
    const listJobs = vi.fn().mockResolvedValue([makeJob({ status: "delivering" })]);
    const text = await handleCommand("status", 42, { ...deps, listJobs, triggerTick: vi.fn() });
    expect(text).toContain("delivering");
  });

  it("на /status показывает список, даже если пинок опроса не прошёл", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const listJobs = vi.fn().mockResolvedValue([makeJob()]);
    const triggerTick = vi.fn().mockRejectedValue(new Error("tick вернул 403"));

    const text = await handleCommand("status", 42, { ...deps, listJobs, triggerTick });

    expect(text).toContain("1:30");
    expect(text).toContain("не удалось");
    vi.restoreAllMocks();
  });

  it("на /status не показывает чужие и завершённые задачи", async () => {
    const listJobs = vi.fn().mockResolvedValue([
      makeJob({ jobId: "other", chatId: 99 }),
      makeJob({ jobId: "finished", status: "done" }),
    ]);
    const triggerTick = vi.fn();
    const text = await handleCommand("status", 42, { ...deps, listJobs, triggerTick });
    expect(text).toContain("нет");
    expect(triggerTick).not.toHaveBeenCalled();
  });

  it("на /help перечисляет команды", async () => {
    const text = await handleCommand("help", 42, { ...deps, listJobs: vi.fn() });
    expect(text).toContain("/dub");
    expect(text).toContain("/status");
  });
});
