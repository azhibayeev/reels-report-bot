import { describe, expect, it } from "vitest";
import { parseFarmCommand, parseRetryCount, retryableItems } from "../lib/farm/commands";
import { Item } from "../lib/farm/types";

const base = {
  batchId: "b", chatId: -1, threadId: null, total: 3, hook: "Х", caption: "О",
  messageId: null, editPromptId: null, renderingAt: null, postingAt: null,
  scheduledAt: null, igMediaId: null, permalink: null, createdAt: "2026-08-19T00:00:00.000Z",
} as const;

const item = (over: Partial<Item>): Item =>
  ({ ...base, itemId: "i", index: 1, sourceUrl: "https://blob/s.mp4", videoUrl: null, status: "failed", error: null, ...over }) as Item;

describe("parseFarmCommand", () => {
  it("узнаёт /retry", () => {
    expect(parseFarmCommand("/retry")).toBe("retry");
    expect(parseFarmCommand("/retry@insta_otchet_bot 5")).toBe("retry");
  });
});

describe("parseRetryCount", () => {
  it("без числа берёт три: после починки дешевле проверить на трёх", () => {
    expect(parseRetryCount("/retry")).toBe(3);
  });

  it("читает число и отбрасывает мусор", () => {
    expect(parseRetryCount("/retry 10")).toBe(10);
    expect(parseRetryCount("/retry все")).toBe(3);
    expect(parseRetryCount("/retry -5")).toBe(3);
  });
});

describe("retryableItems", () => {
  it("берёт упавшие до рендера с целой подложкой", () => {
    const list = [
      item({ itemId: "ok", index: 2 }),
      item({ itemId: "no-source", index: 3, sourceUrl: "" }),
      item({ itemId: "published", index: 4, status: "posted" }),
      item({ itemId: "first", index: 1 }),
    ];
    expect(retryableItems(list).map((i) => i.itemId)).toEqual(["first", "ok"]);
  });

  it("не трогает упавших на публикации: повтор рискует дублем в ленте", () => {
    const posted = item({ itemId: "post-fail", videoUrl: "https://blob/out.mp4", error: "IG 429" });
    expect(retryableItems([posted])).toEqual([]);
  });
});
