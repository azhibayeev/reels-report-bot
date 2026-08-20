import { describe, expect, it, vi } from "vitest";
import { blockingWarnings, handleCommand, parseCommand, parseEdit, renderCueList } from "../lib/commands";
import type { Cue } from "../lib/cues";
import type { Job } from "../lib/jobs";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    jobId: "job-1",
    chatId: 42,
    sourceUrl: "https://blob/source.mov",
    resultUrl: null,
    status: "transcribing",
    durationSec: 90,
    cues: [],
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

const cues: Cue[] = [
  { i: 1, start: 0, end: 2, ru: "Читай дуа", id: "Bacalah doa", needsManual: false, warning: null },
  { i: 2, start: 2.1, end: 4, ru: "Бисмилляхи", id: null, needsManual: true, warning: "впиши руками" },
];

describe("parseEdit", () => {
  it("разбирает правку по номеру", () => {
    expect(parseEdit("1 Bacalah doa ini", cues)).toEqual({ i: 1, text: "Bacalah doa ini" });
  });

  it("берёт весь остаток строки, включая пробелы", () => {
    expect(parseEdit("2 Dengan nama Allah  yang", cues)?.text).toBe("Dengan nama Allah  yang");
  });

  it("не принимает номер вне диапазона", () => {
    expect(parseEdit("9 текст", cues)).toBeNull();
  });

  it("не принимает номер без текста", () => {
    expect(parseEdit("1", cues)).toBeNull();
    expect(parseEdit("1   ", cues)).toBeNull();
  });

  it("не принимает сообщение без ведущего числа", () => {
    expect(parseEdit("Bacalah doa", cues)).toBeNull();
  });

  it("не принимает команды", () => {
    expect(parseEdit("/ok", cues)).toBeNull();
  });
});

describe("blockingWarnings", () => {
  it("собирает номера реплик, которые блокируют рендер", () => {
    expect(blockingWarnings(cues)).toEqual([2]);
  });

  it("на чистых репликах пусто", () => {
    expect(blockingWarnings([cues[0]])).toEqual([]);
  });
});

describe("renderCueList", () => {
  const job = { jobId: "j", chatId: 1, cues, status: "awaiting", durationSec: 4 } as Job;

  it("нумерует и показывает таймкоды", () => {
    const out = renderCueList(job);
    expect(out).toContain("1.");
    expect(out).toContain("0:00");
  });

  it("показывает предупреждения", () => {
    expect(renderCueList(job)).toContain("впиши руками");
  });

  it("показывает русский оригинал", () => {
    expect(renderCueList(job)).toContain("Читай дуа");
  });
});
