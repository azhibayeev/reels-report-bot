import { describe, it, expect, vi } from "vitest";
import { runPipeline } from "../lib/pipeline";
import type { Job } from "../lib/jobs";

const job = (): Job => ({
  jobId: "j1",
  chatId: 1,
  sourceUrl: "https://x/a.mp4",
  resultUrl: null,
  status: "transcribing",
  durationSec: 0,
  cues: [],
  deliveringAt: null,
  createdAt: new Date().toISOString(),
  error: null,
});

const deps = (over: Record<string, unknown> = {}) => ({
  probe: vi.fn().mockResolvedValue({ durationSec: 20, hasAudio: true }),
  download: vi.fn().mockResolvedValue("/tmp/src.mp4"),
  transcribe: vi.fn().mockResolvedValue([{ text: "Читай", start: 0, end: 0.5 }]),
  translate: vi.fn().mockImplementation(async (cues: { id: string }[]) =>
    cues.map((c) => ({ ...c, id: "Bacalah" }))
  ),
  save: vi.fn().mockResolvedValue(undefined),
  ...over,
});

describe("runPipeline", () => {
  it("доводит задачу до awaiting с репликами", async () => {
    const out = await runPipeline(deps() as never, job());
    expect(out.status).toBe("awaiting");
    expect(out.cues.length).toBeGreaterThan(0);
    expect(out.cues[0].id).toBe("Bacalah");
  });

  it("отбивает ролик длиннее потолка", async () => {
    const d = deps({ probe: vi.fn().mockResolvedValue({ durationSec: 61.4, hasAudio: true }) });
    const out = await runPipeline(d as never, job());
    expect(out.status).toBe("failed");
    expect(out.error).toMatch(/61/);
    expect(d.transcribe).not.toHaveBeenCalled();
  });

  it("пропускает ролик 60.4 секунды — это норма для телефона", async () => {
    const d = deps({ probe: vi.fn().mockResolvedValue({ durationSec: 60.4, hasAudio: true }) });
    expect((await runPipeline(d as never, job())).status).toBe("awaiting");
  });

  it("отбивает ролик без звуковой дорожки, не доходя до распознавания", async () => {
    const d = deps({ probe: vi.fn().mockResolvedValue({ durationSec: 20, hasAudio: false }) });
    const out = await runPipeline(d as never, job());
    expect(out.status).toBe("failed");
    expect(out.error).toMatch(/звук/i);
    expect(d.transcribe).not.toHaveBeenCalled();
  });

  it("отбивает ролик, где речь не распозналась", async () => {
    const d = deps({ transcribe: vi.fn().mockResolvedValue([]) });
    const out = await runPipeline(d as never, job());
    expect(out.status).toBe("failed");
    expect(out.error).toMatch(/речь/i);
  });

  it("на падении перевода помечает задачу failed, а не роняет вызов", async () => {
    const d = deps({ translate: vi.fn().mockRejectedValue(new Error("429 rate limited")) });
    const out = await runPipeline(d as never, job());
    expect(out.status).toBe("failed");
    expect(out.error).toMatch(/429/);
  });

  it("перед переводом сохраняет промежуточный статус translating с нарезанными репликами", async () => {
    const d = deps();
    await runPipeline(d as never, job());
    const calls = d.save.mock.calls as [Job][];
    const savedIndex = calls.findIndex((call) => call[0].status === "translating");
    expect(savedIndex).toBeGreaterThanOrEqual(0);
    expect(calls[savedIndex][0].cues.length).toBeGreaterThan(0);
    // Сохранение "translating" обязано случиться ДО вызова переводчика —
    // иначе обрыв на переводе не оставил бы видимого следа, докуда дошли.
    const saveOrder = d.save.mock.invocationCallOrder[savedIndex];
    const translateOrder = d.translate.mock.invocationCallOrder[0];
    expect(saveOrder).toBeLessThan(translateOrder);
  });

  it("падение перевода не стирает уже нарезанные реплики из сохранённой failed-записи", async () => {
    const d = deps({ translate: vi.fn().mockRejectedValue(new Error("429 rate limited")) });
    await runPipeline(d as never, job());
    const lastSave = d.save.mock.calls[d.save.mock.calls.length - 1][0] as Job;
    expect(lastSave.status).toBe("failed");
    expect(lastSave.cues.length).toBeGreaterThan(0);
  });
});
