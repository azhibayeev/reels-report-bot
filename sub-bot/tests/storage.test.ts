import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
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

    const { path } = await downloadToTmp(
      "https://abc.public.blob.vercel-storage.com/sub/sources/a.mp4"
    );

    expect(path.startsWith(tmpdir())).toBe(true);
    expect(path).toMatch(/source\.mp4$/);
    expect(Array.from(readFileSync(path))).toEqual([1, 2, 3, 4]);
  });

  it("берёт расширение по умолчанию .mp4, если в ссылке его нет", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) })
    );

    const { path } = await downloadToTmp("https://abc.public.blob.vercel-storage.com/sub/sources/noext");
    expect(path).toMatch(/source\.mp4$/);
  });

  it("два вызова получают разные временные каталоги — задачи не пересекутся", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) })
    );

    const a = await downloadToTmp("https://x/a.mp4");
    const b = await downloadToTmp("https://x/b.mp4");
    expect(a.path).not.toBe(b.path);
  });

  it("на ошибке загрузки читает тело ответа и кладёт его кусок в текст ошибки вместе с кодом", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "blob not found",
        arrayBuffer: async () => new ArrayBuffer(0),
      })
    );
    await expect(downloadToTmp("https://x/missing.mp4")).rejects.toThrow(/404/);
    await expect(downloadToTmp("https://x/missing.mp4")).rejects.toThrow(/blob not found/);
  });

  // Фикс-раунд 1, находка 2: раньше временный каталог не удалялся никогда.
  describe("dispose", () => {
    async function download() {
      const bytes = new Uint8Array([9, 9]);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer })
      );
      return downloadToTmp("https://x/a.mp4");
    }

    it("удаляет временный каталог целиком", async () => {
      const { path, dispose } = await download();
      const dir = dirname(path);
      expect(existsSync(dir)).toBe(true);

      dispose();

      expect(existsSync(dir)).toBe(false);
      expect(existsSync(path)).toBe(false);
    });

    it("идемпотентна — повторный вызов на уже удалённом каталоге не бросает", async () => {
      const { dispose } = await download();
      dispose();
      expect(() => dispose()).not.toThrow();
    });
  });
});
