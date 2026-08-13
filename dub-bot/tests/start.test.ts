import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSubscriptionMock = vi.fn();
const createDubMock = vi.fn();
const saveJobMock = vi.fn();
const sendMessageMock = vi.fn();
const triggerTickMock = vi.fn();
const headMock = vi.fn();
const deleteBlobMock = vi.fn();

vi.mock("../lib/elevenlabs", () => ({
  getSubscription: (...a: unknown[]) => getSubscriptionMock(...a),
  createDub: (...a: unknown[]) => createDubMock(...a),
}));
vi.mock("../lib/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/jobs")>()),
  saveJob: (...a: unknown[]) => saveJobMock(...a),
  deleteBlob: (...a: unknown[]) => deleteBlobMock(...a),
}));
vi.mock("../lib/telegram", () => ({ sendMessage: (...a: unknown[]) => sendMessageMock(...a) }));
vi.mock("../lib/tick", () => ({ triggerTick: (...a: unknown[]) => triggerTickMock(...a) }));
vi.mock("@vercel/blob", () => ({ head: (...a: unknown[]) => headMock(...a) }));

const { isOwnBlobUrl, startDub } = await import("../lib/start");
const { signToken } = await import("../lib/tokens");

const SECRET = "secret";
const BLOB = "https://abc123.public.blob.vercel-storage.com/dub/sources/1-video.mov";

beforeEach(() => {
  process.env.DUB_TOKEN_SECRET = SECRET;
  process.env.ELEVENLABS_API_KEY = "key";
  process.env.TELEGRAM_DUB_BOT_TOKEN = "tok";
  getSubscriptionMock.mockResolvedValue({ tier: "free", used: 0, limit: 10000, remaining: 10000 });
  createDubMock.mockResolvedValue("dub-1");
  headMock.mockResolvedValue({ size: 1000, uploadedAt: new Date() });
});

