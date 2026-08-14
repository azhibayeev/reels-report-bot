import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadJobMock = vi.fn();
const saveJobMock = vi.fn();
const deleteBlobMock = vi.fn();
const getDubStatusMock = vi.fn();
const downloadDubMock = vi.fn();
const sendMessageMock = vi.fn();
const sendVideoByUrlMock = vi.fn();
const sendVideoUploadMock = vi.fn();
const putMock = vi.fn();
const headMock = vi.fn();

vi.mock("../lib/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/jobs")>()),
  loadJob: (...a: unknown[]) => loadJobMock(...a),
  saveJob: (...a: unknown[]) => saveJobMock(...a),
  deleteBlob: (...a: unknown[]) => deleteBlobMock(...a),
}));
vi.mock("../lib/elevenlabs", () => ({
  getDubStatus: (...a: unknown[]) => getDubStatusMock(...a),
  downloadDub: (...a: unknown[]) => downloadDubMock(...a),
  TARGET_LANG: "id",
}));
vi.mock("../lib/telegram", () => ({
  sendMessage: (...a: unknown[]) => sendMessageMock(...a),
  sendVideoByUrl: (...a: unknown[]) => sendVideoByUrlMock(...a),
  sendVideoUpload: (...a: unknown[]) => sendVideoUploadMock(...a),
}));
vi.mock("@vercel/blob", () => ({
  put: (...a: unknown[]) => putMock(...a),
  head: (...a: unknown[]) => headMock(...a),
  list: vi.fn(),
  del: vi.fn(),
}));

import type { Job } from "../lib/jobs";

const {
  runTick,
  triggerTick,
  DELIVERY_RESERVE_MS,
  DELIVERY_TAKEOVER_MS,
  INVOCATION_BUDGET_MS,
  POLL_INTERVAL_MS,
} = await import("../lib/tick");

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    jobId: "job-1",
    chatId: 42,
    dubbingId: "dub-1",
    sourceUrl: "https://blob/source.mov",
    resultUrl: null,
    status: "dubbing",
    durationSec: 60,
    deliveringAt: null,
    createdAt: new Date().toISOString(),
    error: null,
    ...overrides,
  };
}

beforeEach(() => {
  process.env.ELEVENLABS_API_KEY = "key";
  process.env.TELEGRAM_DUB_BOT_TOKEN = "tok";
  process.env.DUB_TOKEN_SECRET = "secret";
  process.env.DUB_BASE_URL = "https://dub.example";
});

afterEach(() => {
  // Именно reset: часть тестов подменяет реализацию моков, и она не должна
  // протекать в следующий тест.
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("triggerTick", () => {
  it("падает на не-2xx: иначе цепочка опроса умирает молча", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 })));
    await expect(triggerTick("job-1")).rejects.toThrow(/403/);
  });

  it("принимает 202 от самого роута tick", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
    await expect(triggerTick("job-1")).resolves.toBeUndefined();
  });
});

