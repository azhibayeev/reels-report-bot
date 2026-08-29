import crypto from "node:crypto";

// Ссылка на загрузку живёт час: сотню мегабайт с телефона на мобильном интернете
// заливать долго, а держать дверь в наш Blob открытой дольше незачем.
export const UPLOAD_TOKEN_TTL_MS = 60 * 60 * 1000;

export interface UploadClaim {
  chatId: number;
  /** Сообщение с тяжёлым роликом. Из него собирается jobId, поэтому повторная
   *  загрузка по той же ссылке заменит задачу, а не заведёт вторую за те же деньги. */
  messageId: number;
}

// Отдельного секрета бот не заводит: DUB_WEBHOOK_SECRET у него уже есть, а HMAC
// не раскрывает ключ — по утёкшей ссылке нельзя подписать вторую.
export function uploadSecret(): string {
  const v = process.env.DUB_WEBHOOK_SECRET;
  if (!v) throw new Error("DUB_WEBHOOK_SECRET не задан");
  return v;
}

// Токен нигде не хранится: чат, сообщение и срок годности зашиты в саму подпись.
export function signUploadToken(claim: UploadClaim, expiresAt: number, secret: string): string {
  const payload = `${claim.chatId}.${claim.messageId}.${expiresAt}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest();
  return `${Buffer.from(payload).toString("base64url")}.${sig.toString("base64url")}`;
}

export function verifyUploadToken(token: string, secret: string, nowMs: number): UploadClaim | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const payload = Buffer.from(parts[0], "base64url").toString("utf8");
  const expected = crypto.createHmac("sha256", secret).update(payload).digest();
  const given = Buffer.from(parts[1], "base64url");
  // timingSafeEqual падает на разной длине, а не возвращает false.
  if (given.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(given, expected)) return null;

  const [chatRaw, messageRaw, expiresRaw] = payload.split(".");
  const chatId = Number(chatRaw);
  const messageId = Number(messageRaw);
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(chatId) || !Number.isFinite(messageId) || !Number.isFinite(expiresAt)) return null;
  if (nowMs > expiresAt) return null;
  return { chatId, messageId };
}
