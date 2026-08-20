import crypto from "node:crypto";

// Ссылка на страницу загрузки живёт полчаса: этого хватает, чтобы открыть её
// на телефоне и выбрать ролик, но недостаточно, чтобы она где-то осела.
export const UPLOAD_TOKEN_TTL_MS = 30 * 60 * 1000;

// Токен не хранится нигде: chat_id и срок годности зашиты в саму подпись.
export function signToken(chatId: number, expiresAt: number, secret: string): string {
  const payload = `${chatId}.${expiresAt}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest();
  return `${Buffer.from(payload).toString("base64url")}.${sig.toString("base64url")}`;
}

export function verifyToken(
  token: string,
  secret: string,
  nowMs: number
): { chatId: number } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const payload = Buffer.from(parts[0], "base64url").toString("utf8");
  const expected = crypto.createHmac("sha256", secret).update(payload).digest();
  const given = Buffer.from(parts[1], "base64url");
  if (given.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(given, expected)) return null;

  const [chatIdRaw, expiresRaw] = payload.split(".");
  const chatId = Number(chatIdRaw);
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(chatId) || !Number.isFinite(expiresAt)) return null;
  if (nowMs > expiresAt) return null;
  return { chatId };
}

// Отдельный ключ для самовызова функции обработки: роут дёргает сам себя, и он
// не должен быть открыт наружу — иначе чужой запрос запустит лишнюю обработку.
export function tickKey(jobId: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`tick.${jobId}`).digest("base64url");
}
