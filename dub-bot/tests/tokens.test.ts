import { describe, expect, it } from "vitest";
import { signToken, tickKey, verifyToken } from "../lib/tokens";

const SECRET = "test-secret";
const NOW = 1_700_000_000_000;

describe("verifyToken", () => {
  it("принимает свежий токен и возвращает chat_id", () => {
    const token = signToken(42, NOW + 60_000, SECRET);
    expect(verifyToken(token, SECRET, NOW)).toEqual({ chatId: 42 });
  });

  it("отклоняет просроченный токен", () => {
    const token = signToken(42, NOW - 1, SECRET);
    expect(verifyToken(token, SECRET, NOW)).toBeNull();
  });

  it("отклоняет подделанную подпись", () => {
    const token = signToken(42, NOW + 60_000, SECRET);
    const tampered = `${token.split(".")[0]}.AAAA`;
    expect(verifyToken(tampered, SECRET, NOW)).toBeNull();
  });

  it("отклоняет токен, подписанный чужим секретом", () => {
    const token = signToken(42, NOW + 60_000, "other-secret");
    expect(verifyToken(token, SECRET, NOW)).toBeNull();
  });

  it("отклоняет мусор вместо токена", () => {
    expect(verifyToken("", SECRET, NOW)).toBeNull();
    expect(verifyToken("abc", SECRET, NOW)).toBeNull();
    expect(verifyToken("a.b.c", SECRET, NOW)).toBeNull();
  });

  it("не даёт подменить chat_id, оставив чужую подпись", () => {
    const token = signToken(42, NOW + 60_000, SECRET);
    const forged = `${Buffer.from(`99.${NOW + 60_000}`).toString("base64url")}.${token.split(".")[1]}`;
    expect(verifyToken(forged, SECRET, NOW)).toBeNull();
  });
});

describe("tickKey", () => {
  it("детерминирован для одной задачи", () => {
    expect(tickKey("job-1", SECRET)).toBe(tickKey("job-1", SECRET));
  });

  it("различается для разных задач", () => {
    expect(tickKey("job-1", SECRET)).not.toBe(tickKey("job-2", SECRET));
  });
});
