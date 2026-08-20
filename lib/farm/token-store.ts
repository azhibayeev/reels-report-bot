import { list, put } from "@vercel/blob";
import { decryptSecret, encryptSecret } from "../storage";

/**
 * Хранилище ключа публикации.
 *
 * Переменную окружения функция Vercel записать не может, а обмен на бессрочный
 * токен делает именно она — значит результат надо где-то держать. Держим в
 * Blob, но только шифртекстом: blob-URL публичный, ключ шифрования выводится
 * из CRON_SECRET и живёт лишь в переменных окружения.
 */
export const FARM_TOKEN_PATH = "farm/state/ig-token.enc";

export async function saveFarmToken(token: string): Promise<void> {
  await put(FARM_TOKEN_PATH, encryptSecret(token), {
    access: "public",
    contentType: "text/plain",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

export async function loadFarmToken(): Promise<string | null> {
  const { blobs } = await list({ prefix: FARM_TOKEN_PATH });
  const blob = blobs.find((b) => b.pathname === FARM_TOKEN_PATH);
  if (!blob) return null;
  const res = await fetch(`${blob.url}?ts=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  return decryptSecret(await res.text());
}

/**
 * Сохранённый ключ важнее переменной окружения: он новее по определению —
 * его положили командой, а env остаётся тем, с чего начинали. Обратный
 * порядок означал бы, что после настройки через бота заливка продолжает
 * ходить со старым ключом из переменных, и починка не имеет эффекта.
 */
export async function resolveFarmToken(): Promise<string> {
  const stored = await loadFarmToken();
  if (stored) return stored;
  const env = process.env.FARM_IG_TOKEN;
  if (env) return env;
  throw new Error("Ключ публикации не задан: пришлите его командой /token set <ключ>");
}
