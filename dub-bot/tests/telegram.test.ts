import { afterEach, describe, expect, it, vi } from "vitest";
import { sendMessage, sendVideoByUrl, sendVideoUpload } from "../lib/telegram";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("sendMessage", () => {
  it("шлёт текст в нужный чат и гасит превью ссылок", async () => {
    const fetchMock = stubFetch(Response.json({ ok: true }));
    await sendMessage("TOK", 42, "привет");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/botTOK/sendMessage");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      chat_id: 42,
      text: "привет",
      link_preview_options: { is_disabled: true },
    });
    expect(body.parse_mode).toBeUndefined();
  });

  it("бросает ошибку со статусом, если Telegram отказал", async () => {
    stubFetch(new Response("bad request", { status: 400 }));
    await expect(sendMessage("TOK", 42, "привет")).rejects.toThrow(/400/);
  });
});

describe("sendVideoByUrl", () => {
  it("передаёт ссылку — Telegram качает файл сам", async () => {
    const fetchMock = stubFetch(Response.json({ ok: true }));
    await sendVideoByUrl("TOK", 42, "https://blob/result.mp4", "готово");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/botTOK/sendVideo");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toMatchObject({
      chat_id: 42,
      video: "https://blob/result.mp4",
      caption: "готово",
    });
  });
});

describe("sendVideoUpload", () => {
  it("грузит файл через multipart", async () => {
    const fetchMock = stubFetch(Response.json({ ok: true }));
    await sendVideoUpload("TOK", 42, new Uint8Array([1, 2, 3]), "dubbed.mp4", "готово");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/botTOK/sendVideo");
    expect(init.headers).toBeUndefined();
    const form = init.body as FormData;
    expect(form.get("chat_id")).toBe("42");
    expect(form.get("caption")).toBe("готово");
    expect(form.get("video")).toBeInstanceOf(Blob);
  });
});
