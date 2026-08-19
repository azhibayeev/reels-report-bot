import { describe, expect, it } from "vitest";
import { signBatchToken, tickKey, verifyBatchToken } from "../lib/farm/tokens";

const SECRET = "s3cret";
const NOW = 1_760_000_000_000;

describe("batch token", () => {
  it("возвращает чат и тему", () => {
    const token = signBatchToken(-100123, 42, NOW + 1000, SECRET);
    expect(verifyBatchToken(token, SECRET, NOW)).toEqual({ chatId: -100123, threadId: 42 });
  });

  it("тема может отсутствовать", () => {
    const token = signBatchToken(-100123, null, NOW + 1000, SECRET);
    expect(verifyBatchToken(token, SECRET, NOW)).toEqual({ chatId: -100123, threadId: null });
  });

  it("просроченный не принимается", () => {
    const token = signBatchToken(1, null, NOW - 1, SECRET);
    expect(verifyBatchToken(token, SECRET, NOW)).toBeNull();
  });

  it("чужая подпись не принимается", () => {
    const token = signBatchToken(1, null, NOW + 1000, "other");
    expect(verifyBatchToken(token, SECRET, NOW)).toBeNull();
  });

  it("подделка полезной нагрузки не принимается", () => {
    const token = signBatchToken(1, null, NOW + 1000, SECRET);
    const [, sig] = token.split(".");
    const forged = `${Buffer.from("999.-.99999999999999").toString("base64url")}.${sig}`;
    expect(verifyBatchToken(forged, SECRET, NOW)).toBeNull();
  });

  it("нечисловая тема не принимается", () => {
    const token = signBatchToken(1, Number.NaN, NOW + 1000, SECRET);
    expect(verifyBatchToken(token, SECRET, NOW)).toBeNull();
  });
});

describe("tickKey", () => {
  it("детерминирован и различает области", () => {
    expect(tickKey("render:abc", SECRET)).toBe(tickKey("render:abc", SECRET));
    expect(tickKey("render:abc", SECRET)).not.toBe(tickKey("post", SECRET));
  });
});
