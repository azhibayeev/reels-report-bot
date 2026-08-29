import { afterEach, describe, expect, it } from "vitest";
import { callbackData, explain, isAllowed, parseCallback } from "../lib/dub/bot";
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

describe("кнопки субтитров", () => {
  it("ответ читается обратно", () => {
    expect(parseCallback(callbackData(true, "77-5"))).toEqual({ subtitles: true, jobId: "77-5" });
    expect(parseCallback(callbackData(false, "77-5"))).toEqual({ subtitles: false, jobId: "77-5" });
  });

  it("id группы с минусом и дефисом внутри не рвётся по разделителю", () => {
    const data = callbackData(true, "-1002234567890-12345");
    expect(parseCallback(data)).toEqual({ subtitles: true, jobId: "-1002234567890-12345" });
  });

  it("влезает в 64 байта callback_data, иначе Telegram отвергнет саму кнопку", () => {
    expect(Buffer.byteLength(callbackData(true, "-1002234567890-999999"))).toBeLessThanOrEqual(64);
  });

  it("чужое и порченое не трогает: это может быть кнопка другого бота или старого формата", () => {
    expect(parseCallback(undefined)).toBeNull();
    expect(parseCallback("")).toBeNull();
    expect(parseCallback("sub:")).toBeNull();
    expect(parseCallback("sub:1:")).toBeNull();
    expect(parseCallback("sub:2:77-5")).toBeNull();
    expect(parseCallback("что-то:1:77-5")).toBeNull();
  });
});
