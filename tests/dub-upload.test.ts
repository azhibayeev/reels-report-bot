import { afterEach, describe, expect, it } from "vitest";
import { jobIdOf, tooBigText, uploadLink } from "../lib/dub/bot";
import { signUploadToken, UPLOAD_TOKEN_TTL_MS, verifyUploadToken } from "../lib/dub/tokens";
import { resultPath, safeName, sourcePath } from "../lib/dub/uploads";

const SECRET = "s3cret";
const NOW = Date.parse("2026-08-28T12:00:00.000Z");

afterEach(() => {
  delete process.env.DUB_WEBHOOK_SECRET;
});

describe("токен загрузки", () => {
  it("возвращает чат и сообщение обратно", () => {
    const token = signUploadToken({ chatId: 77, messageId: 5 }, NOW + 1000, SECRET);
    expect(verifyUploadToken(token, SECRET, NOW)).toEqual({ chatId: 77, messageId: 5 });
  });

  it("отрицательный chat id групп не теряется", () => {
    const token = signUploadToken({ chatId: -1002234, messageId: 9 }, NOW + 1000, SECRET);
    expect(verifyUploadToken(token, SECRET, NOW)?.chatId).toBe(-1002234);
  });

  it("чужой секрет не проходит — иначе в наш Blob зальёт кто угодно", () => {
    const token = signUploadToken({ chatId: 77, messageId: 5 }, NOW + 1000, SECRET);
    expect(verifyUploadToken(token, "другой", NOW)).toBeNull();
  });

  it("подделанная начинка не проходит", () => {
    const token = signUploadToken({ chatId: 77, messageId: 5 }, NOW + 1000, SECRET);
    const forged = `${Buffer.from(`88.5.${NOW + 1000}`).toString("base64url")}.${token.split(".")[1]}`;
    expect(verifyUploadToken(forged, SECRET, NOW)).toBeNull();
  });

  it("просроченный не проходит", () => {
    const token = signUploadToken({ chatId: 77, messageId: 5 }, NOW - 1, SECRET);
    expect(verifyUploadToken(token, SECRET, NOW)).toBeNull();
  });

  it("мусор не роняет проверку: timingSafeEqual падает на разной длине", () => {
    expect(verifyUploadToken("", SECRET, NOW)).toBeNull();
    expect(verifyUploadToken("однакусок", SECRET, NOW)).toBeNull();
    expect(verifyUploadToken("aaa.bbb", SECRET, NOW)).toBeNull();
    expect(verifyUploadToken("a.b.c", SECRET, NOW)).toBeNull();
  });
});

describe("ссылка на загрузку", () => {
  it("ведёт на /dub/<токен> и живёт час", () => {
    process.env.DUB_WEBHOOK_SECRET = SECRET;
    const link = uploadLink("https://qurany.example/", 77, 5, NOW);
    // Лишний слэш в базе не должен превращаться в //dub/.
    expect(link.startsWith("https://qurany.example/dub/")).toBe(true);

    const token = link.slice("https://qurany.example/dub/".length);
    expect(verifyUploadToken(token, SECRET, NOW + UPLOAD_TOKEN_TTL_MS - 1)).toEqual({ chatId: 77, messageId: 5 });
    expect(verifyUploadToken(token, SECRET, NOW + UPLOAD_TOKEN_TTL_MS + 1)).toBeNull();
  });

  it("в отказе есть и вес ролика, и сама ссылка — без неё сообщение бесполезно", () => {
    const text = tooBigText(32 * 1024 * 1024, "https://qurany.example/dub/tok");
    expect(text).toContain("32 МБ");
    expect(text).toContain("https://qurany.example/dub/tok");
  });
});

describe("пути в Blob", () => {
  it("кириллица и пробелы не уезжают в pathname", () => {
    expect(safeName("Ролик про намаз.mp4")).toBe("video.mp4");
    expect(safeName("my clip (1).MOV")).toBe("my-clip-1-.MOV");
    expect(safeName("!!!")).toBe("video");
  });

  it("исходник и результат лежат под id задачи — по осиротевшему файлу видно, чей он", () => {
    expect(sourcePath(jobIdOf(77, 5), "reels.mp4")).toBe("dub/sources/77-5-reels.mp4");
    expect(resultPath("77-5", "reels-id.mp4")).toBe("dub/out/77-5-reels-id.mp4");
  });
});
