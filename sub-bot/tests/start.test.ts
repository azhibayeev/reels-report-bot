import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saveJobMock = vi.fn();
const headMock = vi.fn();
const deleteBlobMock = vi.fn();

vi.mock("../lib/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/jobs")>()),
  saveJob: (...a: unknown[]) => saveJobMock(...a),
  deleteBlob: (...a: unknown[]) => deleteBlobMock(...a),
}));
vi.mock("@vercel/blob", () => ({ head: (...a: unknown[]) => headMock(...a) }));

const { isOwnBlobUrl, startJob } = await import("../lib/start");
const { signToken } = await import("../lib/tokens");

const SECRET = "secret";
const BLOB = "https://abc123.public.blob.vercel-storage.com/sub/sources/1-video.mov";

beforeEach(() => {
  process.env.SUB_TOKEN_SECRET = SECRET;
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

describe("startJob", () => {
  it("создаёт задачу со статусом transcribing", async () => {
    const { jobId } = await startJob({ token: freshToken(), blobUrl: BLOB, durationSec: 60 });

    expect(saveJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ jobId, chatId: 42, sourceUrl: BLOB, status: "transcribing" })
    );
  });

  it("отказывает по просроченному токену", async () => {
    const stale = signToken(42, Date.now() - 1, SECRET);
    await expect(startJob({ token: stale, blobUrl: BLOB, durationSec: 60 })).rejects.toThrow(/ссылк/i);
    expect(saveJobMock).not.toHaveBeenCalled();
  });

  it("отказывает по чужой ссылке — иначе обработке скормят что угодно", async () => {
    await expect(
      startJob({ token: freshToken(), blobUrl: "https://evil.example/v.mp4", durationSec: 60 })
    ).rejects.toThrow(/ссылк/i);
    expect(saveJobMock).not.toHaveBeenCalled();
  });

  it("отказывает, если файл не из нашего хранилища — даже если ссылка на Vercel Blob", async () => {
    const foreignBlob = "https://attacker999.public.blob.vercel-storage.com/video.mp4";
    headMock.mockRejectedValue(new Error("Not found"));
    await expect(
      startJob({ token: freshToken(), blobUrl: foreignBlob, durationSec: 60 })
    ).rejects.toThrow(/хранилищ/i);
    expect(saveJobMock).not.toHaveBeenCalled();
  });

  it("не трогает исходник, когда задача успешно создана", async () => {
    await startJob({ token: freshToken(), blobUrl: BLOB, durationSec: 60 });
    expect(deleteBlobMock).not.toHaveBeenCalled();
  });

  it("не удаляет чужой файл: отказ до проверки владения обходится без удаления", async () => {
    await expect(
      startJob({ token: freshToken(), blobUrl: "https://evil.example/v.mp4", durationSec: 60 })
    ).rejects.toThrow(/ссылк/i);
    expect(deleteBlobMock).not.toHaveBeenCalled();
  });

  it("удаляет загруженный исходник, если сохранить задачу не удалось", async () => {
    saveJobMock.mockRejectedValue(new Error("blob put failed"));

    await expect(
      startJob({ token: freshToken(), blobUrl: BLOB, durationSec: 60 })
    ).rejects.toThrow(/blob put failed/);

    // Задачи нет, а значит cleanup этот файл уже не найдёт: удалить его больше некому.
    expect(deleteBlobMock).toHaveBeenCalledWith(BLOB);
  });

  it("проверяет наличие файла в хранилище перед сохранением задачи", async () => {
    const callOrder: string[] = [];
    headMock.mockImplementation(() => {
      callOrder.push("head");
      return Promise.resolve({ size: 1000, uploadedAt: new Date() });
    });
    saveJobMock.mockImplementation(() => {
      callOrder.push("saveJob");
      return Promise.resolve();
    });

    await startJob({ token: freshToken(), blobUrl: BLOB, durationSec: 60 });
    expect(callOrder).toEqual(["head", "saveJob"]);
  });

  it("не блокирует запуск, если длительность не определилась", async () => {
    await expect(
      startJob({ token: freshToken(), blobUrl: BLOB, durationSec: 0 })
    ).resolves.toMatchObject({ jobId: expect.any(String) });
  });
});
