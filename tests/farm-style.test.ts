import { beforeEach, describe, expect, it, vi } from "vitest";

const { put, list } = vi.hoisted(() => ({ put: vi.fn(), list: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put, list }));

import { loadDefaultPosition, saveDefaultPosition, STYLE_PATH } from "../lib/farm/style";

beforeEach(() => {
  put.mockReset();
  list.mockReset();
  vi.unstubAllGlobals();
});

describe("saveDefaultPosition", () => {
  it("пишет по стабильному пути с перезаписью", async () => {
    await saveDefaultPosition("center");
    expect(put).toHaveBeenCalledWith(
      STYLE_PATH,
      JSON.stringify({ position: "center" }),
      expect.objectContaining({ addRandomSuffix: false, allowOverwrite: true })
    );
  });
});

describe("loadDefaultPosition", () => {
  it("возвращает сохранённое значение и читает с cache-busting", async () => {
    list.mockResolvedValue({ blobs: [{ pathname: STYLE_PATH, url: "https://blob/style.json" }] });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ position: "bottom" })));
    vi.stubGlobal("fetch", fetchMock);

    const loaded = await loadDefaultPosition();

    expect(loaded).toBe("bottom");
    expect(String(fetchMock.mock.calls[0][0])).toContain("?ts=");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });

  it("нет блоба — top по умолчанию", async () => {
    list.mockResolvedValue({ blobs: [] });
    expect(await loadDefaultPosition()).toBe("top");
  });

  it("битый JSON — top", async () => {
    list.mockResolvedValue({ blobs: [{ pathname: STYLE_PATH, url: "https://blob/style.json" }] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{не json")));
    expect(await loadDefaultPosition()).toBe("top");
  });

  it("значение не из трёх известных — top", async () => {
    list.mockResolvedValue({ blobs: [{ pathname: STYLE_PATH, url: "https://blob/style.json" }] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ position: "middle" }))));
    expect(await loadDefaultPosition()).toBe("top");
  });

  it("падение list — top, а не исключение", async () => {
    list.mockRejectedValue(new Error("blob недоступен"));
    expect(await loadDefaultPosition()).toBe("top");
  });

  it("fetch бросает исключение — top", async () => {
    list.mockResolvedValue({ blobs: [{ pathname: STYLE_PATH, url: "https://blob/style.json" }] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("сеть недоступна");
      })
    );
    expect(await loadDefaultPosition()).toBe("top");
  });

  it("ответ !ok (500) — top", async () => {
    list.mockResolvedValue({ blobs: [{ pathname: STYLE_PATH, url: "https://blob/style.json" }] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    expect(await loadDefaultPosition()).toBe("top");
  });
});
