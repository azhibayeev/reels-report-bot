import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadToTmp } from "../lib/storage";

afterEach(() => vi.unstubAllGlobals());

describe("downloadToTmp", () => {
  it("качает файл во временный каталог и возвращает путь к нему", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.buffer,
      })
    );

    const path = await downloadToTmp("https://abc.public.blob.vercel-storage.com/sub/sources/a.mp4");

    expect(path.startsWith(tmpdir())).toBe(true);
    expect(path).toMatch(/source\.mp4$/);
    expect(Array.from(readFileSync(path))).toEqual([1, 2, 3, 4]);
  });

  it("берёт расширение по умолчанию .mp4, если в ссылке его нет", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) })
    );

    const path = await downloadToTmp("https://abc.public.blob.vercel-storage.com/sub/sources/noext");
    expect(path).toMatch(/source\.mp4$/);
  });

  it("два вызова получают разные временные каталоги — задачи не пересекутся", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) })
    );

    const a = await downloadToTmp("https://x/a.mp4");
    const b = await downloadToTmp("https://x/b.mp4");
    expect(a).not.toBe(b);
  });

  it("на ошибке загрузки бросает понятную ошибку с кодом ответа", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })
    );
    await expect(downloadToTmp("https://x/missing.mp4")).rejects.toThrow(/404/);
  });
});
