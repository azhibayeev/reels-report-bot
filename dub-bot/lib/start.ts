import crypto from "node:crypto";
import { head } from "@vercel/blob";
import { requireEnv } from "./config";
import { estimateCredits, formatDuration } from "./credits";
import { createDub, getSubscription } from "./elevenlabs";
import { deleteBlob, Job, saveJob } from "./jobs";
import { sendMessage } from "./telegram";
import { triggerTick } from "./tick";
import { verifyToken } from "./tokens";

// Ссылку в ElevenLabs подставляет клиент, поэтому принимаем только наш Blob:
// иначе через бота можно было бы дублировать произвольное чужое видео.
export function isOwnBlobUrl(url: string): boolean {
  return /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//.test(url);
}

export async function startDub(input: {
  token: string;
  blobUrl: string;
  durationSec: number;
}): Promise<{ jobId: string }> {
  const claim = verifyToken(input.token, requireEnv("DUB_TOKEN_SECRET"), Date.now());
  if (!claim) throw new Error("Ссылка просрочена — запроси новую через /dub");
  if (!isOwnBlobUrl(input.blobUrl)) throw new Error("Ссылка на файл не из нашего хранилища");

  // Переменные окружения читаем до подтверждения файла: их отсутствие — поломка
  // конфигурации, и падать на ней надо раньше, чем начнётся уборка за собой.
  const apiKey = requireEnv("ELEVENLABS_API_KEY");
  const botToken = requireEnv("TELEGRAM_DUB_BOT_TOKEN");

  // Проверяем, что файл действительно в нашем хранилище, а не в чужом Vercel Blob.
  try {
    await head(input.blobUrl);
  } catch {
    throw new Error("Файл не найден в нашем хранилище");
  }

  // Файл уже целиком лежит в нашем Blob, а записи о задаче ещё нет. Чистка ходит
  // только по dub/jobs/, поэтому любой отказ ниже без явного удаления оставил бы
  // 400 МБ висеть в хранилище навсегда — и на free-тарифе отказ случается чаще
  // удачного запуска.
  let created: { job: Job; tier: string };
  try {
    created = await createJob(apiKey, claim.chatId, input);
  } catch (error) {
    await deleteBlob(input.blobUrl);
    throw error;
  }

  const note = created.tier === "free" ? " Тариф free — будет водяной знак." : "";
  await sendMessage(
    botToken,
    claim.chatId,
    `Взял в работу: ${formatDuration(input.durationSec)}.${note} Пришлю готовый ролик сюда.`
  );

  try {
    await triggerTick(created.job.jobId);
  } catch (error) {
    // Задача уже сохранена, поэтому её добьёт /status. Промолчать нельзя:
    // пользователь остался бы с «взял в работу» по задаче, которая не двигается.
    console.error("triggerTick failed", created.job.jobId, error);
    await sendMessage(
      botToken,
      claim.chatId,
      "Не смог запустить опрос ElevenLabs. Отправь /status — он подхватит задачу."
    );
  }

  return { jobId: created.job.jobId };
}

// Всё, что делается после подтверждения файла и до записи задачи в Blob: любой
// отказ здесь означает осиротевший исходник, поэтому вынесено в один блок.
async function createJob(
  apiKey: string,
  chatId: number,
  input: { blobUrl: string; durationSec: number }
): Promise<{ job: Job; tier: string }> {
  const subscription = await getSubscription(apiKey);

  // При неизвестной длительности оценка равна нулю — проверку пропускаем,
  // ограничение всё равно применит сам ElevenLabs.
  const needed = estimateCredits(input.durationSec);
  if (needed > subscription.remaining) {
    throw new Error(
      `Нужно ${needed} кредитов на ${formatDuration(input.durationSec)}, а осталось ${subscription.remaining}`
    );
  }

  const jobId = crypto.randomUUID();
  const dubbingId = await createDub(apiKey, {
    sourceUrl: input.blobUrl,
    watermark: subscription.tier === "free",
    name: jobId,
  });

  const job: Job = {
    jobId,
    chatId,
    dubbingId,
    sourceUrl: input.blobUrl,
    resultUrl: null,
    status: "dubbing",
    durationSec: input.durationSec,
    createdAt: new Date().toISOString(),
    error: null,
  };
  await saveJob(job);
  return { job, tier: subscription.tier };
}