afterEach(() => {
  // reset, а не clear: тесты подменяют реализацию моков, и она не должна
  // протекать в соседние тесты (значения по умолчанию ставит beforeEach).
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

function freshToken(chatId = 42) {
  return signToken(chatId, Date.now() + 60_000, SECRET);
}

describe("isOwnBlobUrl", () => {
  it("принимает только публичные ссылки Vercel Blob", () => {
    expect(isOwnBlobUrl(BLOB)).toBe(true);
    expect(isOwnBlobUrl("https://evil.example/video.mp4")).toBe(false);
    expect(isOwnBlobUrl("http://abc.public.blob.vercel-storage.com/x.mov")).toBe(false);
  });
});

describe("startDub", () => {
  it("создаёт задачу и запускает опрос", async () => {
    const { jobId } = await startDub({ token: freshToken(), blobUrl: BLOB, durationSec: 60 });

    expect(createDubMock).toHaveBeenCalledWith("key", expect.objectContaining({ sourceUrl: BLOB }));
    expect(saveJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ jobId, chatId: 42, dubbingId: "dub-1", status: "dubbing" })
    );
    expect(triggerTickMock).toHaveBeenCalledWith(jobId);
    expect(sendMessageMock).toHaveBeenCalled();
  });

  it("на free-тарифе включает водяной знак", async () => {
    await startDub({ token: freshToken(), blobUrl: BLOB, durationSec: 60 });
    expect(createDubMock).toHaveBeenCalledWith("key", expect.objectContaining({ watermark: true }));
  });

  it("на платном тарифе водяной знак снимает", async () => {
    getSubscriptionMock.mockResolvedValue({ tier: "creator", used: 0, limit: 121000, remaining: 121000 });
    await startDub({ token: freshToken(), blobUrl: BLOB, durationSec: 60 });
    expect(createDubMock).toHaveBeenCalledWith("key", expect.objectContaining({ watermark: false }));
  });

  it("отказывает по просроченному токену", async () => {
    const stale = signToken(42, Date.now() - 1, SECRET);
    await expect(startDub({ token: stale, blobUrl: BLOB, durationSec: 60 })).rejects.toThrow(/ссылк/i);
    expect(createDubMock).not.toHaveBeenCalled();
  });

  it("отказывает по чужой ссылке — иначе дубляжу скормят что угодно", async () => {
    await expect(
      startDub({ token: freshToken(), blobUrl: "https://evil.example/v.mp4", durationSec: 60 })
    ).rejects.toThrow(/ссылк/i);
    expect(createDubMock).not.toHaveBeenCalled();
  });

  it("отказывает, когда кредитов не хватает", async () => {
    getSubscriptionMock.mockResolvedValue({ tier: "free", used: 9800, limit: 10000, remaining: 200 });
    await expect(
      startDub({ token: freshToken(), blobUrl: BLOB, durationSec: 60 })
    ).rejects.toThrow(/кредит/i);
    expect(createDubMock).not.toHaveBeenCalled();
  });

  it("не блокирует запуск, если длительность не определилась", async () => {
    getSubscriptionMock.mockResolvedValue({ tier: "free", used: 9800, limit: 10000, remaining: 200 });
    await expect(
      startDub({ token: freshToken(), blobUrl: BLOB, durationSec: 0 })
    ).resolves.toMatchObject({ jobId: expect.any(String) });
  });

  it("отказывает, если файл не из нашего хранилища — даже если ссылка на Vercel Blob", async () => {
    const foreignBlob = "https://attacker999.public.blob.vercel-storage.com/video.mp4";
    headMock.mockRejectedValue(new Error("Not found"));
    await expect(
      startDub({ token: freshToken(), blobUrl: foreignBlob, durationSec: 60 })
    ).rejects.toThrow(/хранилищ/i);
    expect(createDubMock).not.toHaveBeenCalled();
  });

  it("удаляет загруженный исходник, когда не хватает кредитов", async () => {
    getSubscriptionMock.mockResolvedValue({ tier: "free", used: 9800, limit: 10000, remaining: 200 });

    await expect(
      startDub({ token: freshToken(), blobUrl: BLOB, durationSec: 60 })
    ).rejects.toThrow(/кредит/i);

    // Задачи нет, а значит cleanup этот файл уже не найдёт: удалить его больше некому.
    expect(deleteBlobMock).toHaveBeenCalledWith(BLOB);
  });

  it("удаляет исходник, если ElevenLabs не принял задачу", async () => {
    createDubMock.mockRejectedValue(new Error("ElevenLabs createDub failed (400)"));

    await expect(
      startDub({ token: freshToken(), blobUrl: BLOB, durationSec: 60 })
    ).rejects.toThrow(/createDub/);

    expect(deleteBlobMock).toHaveBeenCalledWith(BLOB);
  });

  it("не трогает исходник, когда задача успешно создана", async () => {
    await startDub({ token: freshToken(), blobUrl: BLOB, durationSec: 60 });
    expect(deleteBlobMock).not.toHaveBeenCalled();
  });

  it("не удаляет чужой файл: отказ до проверки владения обходится без удаления", async () => {
    await expect(
      startDub({ token: freshToken(), blobUrl: "https://evil.example/v.mp4", durationSec: 60 })
    ).rejects.toThrow(/ссылк/i);
    expect(deleteBlobMock).not.toHaveBeenCalled();
  });

  it("сохраняет задачу и зовёт на помощь /status, если опрос не запустился", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    triggerTickMock.mockRejectedValue(new Error("tick вернул 403"));

    const { jobId } = await startDub({ token: freshToken(), blobUrl: BLOB, durationSec: 60 });

    // Задача осталась в Blob — иначе /status нечего было бы подхватывать.
    expect(saveJobMock).toHaveBeenCalledWith(expect.objectContaining({ jobId }));
    expect(deleteBlobMock).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledWith("tok", 42, expect.stringContaining("/status"));
  });

  it("проверяет наличие файла в хранилище ДО запроса подписки", async () => {
    const callOrder: string[] = [];
    getSubscriptionMock.mockImplementation(() => {
      callOrder.push("getSubscription");
      return Promise.resolve({ tier: "free", used: 0, limit: 10000, remaining: 10000 });
    });
    headMock.mockImplementation(() => {
      callOrder.push("head");
      return Promise.resolve({ size: 1000, uploadedAt: new Date() });
    });

    await startDub({ token: freshToken(), blobUrl: BLOB, durationSec: 60 });
    expect(callOrder).toEqual(["head", "getSubscription"]);
  });
});
