import { afterEach, describe, expect, it } from "vitest";
import { explain, isAllowed } from "../lib/dub/bot";
import { pickMedia, TgMessage } from "../lib/dub/telegram";

const msg = (over: Partial<TgMessage>): TgMessage => ({ message_id: 1, chat: { id: 77 }, ...over });

afterEach(() => {
  delete process.env.DUB_ALLOWED_CHAT_IDS;
});

describe("pickMedia", () => {
  it("берёт видео, аудио, голос и кружок", () => {
    const file = { file_id: "f", file_unique_id: "u" };
    expect(pickMedia(msg({ video: file }))).toBe(file);
    expect(pickMedia(msg({ audio: file }))).toBe(file);
    expect(pickMedia(msg({ voice: file }))).toBe(file);
    expect(pickMedia(msg({ video_note: file }))).toBe(file);
  });

  it("документ берёт только медийный: PDF дублировать нечем", () => {
    const video = { file_id: "f", file_unique_id: "u", mime_type: "video/mp4" };
    expect(pickMedia(msg({ document: video }))).toBe(video);
    expect(pickMedia(msg({ document: { file_id: "f", file_unique_id: "u", mime_type: "application/pdf" } }))).toBeNull();
    expect(pickMedia(msg({ document: { file_id: "f", file_unique_id: "u" } }))).toBeNull();
  });

  it("на тексте молчит", () => {
    expect(pickMedia(msg({ text: "привет" }))).toBeNull();
  });
});

describe("isAllowed", () => {
  it("пустой список — открыто всем: бот работает сразу после деплоя", () => {
    expect(isAllowed(77)).toBe(true);
  });

  it("заданный список пускает только своих", () => {
    process.env.DUB_ALLOWED_CHAT_IDS = "77, 88";
    expect(isAllowed(77)).toBe(true);
    expect(isAllowed(88)).toBe(true);
    expect(isAllowed(99)).toBe(false);
  });
});

describe("explain", () => {
  it("переводит лимит Telegram на человеческий", () => {
    expect(explain(new Error("Telegram getFile: Bad Request: file is too big"))).toContain("20 МБ");
  });

  it("объясняет упор в три одновременных дубляжа", () => {
    expect(explain(new Error("ElevenLabs /dubbing → 429: too_many_concurrent_requests"))).toContain("3 дубляжа");
  });

  it("незнакомую ошибку отдаёт как есть — глотать её хуже, чем показать сырой", () => {
    expect(explain(new Error("connect ETIMEDOUT"))).toBe("connect ETIMEDOUT");
  });
});
