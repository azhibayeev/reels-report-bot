import { del, put } from "@vercel/blob";
import { listAllBlobs } from "../farm/store";
import { PENDING_PREFIX, PENDING_TTL_MS } from "./pending";
import { OUT_PREFIX, SOURCES_PREFIX } from "./uploads";

// Исходник нужен ElevenLabs только в момент создания дубляжа — дальше это мусор.
// Час с лишним запаса поверх 40-минутного дедлайна задачи, и можно чистить.
export const SOURCE_TTL_MS = 2 * 60 * 60 * 1000;
// Дубляж, не влезший в 50 МБ Telegram, отдаётся ссылкой: двое суток на то,
// чтобы человек её открыл, — и хватит.
export const RESULT_TTL_MS = 48 * 60 * 60 * 1000;

/** Удаление — всегда попутное дело: сорвалось оно или нет, задача уже закрыта. */
export async function deleteBlobQuiet(url: string | undefined): Promise<void> {
  if (!url) return;
  await del(url).catch(() => {});
}

/** Дубляж тяжелее 50 МБ: Telegram его не примет, но выбрасывать готовое глупо. */
export async function putResult(pathname: string, video: Buffer, contentType: string): Promise<string> {
  const blob = await put(pathname, video, {
    access: "public",
    contentType,
    addRandomSuffix: true,
    multipart: true,
  });
  return blob.url;
}

/**
 * Уборка за задачами, которые не дошли до конца: ElevenLabs отказал на создании —
 * и залитый ролик остался в Blob навсегда, потому что удалять его стало некому.
 * keep — ссылки живых задач: их трогать нельзя, дубляж ещё идёт.
 */
export async function sweepStaleBlobs(keep: Set<string>, nowMs: number): Promise<number> {
  let removed = 0;
  for (const [prefix, ttl] of [
    [SOURCES_PREFIX, SOURCE_TTL_MS],
    [OUT_PREFIX, RESULT_TTL_MS],
    // Записи, на кнопки которых так и не нажали: без них ролик всё равно никуда
    // не поедет, а кнопки в чате честно ответят «уже не жду».
    [PENDING_PREFIX, PENDING_TTL_MS],
  ] as const) {
    for (const blob of await listAllBlobs(prefix)) {
      if (keep.has(blob.url)) continue;
      if (nowMs - blob.uploadedAt.getTime() < ttl) continue;
      await del(blob.url).catch(() => {});
      removed++;
    }
  }
  return removed;
}
