import crypto from "node:crypto";
import { head } from "@vercel/blob";
import { requireEnv } from "./config";
import { deleteBlob, Job, saveJob } from "./jobs";
import { verifyToken } from "./tokens";

// Ссылку подставляет клиент, поэтому принимаем только наш Blob: иначе через
// бота можно было бы скормить обработке произвольное чужое видео.
export function isOwnBlobUrl(url: string): boolean {
  return /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//.test(url);
}

// Создаёт задачу после того, как файл уже целиком загружен в наш Blob.
// Дальнейшую обработку (распознавание, перевод, вшивание субтитров) заводит
// более поздняя задача — здесь только проверка токена и заявка на работу.
export async function startJob(input: {
  token: string;
  blobUrl: string;
  durationSec: number;
}): Promise<{ jobId: string }> {
  const claim = verifyToken(input.token, requireEnv("SUB_TOKEN_SECRET"), Date.now());
  if (!claim) throw new Error("Ссылка просрочена — запроси новую через /sub");
  if (!isOwnBlobUrl(input.blobUrl)) throw new Error("Ссылка на файл не из нашего хранилища");

  // Проверяем, что файл действительно в нашем хранилище, а не в чужом Vercel Blob.
  try {
    await head(input.blobUrl);
  } catch {
    throw new Error("Файл не найден в нашем хранилище");
  }

  const job: Job = {
    jobId: crypto.randomUUID(),
    chatId: claim.chatId,
    sourceUrl: input.blobUrl,
    resultUrl: null,
    status: "pending",
    durationSec: input.durationSec,
    deliveringAt: null,
    createdAt: new Date().toISOString(),
    error: null,
  };

  // Файл уже целиком лежит в нашем Blob, а записи о задаче ещё нет. Чистка
  // ходит только по sub/jobs/, поэтому неудачное сохранение оставило бы файл
  // висеть в хранилище навсегда — удалить его тогда некому, кроме нас здесь.
  try {
    await saveJob(job);
  } catch (error) {
    await deleteBlob(input.blobUrl);
    throw error;
  }

  return { jobId: job.jobId };
}
