import crypto from "node:crypto";
import { list, put } from "@vercel/blob";
import { AccountConfig } from "./accounts";
import { Snapshot } from "./types";

const dateKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function jakartaDateKey(d: Date): string {
  return dateKeyFmt.format(d); // en-CA => YYYY-MM-DD
}

/**
 * День суточного спринта, в который попадает момент `d`. Сутки отчёта идут от 12:30
 * Джакарты до 12:30 следующего дня и называются днём ЗАВЕРШЕНИЯ — тем же, каким
 * помечен снапшот, снятый в 12:30. Сдвиг на 11:30 переносит момент в этот день:
 * 25.08 20:00 → 26.08. Ровно тот же приём, что в HogQL у заходов (+690 минут), —
 * иначе события и просмотры разъедутся по разным суткам.
 */
export function sprintDateKey(d: Date): string {
  return jakartaDateKey(new Date(d.getTime() + 690 * 60_000));
}

/** Последние `count` дней Джакарты, заканчивая днём `now`, по возрастанию. */
export function lastDayKeys(now: Date, count: number): string[] {
  const out: string[] = [];
  // Сутки Джакарты ровно по 24 часа (UTC+7 без перевода стрелок) — шаг не соскользнёт.
  for (let i = count - 1; i >= 0; i--) out.push(jakartaDateKey(new Date(now.getTime() - i * 86_400_000)));
  return out;
}

export async function saveSnapshot(key: string, snap: Snapshot, acc: AccountConfig): Promise<void> {
  await put(`${acc.snapshotPrefix}${key}.json`, JSON.stringify(snap), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function loadPreviousSnapshot(todayKey: string, acc: AccountConfig): Promise<Snapshot | null> {
  const { blobs } = await list({ prefix: acc.snapshotPrefix });
  const prev = blobs
    .filter((b) => b.pathname < `${acc.snapshotPrefix}${todayKey}.json`)
    .sort((a, b) => (a.pathname < b.pathname ? 1 : -1))[0];
  if (!prev) return null;
  const res = await fetch(`${prev.url}?ts=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as Snapshot;
}

// Последние `limit` снапшотов по возрастанию даты (для рядов динамики).
export async function loadRecentSnapshots(limit: number, acc: AccountConfig): Promise<Snapshot[]> {
  const { blobs } = await list({ prefix: acc.snapshotPrefix });
  const recent = blobs
    .sort((a, b) => (a.pathname < b.pathname ? -1 : 1)) // по возрастанию даты в имени
    .slice(-limit);
  const snaps: Snapshot[] = [];
  for (const b of recent) {
    const res = await fetch(`${b.url}?ts=${Date.now()}`, { cache: "no-store" });
    if (res.ok) snaps.push((await res.json()) as Snapshot);
  }
  return snaps;
}

const LAST_REPORT_PATH = "state/last-report.json";

// Ключ дня, за который отчёт уже отправлен, — защита от дублей,
// когда срабатывают и внешний планировщик, и запасной крон Vercel.
export async function saveLastReportKey(key: string): Promise<void> {
  await put(LAST_REPORT_PATH, JSON.stringify({ key }), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

export async function loadLastReportKey(): Promise<string | null> {
  const { blobs } = await list({ prefix: LAST_REPORT_PATH });
  const blob = blobs.find((b) => b.pathname === LAST_REPORT_PATH);
  if (!blob) return null;
  const res = await fetch(`${blob.url}?ts=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  try {
    return ((await res.json()) as { key?: string }).key ?? null;
  } catch {
    return null;
  }
}

// Длительность ролика не меняется, а достаётся дорого (Range-запрос к CDN на каждый
// рилс). Поэтому держим кэш id → секунды и щупаем только новые ролики.
export async function loadDurations(acc: AccountConfig): Promise<Record<string, number>> {
  const { blobs } = await list({ prefix: acc.durationsPath });
  const blob = blobs.find((b) => b.pathname === acc.durationsPath);
  if (!blob) return {};
  const res = await fetch(`${blob.url}?ts=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return {};
  try {
    return (await res.json()) as Record<string, number>;
  } catch {
    return {};
  }
}

export async function saveDurations(map: Record<string, number>, acc: AccountConfig): Promise<void> {
  await put(acc.durationsPath, JSON.stringify(map), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

export interface TokenState {
  token: string;
  refreshedAt: string;
  seedHash?: string;
}

export function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

// Токен хранится в Blob в зашифрованном виде: blob-URL публичный,
// а ключ шифрования выводится из CRON_SECRET, который есть только в env.
function encryptionKey(): Buffer {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not set");
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Шифрование вынесено из saveTokenState/loadTokenState, чтобы им мог
 * пользоваться и токен фермы: у него своя схема получения (обмен на токен
 * Страницы), но требование то же — в публичный Blob класть только шифртекст.
 * Своя вторая реализация тут была бы лишним местом для ошибки.
 */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

/** Возвращает null на любой порче: битый шифртекст — это «нет значения». */
export function decryptSecret(payload: string): string | null {
  try {
    const buf = Buffer.from(payload, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export async function saveTokenState(state: TokenState, acc: AccountConfig): Promise<void> {
  const payload = encryptSecret(JSON.stringify(state));
  await put(acc.tokenPath, payload, {
    access: "public",
    contentType: "text/plain",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

export async function loadTokenState(acc: AccountConfig): Promise<TokenState | null> {
  const { blobs } = await list({ prefix: acc.tokenPath });
  const blob = blobs.find((b) => b.pathname === acc.tokenPath);
  if (!blob) return null;
  const res = await fetch(`${blob.url}?ts=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  try {
    const buf = Buffer.from(await res.text(), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
    return JSON.parse(json) as TokenState;
  } catch {
    return null;
  }
}
