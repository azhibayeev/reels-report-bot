import { describe, it, expect, vi } from "vitest";
import { pickDelivery, runRender } from "../lib/deliver";
import type { Job } from "../lib/jobs";

const MB = 1024 * 1024;

const job = (over: Partial<Job> = {}): Job => ({
  jobId: "j1",
  chatId: 1,
  sourceUrl: "https://x/a.mp4",
  resultUrl: null,
  status: "awaiting",
  durationSec: 20,
  cues: [{ i: 1, start: 0, end: 2, ru: "Читай", id: "Bacalah", needsManual: false, warning: null }],
  deliveringAt: null,
  createdAt: new Date().toISOString(),
  error: null,
  ...over,
});

const deps = (over: Record<string, unknown> = {}) => ({
  download: vi.fn().mockResolvedValue("/tmp/src.mp4"),
  render: vi.fn().mockResolvedValue(undefined),
  upload: vi.fn().mockResolvedValue("https://blob/out.mp4"),
  size: vi.fn().mockResolvedValue(10 * MB),
  deliver: vi.fn().mockResolvedValue(undefined),
  save: vi.fn().mockResolvedValue(undefined),
  cleanup: vi.fn().mockResolvedValue(undefined),
  fontFamily: "Plus Jakarta Sans ExtraBold",
  ...over,
});

describe("pickDelivery", () => {
  it("до 20 МБ отдаёт ссылкой", () => {
    expect(pickDelivery(19 * MB)).toBe("link");
    expect(pickDelivery(20 * MB)).toBe("link");
  });
  it("от 20 до 50 МБ грузит multipart", () => {
    expect(pickDelivery(20 * MB + 1)).toBe("multipart");
    expect(pickDelivery(50 * MB)).toBe("multipart");
  });
  it("свыше 50 МБ отдаёт ссылку на Blob", () => {
    expect(pickDelivery(50 * MB + 1)).toBe("blob");
  });
});

describe("runRender", () => {
  it("доводит задачу до done", async () => {
    const out = await runRender(deps() as never, job());
    expect(out.status).toBe("done");
    expect(out.resultUrl).toBe("https://blob/out.mp4");
  });

  it("отказывает, если есть блокирующие предупреждения", async () => {
    const d = deps();
    const j = job({
      cues: [{ i: 1, start: 0, end: 2, ru: "Б", id: null, needsManual: true, warning: "впиши руками" }],
    });
    const out = await runRender(d as never, j);
    expect(out.status).toBe("awaiting");
    expect(d.render).not.toHaveBeenCalled();
  });

  it("на падении ffmpeg помечает failed с хвостом ошибки", async () => {
    const d = deps({ render: vi.fn().mockRejectedValue(new Error("ffmpeg вышел с кодом 1: boom")) });
    const out = await runRender(d as never, job());
    expect(out.status).toBe("failed");
    expect(out.error).toMatch(/ffmpeg/);
  });

  it("удаляет временные файлы даже при падении", async () => {
    const d = deps({ render: vi.fn().mockRejectedValue(new Error("boom")) });
    await runRender(d as never, job());
    expect(d.cleanup).toHaveBeenCalled();
  });

  it("не рендерит задачу, которая уже не в awaiting", async () => {
    const d = deps();
    const out = await runRender(d as never, job({ status: "done" }));
    expect(d.render).not.toHaveBeenCalled();
    expect(out.status).toBe("done");
  });

  // Фикс-раунд 1, находка 1: первое сохранение (переход в "rendering") жило
  // вне try/catch — отказ Blob ровно на /ok вылетал из runRender
  // необработанным исключением, роут в after() ловил его только в
  // console.error и в чат не уходило ничего вообще.
  it("если сохранение статуса rendering падает — не бросает, возвращает задачу с ошибкой", async () => {
    const d = deps({ save: vi.fn().mockRejectedValue(new Error("blob unavailable")) });
    const out = await runRender(d as never, job());
    expect(out.status).toBe("failed");
    expect(out.error).toMatch(/blob unavailable/);
    expect(d.download).not.toHaveBeenCalled();
    expect(d.cleanup).toHaveBeenCalled();
  });

  // Фикс-раунд 1, находка 2: доставка в Telegram падает уже ПОСЛЕ успешной
  // заливки в Blob (resultUrl проставлен) — без ссылки в тексте ошибки
  // пользователю пришлось бы гонять минуту рендера заново из-за чисто
  // сетевого сбоя отправки.
  it("если доставка падает после заливки результата — в ошибке остаётся ссылка на готовый файл", async () => {
    const d = deps({ deliver: vi.fn().mockRejectedValue(new Error("Telegram sendVideo failed (502)")) });
    const out = await runRender(d as never, job());
    expect(out.status).toBe("failed");
    expect(out.resultUrl).toBe("https://blob/out.mp4");
    expect(out.error).toMatch(/Telegram sendVideo failed/);
    expect(out.error).toContain("https://blob/out.mp4");
    expect(out.error).toMatch(/сутки/);
  });
});
