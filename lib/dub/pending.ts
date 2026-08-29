import { del, put } from "@vercel/blob";
import { listAllBlobs } from "../farm/store";

export const PENDING_PREFIX = "dub/pending/";

/**
 * Ролик, по которому задан вопрос про субтитры, но ответа ещё нет. Держать его
 * в callback_data нельзя: там 64 байта, а один file_id Telegram длиннее.
 */
export interface PendingDub {
  jobId: string;
  chatId: number;
  messageId: number;
  /** Сообщение с вопросом: оно же станет строкой статуса после ответа. */
  askMessageId: number;
  filename: string;
  /** Файл в Telegram — качаем его только после ответа, чтобы не тянуть зря. */
  fileId?: string;
  /** Или ссылка: ролик со страницы загрузки либо присланная человеком. */
  sourceUrl?: string;
  /** Из ссылок — только наша: остальные удалять нечего и незачем. */
  blobUrl?: string;
  width?: number;
  height?: number;
  duration?: number;
  createdAt: string;
}

// Ответа нет два часа — значит и не будет. Тот же срок, что у исходников в Blob:
// уборка снимает их одним проходом.
export const PENDING_TTL_MS = 2 * 60 * 60 * 1000;

export function pendingPath(jobId: string): string {
  return `${PENDING_PREFIX}${jobId}.json`;
}

export async function savePending(pending: PendingDub): Promise<void> {
  await put(pendingPath(pending.jobId), JSON.stringify(pending), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

export async function deletePending(jobId: string): Promise<void> {
  await del(pendingPath(jobId)).catch(() => {});
}

// Blob кэшируется на CDN, поэтому читаем с cache-busting: иначе нажатие сразу
// после вопроса увидело бы пустоту вместо только что записанной строки.
export async function loadPending(jobId: string): Promise<PendingDub | null> {
  const wanted = pendingPath(jobId);
  const blob = (await listAllBlobs(PENDING_PREFIX)).find((b) => b.pathname === wanted);
  if (!blob) return null;
  const res = await fetch(`${blob.url}?ts=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as PendingDub;
}
