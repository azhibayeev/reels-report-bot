import crypto from "node:crypto";

// Ссылка на страницу пачки живёт полчаса: хватает выбрать файлы и вставить текст,
// но недостаточно, чтобы она где-то осела.
export const BATCH_TOKEN_TTL_MS = 30 * 60 * 1000;

// Токен нигде не хранится: чат, тема и срок годности зашиты в саму подпись.
export function signBatchToken(
  chatId: number,
  threadId: number | null,
  expiresAt: number,
  secret: string
): string {
  const payload = `${chatId}.${threadId ?? ""}.${expiresAt}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest();
  return `${Buffer.from(payload).toString("base64url")}.${sig.toString("base64url")}`;
}

export function verifyBatchToken(
  token: string,
  secret: string,
  nowMs: number
): { chatId: number; threadId: number | null } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const payload = Buffer.from(parts[0], "base64url").toString("utf8");
  const expected = crypto.createHmac("sha256", secret).update(payload).digest();
  const given = Buffer.from(parts[1], "base64url");
  if (given.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(given, expected)) return null;

  const [chatRaw, threadRaw, expiresRaw] = payload.split(".");
  const chatId = Number(chatRaw);
  const expiresAt = Number(expiresRaw);
  // Нечисловая тема дала бы NaN, и он уехал бы в message_thread_id Telegram.
  const threadId = threadRaw === "" ? null : Number(threadRaw);
  if (!Number.isFinite(chatId) || !Number.isFinite(expiresAt)) return null;
  if (threadId !== null && !Number.isFinite(threadId)) return null;
  if (nowMs > expiresAt) return null;
  return { chatId, threadId };
}

// Роуты тиков дёргают сами себя и внешний таймер, поэтому наружу они закрыты
// отдельным ключом: чужой запрос иначе запускал бы рендер и заливку.
export function tickKey(scope: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`tick.${scope}`).digest("base64url");
}
