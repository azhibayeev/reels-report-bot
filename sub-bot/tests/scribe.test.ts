import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribe } from "../lib/scribe";

const ok = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body, text: async () => "" });

afterEach(() => vi.unstubAllGlobals());

describe("transcribe", () => {
  it("оставляет только слова, выбрасывая паузы и звуковые события", async () => {
    vi.stubGlobal(
      "fetch",
      ok({
        words: [
          { text: "Читай", type: "word", start: 0, end: 0.4 },
          { text: " ", type: "spacing", start: 0.4, end: 0.45 },
          { text: "(музыка)", type: "audio_event", start: 0.45, end: 1.2 },
          { text: "дуа", type: "word", start: 1.2, end: 1.6 },
        ],
      })
    );
    const words = await transcribe("k", "https://x/a.mp4");
    expect(words.map((w) => w.text)).toEqual(["Читай", "дуа"]);
  });

  it("шлёт source_url, язык и keyterms", async () => {
    const f = ok({ words: [] });
    vi.stubGlobal("fetch", f);
    await transcribe("k", "https://x/a.mp4");
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("k");
    const body = init.body as FormData;
    expect(body.get("source_url")).toBe("https://x/a.mp4");
    expect(body.get("language_code")).toBe("rus");
    expect(String(body.get("keyterms"))).toContain("дуа");
  });

  it("на ошибке API бросает исключение с кодом и куском тела ответа", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "unauthorized",
        json: async () => ({}),
      })
    );
    await expect(transcribe("k", "https://x/a.mp4")).rejects.toThrow(/401/);
    await expect(transcribe("k", "https://x/a.mp4")).rejects.toThrow(/unauthorized/);
  });

  it("на ответе без слов возвращает пустой список, а не падает", async () => {
    vi.stubGlobal("fetch", ok({}));
    expect(await transcribe("k", "https://x/a.mp4")).toEqual([]);
  });

  it("отбрасывает токен с нечисловым таймкодом, а не пропускает с NaN", async () => {
    vi.stubGlobal(
      "fetch",
      ok({
        words: [
          { text: "Читай", type: "word", start: 0, end: 0.4 },
          { text: "дуа", type: "word", start: null, end: 1.6 },
          { text: "снова", type: "word", start: 1.6, end: undefined },
        ],
      })
    );
    const words = await transcribe("k", "https://x/a.mp4");
    expect(words.map((w) => w.text)).toEqual(["Читай"]);
    expect(words.every((w) => Number.isFinite(w.start) && Number.isFinite(w.end))).toBe(true);
  });

  it("отбрасывает токен с пустым текстом после обрезки пробелов", async () => {
    vi.stubGlobal(
      "fetch",
      ok({
        words: [
          { text: "Читай", type: "word", start: 0, end: 0.4 },
          { text: "   ", type: "word", start: 0.4, end: 0.5 },
          { text: "", type: "word", start: 0.5, end: 0.6 },
          { text: "дуа", type: "word", start: 0.6, end: 1.0 },
        ],
      })
    );
    const words = await transcribe("k", "https://x/a.mp4");
    expect(words.map((w) => w.text)).toEqual(["Читай", "дуа"]);
  });
});
