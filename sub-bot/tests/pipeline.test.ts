import { describe, it, expect, vi } from "vitest";
import { runPipeline } from "../lib/pipeline";
import type { Job } from "../lib/jobs";
import type { Download } from "../lib/storage";

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

// dispose — отдельный мок на каждый вызов download(), чтобы тесты могли
// проверить, что именно он вызван (а не какой-то чужой dispose из другого
// вызова).
function makeDownload(path = "/tmp/src.mp4"): Download {
  return { path, dispose: vi.fn() };
}

const deps = (over: Record<string, unknown> = {}) => ({
  probe: vi.fn().mockResolvedValue({ durationSec: 20, hasAudio: true }),
  download: vi.fn().mockResolvedValue(makeDownload()),
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

  // Фикс-раунд 1, находка 1: fail() падал сам, если deps.save отказа тоже
  // отказывал (например, Blob лёг ровно в момент обработки отказа) —
  // runPipeline рожал необработанный reject вместо возврата failed-задачи.
  it("если сохранение отказа тоже падает — всё равно возвращает failed, а не роняет вызов", async () => {
    const d = deps({
      download: vi.fn().mockRejectedValue(new Error("download failed")),
      save: vi.fn().mockRejectedValue(new Error("blob unavailable")),
    });
    const out = await runPipeline(d as never, job());
    expect(out.status).toBe("failed");
    expect(out.error).toMatch(/download failed/);
  });

  // Фикс-раунд 1, находка 2: временный каталог из download() обязан
  // удаляться на любом пути — и на успехе, и на отказе.
  it("убирает временный каталог после успешного прохождения конвейера", async () => {
    const dl = makeDownload();
    const d = deps({ download: vi.fn().mockResolvedValue(dl) });
    await runPipeline(d as never, job());
    expect(dl.dispose).toHaveBeenCalledTimes(1);
  });

  it("убирает временный каталог даже на отказе (например, ролик длиннее потолка)", async () => {
    const dl = makeDownload();
    const d = deps({
      download: vi.fn().mockResolvedValue(dl),
      probe: vi.fn().mockResolvedValue({ durationSec: 61.4, hasAudio: true }),
    });
    const out = await runPipeline(d as never, job());
    expect(out.status).toBe("failed");
    expect(dl.dispose).toHaveBeenCalledTimes(1);
  });

  it("убирает временный каталог, даже если упавший перевод уронил конвейер в catch", async () => {
    const dl = makeDownload();
    const d = deps({
      download: vi.fn().mockResolvedValue(dl),
      translate: vi.fn().mockRejectedValue(new Error("429 rate limited")),
    });
    await runPipeline(d as never, job());
    expect(dl.dispose).toHaveBeenCalledTimes(1);
  });

  it("не пытается убрать каталог, если скачивание не удалось — dispose ещё не от чего звать", async () => {
    const d = deps({ download: vi.fn().mockRejectedValue(new Error("network down")) });
    const out = await runPipeline(d as never, job());
    expect(out.status).toBe("failed");
    // Явной проверки на "не бросает" достаточно — если бы код обращался к
    // dispose несуществующего Download, вызов упал бы раньше этой строки.
  });
});