describe("runTick", () => {
  it("ничего не делает для уже завершённой задачи", async () => {
    loadJobMock.mockResolvedValue(makeJob({ status: "done" }));
    await runTick("job-1");
    expect(getDubStatusMock).not.toHaveBeenCalled();
  });

  it("сообщает об ошибке дубляжа и закрывает задачу", async () => {
    loadJobMock.mockResolvedValue(makeJob());
    getDubStatusMock.mockResolvedValue({ status: "failed", error: "no speech", durationSec: null });

    await runTick("job-1");

    expect(sendMessageMock).toHaveBeenCalledWith("tok", 42, expect.stringContaining("no speech"));
    expect(saveJobMock).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("маленький результат отдаёт ссылкой", async () => {
    loadJobMock.mockResolvedValue(makeJob());
    getDubStatusMock.mockResolvedValue({ status: "dubbed", error: null, durationSec: 60 });
    downloadDubMock.mockResolvedValue(new Response("video-bytes"));
    putMock.mockResolvedValue({ url: "https://blob/result.mp4" });
    headMock.mockResolvedValue({ size: 5 * 1024 * 1024 });

    await runTick("job-1");

    expect(sendVideoByUrlMock).toHaveBeenCalledWith(
      "tok",
      42,
      "https://blob/result.mp4",
      expect.any(String)
    );
    expect(deleteBlobMock).toHaveBeenCalledWith("https://blob/source.mov");
    expect(saveJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "done", resultUrl: "https://blob/result.mp4" })
    );
  });

  it("помечает задачу delivering до первой отправки", async () => {
    const order: string[] = [];
    loadJobMock.mockResolvedValue(makeJob());
    getDubStatusMock.mockResolvedValue({ status: "dubbed", error: null, durationSec: 60 });
    downloadDubMock.mockResolvedValue(new Response("video-bytes"));
    putMock.mockResolvedValue({ url: "https://blob/result.mp4" });
    headMock.mockResolvedValue({ size: 5 * 1024 * 1024 });
    saveJobMock.mockImplementation((job: Job) => void order.push(`save:${job.status}`));
    sendVideoByUrlMock.mockImplementation(() => void order.push("send"));

    await runTick("job-1");

    expect(order).toEqual(["save:delivering", "send", "save:done"]);
  });

  it("записывает время начала доставки вместе с отметкой delivering", async () => {
    loadJobMock.mockResolvedValue(makeJob());
    getDubStatusMock.mockResolvedValue({ status: "dubbed", error: null, durationSec: 60 });
    downloadDubMock.mockResolvedValue(new Response("video-bytes"));
    putMock.mockResolvedValue({ url: "https://blob/result.mp4" });
    headMock.mockResolvedValue({ size: 5 * 1024 * 1024 });

    await runTick("job-1");

    const marked = saveJobMock.mock.calls[0]?.[0] as Job;
    expect(marked.status).toBe("delivering");
    expect(Number.isNaN(Date.parse(marked.deliveringAt as string))).toBe(false);
  });

  it("не начинает доставку на остатке бюджета — передаёт её свежему вызову", async () => {
    vi.useFakeTimers();
    try {
      loadJobMock.mockResolvedValue(makeJob());
      const startedAt = Date.now();
      // Готовность приходит поздно: к этому моменту до конца бюджета вызова
      // остаётся меньше DELIVERY_RESERVE_MS, и доставка бы не успела.
      getDubStatusMock.mockImplementation(() =>
        Promise.resolve(
          Date.now() - startedAt > INVOCATION_BUDGET_MS - DELIVERY_RESERVE_MS
            ? { status: "dubbed", error: null, durationSec: 60 }
            : { status: "dubbing", error: null, durationSec: null }
        )
      );
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
      vi.stubGlobal("fetch", fetchMock);

      const runPromise = runTick("job-1");
      await vi.advanceTimersByTimeAsync(INVOCATION_BUDGET_MS + POLL_INTERVAL_MS);
      await runPromise;

      expect(saveJobMock).not.toHaveBeenCalled();
      expect(downloadDubMock).not.toHaveBeenCalled();
      expect(sendVideoByUrlMock).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/dub/tick");
    } finally {
      vi.useRealTimers();
    }
  });

  it("не перехватывает доставку, начатую только что", async () => {
    loadJobMock
      .mockResolvedValueOnce(makeJob())
      .mockResolvedValueOnce(
        makeJob({ status: "delivering", deliveringAt: new Date().toISOString() })
      );
    getDubStatusMock.mockResolvedValue({ status: "dubbed", error: null, durationSec: 60 });

    await runTick("job-1");

    expect(downloadDubMock).not.toHaveBeenCalled();
    expect(sendVideoByUrlMock).not.toHaveBeenCalled();
    expect(saveJobMock).not.toHaveBeenCalled();
  });

  it("перехватывает доставку, брошенную дольше времени жизни вызова назад", async () => {
    loadJobMock.mockResolvedValueOnce(makeJob()).mockResolvedValueOnce(
      makeJob({
        status: "delivering",
        deliveringAt: new Date(Date.now() - DELIVERY_TAKEOVER_MS - 1000).toISOString(),
      })
    );
    getDubStatusMock.mockResolvedValue({ status: "dubbed", error: null, durationSec: 60 });
    downloadDubMock.mockResolvedValue(new Response("video-bytes"));
    putMock.mockResolvedValue({ url: "https://blob/result.mp4" });
    headMock.mockResolvedValue({ size: 5 * 1024 * 1024 });

    await runTick("job-1");

    expect(sendVideoByUrlMock).toHaveBeenCalledWith(
      "tok",
      42,
      "https://blob/result.mp4",
      expect.any(String)
    );
    expect(saveJobMock).toHaveBeenCalledWith(expect.objectContaining({ status: "done" }));
  });

  it("вторая цепочка не отправляет ролик повторно: задача уже в доставке", async () => {
    // Первое чтение — из runTick, второе — перепроверка внутри deliver: к этому
    // моменту соседний tick уже успел отметить задачу как «delivering».
    loadJobMock
      .mockResolvedValueOnce(makeJob())
      .mockResolvedValueOnce(makeJob({ status: "delivering", deliveringAt: new Date().toISOString() }));
    getDubStatusMock.mockResolvedValue({ status: "dubbed", error: null, durationSec: 60 });

    await runTick("job-1");

    expect(downloadDubMock).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
    expect(sendVideoByUrlMock).not.toHaveBeenCalled();
    expect(sendVideoUploadMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(saveJobMock).not.toHaveBeenCalled();
  });

  it("после успешной доставки повтор ничего не шлёт заново", async () => {
    loadJobMock
      .mockResolvedValueOnce(makeJob())
      .mockResolvedValueOnce(makeJob({ status: "done", resultUrl: "https://blob/result.mp4" }));
    getDubStatusMock.mockResolvedValue({ status: "dubbed", error: null, durationSec: 60 });

    await runTick("job-1");

    expect(sendVideoByUrlMock).not.toHaveBeenCalled();
    expect(deleteBlobMock).not.toHaveBeenCalled();
  });

  it("результат между 20 и 50 МБ грузит через функцию", async () => {
    loadJobMock.mockResolvedValue(makeJob());
    getDubStatusMock.mockResolvedValue({ status: "dubbed", error: null, durationSec: 60 });
    downloadDubMock.mockResolvedValue(new Response("video-bytes"));
    putMock.mockResolvedValue({ url: "https://blob/result.mp4" });
    headMock.mockResolvedValue({ size: 30 * 1024 * 1024 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]))));

    await runTick("job-1");

    expect(sendVideoUploadMock).toHaveBeenCalled();
    expect(sendVideoByUrlMock).not.toHaveBeenCalled();
  });

  it("слишком большой результат отдаёт ссылкой текстом", async () => {
    loadJobMock.mockResolvedValue(makeJob());
    getDubStatusMock.mockResolvedValue({ status: "dubbed", error: null, durationSec: 60 });
    downloadDubMock.mockResolvedValue(new Response("video-bytes"));
    putMock.mockResolvedValue({ url: "https://blob/result.mp4" });
    headMock.mockResolvedValue({ size: 80 * 1024 * 1024 });

    await runTick("job-1");

    expect(sendMessageMock).toHaveBeenCalledWith(
      "tok",
      42,
      expect.stringContaining("https://blob/result.mp4")
    );
    expect(sendVideoUploadMock).not.toHaveBeenCalled();
  });

  it("сдаётся, если задача висит дольше получаса", async () => {
    loadJobMock.mockResolvedValue(
      makeJob({ createdAt: new Date(Date.now() - 31 * 60 * 1000).toISOString() })
    );

    await runTick("job-1");

    expect(getDubStatusMock).not.toHaveBeenCalled();
    expect(saveJobMock).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("продлевает цепочку через triggerTick, когда бюджет вызова исчерпан", async () => {
    vi.useFakeTimers();
    try {
      loadJobMock.mockResolvedValue(makeJob());
      // Дубляж всё ещё не готов — ни на одном опросе не встретится terminal-статус,
      // поэтому цикл должен упереться в INVOCATION_BUDGET_MS, а не в него.
      getDubStatusMock.mockResolvedValue({ status: "dubbing", error: null, durationSec: null });
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
      vi.stubGlobal("fetch", fetchMock);

      const runPromise = runTick("job-1");
      // Продвигаем время сразу за пределы бюджета вызова — этого достаточно, чтобы
      // размотать всю цепочку sleep(POLL_INTERVAL_MS) внутри цикла опроса.
      await vi.advanceTimersByTimeAsync(INVOCATION_BUDGET_MS + POLL_INTERVAL_MS);
      await runPromise;

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
      expect(requestedUrl).toContain("/api/dub/tick");
      expect(requestedUrl).toContain("job=job-1");
      expect(requestedUrl).toContain("key=");
    } finally {
      vi.useRealTimers();
    }
  });
});
