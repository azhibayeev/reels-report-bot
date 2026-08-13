import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSubscriptionMock = vi.fn();
const createDubMock = vi.fn();
const saveJobMock = vi.fn();
const sendMessageMock = vi.fn();
const triggerTickMock = vi.fn();

vi.mock("../lib/elevenlabs", () => ({
  getSubscription: (...a: unknown[]) => getSubscriptionMock(...a),
  createDub: (...a: unknown[]) => createDubMock(...a),
}));
vi.mock("../lib/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/jobs")>()),
  saveJob: (...a: unknown[]) => saveJobMock(...a),
}));
vi.mock("../lib/telegram", () => ({ sendMessage: (...a: unknown[]) => sendMessageMock(...a) }));
vi.mock("../lib/tick", () => ({ triggerTick: (...a: unknown[]) => triggerTickMock(...a) }));

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
});

afterEach(() => {
  vi.clearAllMocks();
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
});
