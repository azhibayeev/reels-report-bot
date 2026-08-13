import crypto from "node:crypto";
import { requireEnv } from "./config";
import { estimateCredits, formatDuration } from "./credits";
import { createDub, getSubscription } from "./elevenlabs";
import { Job, saveJob } from "./jobs";
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

  const apiKey = requireEnv("ELEVENLABS_API_KEY");
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
    chatId: claim.chatId,
    dubbingId,
    sourceUrl: input.blobUrl,
    resultUrl: null,
    status: "dubbing",
    durationSec: input.durationSec,
    createdAt: new Date().toISOString(),
    error: null,
  };
  await saveJob(job);

  const note = subscription.tier === "free" ? " Тариф free — будет водяной знак." : "";
  await sendMessage(
    requireEnv("TELEGRAM_DUB_BOT_TOKEN"),
    claim.chatId,
    `Взял в работу: ${formatDuration(input.durationSec)}.${note} Пришлю готовый ролик сюда.`
  );

  await triggerTick(jobId);
  return { jobId };
}
