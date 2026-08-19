import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvalKeyboard, CAPTION_BODY_LIMIT, farmCaption, sendVideoWithButtons } from "../lib/farm/telegram";

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = "T";
  vi.unstubAllGlobals();
});

describe("approvalKeyboard", () => {
  it("три кнопки, callback_data влезает в лимит 64 байта", () => {
    const kb = approvalKeyboard("6f1e1b8c-2d4a-4a1e-9d3c-0a1b2c3d4e5f");
    const buttons = kb.inline_keyboard[0];
    expect(buttons.map((b) => b.callback_data)).toEqual([
      "a:6f1e1b8c-2d4a-4a1e-9d3c-0a1b2c3d4e5f",
      "r:6f1e1b8c-2d4a-4a1e-9d3c-0a1b2c3d4e5f",
      "e:6f1e1b8c-2d4a-4a1e-9d3c-0a1b2c3d4e5f",
    ]);
    for (const b of buttons) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
  });
});

describe("farmCaption", () => {
  it("режет описание до 700 знаков: лимит подписи Telegram 1024", () => {
    const caption = farmCaption(7, 30, "Хук", "я".repeat(2000));
    expect(caption).toContain("7/30");
    expect(caption).toContain("…");
    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(CAPTION_BODY_LIMIT).toBe(700);
    expect(caption.endsWith("я".repeat(CAPTION_BODY_LIMIT) + "…")).toBe(true);
  });

  it("короткое описание не трогает", () => {
    expect(farmCaption(1, 2, "Хук", "Описание")).toBe("1/2\n\nХук\n\nОписание");
  });
});

describe("sendVideoWithButtons", () => {
  it("возвращает message_id и передаёт тему форума", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 555 } }))
    );
    vi.stubGlobal("fetch", fetchMock);

    const id = await sendVideoWithButtons({
      chatId: -100, threadId: 42, videoUrl: "https://blob/out.mp4",
      caption: "1/1", itemId: "i1",
    });

    expect(id).toBe(555);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]!.body));
    expect(body.message_thread_id).toBe(42);
    expect(body.reply_markup.inline_keyboard[0]).toHaveLength(3);
  });

  it("отказ Telegram — исключение с текстом ответа", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("too big", { status: 400 })));
    await expect(
      sendVideoWithButtons({ chatId: -100, threadId: null, videoUrl: "u", caption: "c", itemId: "i" })
    ).rejects.toThrow(/too big/);
  });
});
