import { head, put } from "@vercel/blob";
import { baseUrl, requireEnv } from "./config";
import { pickDelivery } from "./credits";
import { downloadDub, getDubStatus } from "./elevenlabs";
import { deleteBlob, Job, loadJob, RESULTS_PREFIX, saveJob } from "./jobs";
import { sendMessage, sendVideoByUrl, sendVideoUpload } from "./telegram";
import { tickKey } from "./tokens";

export const POLL_INTERVAL_MS = 10_000;
// Лимит функции — 300 с. Оставляем запас на доставку результата.
export const INVOCATION_BUDGET_MS = 240_000;
// Дольше получаса ждать нечего: либо ElevenLabs завис, либо ролик неподъёмный.
export const JOB_DEADLINE_MS = 30 * 60 * 1000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Роут возвращает 202 сразу, поэтому вызов дешёвый: он лишь запускает
// следующее звено цепочки опроса.
export async function triggerTick(jobId: string): Promise<void> {
  const key = tickKey(jobId, requireEnv("DUB_TOKEN_SECRET"));
  const url = `${baseUrl()}/api/dub/tick?job=${encodeURIComponent(jobId)}&key=${key}`;
  await fetch(url, { method: "POST", cache: "no-store" });
}

async function failJob(job: Job, message: string): Promise<void> {
  await sendMessage(requireEnv("TELEGRAM_DUB_BOT_TOKEN"), job.chatId, message);
  await saveJob({ ...job, status: "failed", error: message });
}

async function deliver(job: Job): Promise<void> {
  const apiKey = requireEnv("ELEVENLABS_API_KEY");
  const botToken = requireEnv("TELEGRAM_DUB_BOT_TOKEN");

  // Тело ElevenLabs переливаем в Blob потоком: держать 100+ МБ в памяти незачем.
  const dubbed = await downloadDub(apiKey, job.dubbingId as string);
  const result = await put(`${RESULTS_PREFIX}${job.jobId}.mp4`, dubbed.body as ReadableStream, {
    access: "public",
    contentType: "video/mp4",
    addRandomSuffix: false,
    allowOverwrite: true,
    multipart: true,
  });

  const { size } = await head(result.url);
  const caption = "Готово — дубляж на индонезийском";

  switch (pickDelivery(size)) {
    case "url":
      await sendVideoByUrl(botToken, job.chatId, result.url, caption);
      break;
    case "upload": {
      const res = await fetch(result.url, { cache: "no-store" });
      const bytes = new Uint8Array(await res.arrayBuffer());
      await sendVideoUpload(botToken, job.chatId, bytes, `${job.jobId}.mp4`, caption);
      break;
    }
    case "link": {
      const mb = Math.round(size / 1024 / 1024);
      await sendMessage(
        botToken,
        job.chatId,
        `${caption}. Файл ${mb} МБ — это больше лимита Telegram, забирай по ссылке:\n${result.url}`
      );
      break;
    }
  }

  await deleteBlob(job.sourceUrl);
  await saveJob({ ...job, status: "done", resultUrl: result.url });
}

export async function runTick(jobId: string): Promise<void> {
  const job = await loadJob(jobId);
  if (!job || job.status === "done" || job.status === "failed") return;
  if (!job.dubbingId) return;

  const apiKey = requireEnv("ELEVENLABS_API_KEY");
  const startedAt = Date.now();

  while (Date.now() - startedAt < INVOCATION_BUDGET_MS) {
    if (Date.now() - Date.parse(job.createdAt) > JOB_DEADLINE_MS) {
      await failJob(job, "Дубляж не уложился в 30 минут. Попробуй ещё раз через /dub.");
      return;
    }

    let status;
    try {
      status = await getDubStatus(apiKey, job.dubbingId);
    } catch (error) {
      // Опрос ElevenLabs — штука нестабильная (сетевой сбой, временная 5xx).
      // Не роняем всю цепочку из-за одного неудачного опроса: подождём и
      // попробуем снова, а дедлайн наверху цикла всё равно ограничит попытки.
      console.error("getDubStatus failed", jobId, error);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (status.status === "failed") {
      await failJob(job, `ElevenLabs не справился: ${status.error ?? "без деталей"}`);
      return;
    }
    if (status.status === "dubbed") {
      try {
        await deliver(job);
      } catch (error) {
        // Доставка — не то, что стоит повторять само по себе: повтор рискует
        // прислать видео дважды. Сообщаем пользователю и закрываем задачу.
        await failJob(job, `Готовый ролик не удалось доставить: ${(error as Error).message}`);
      }
      return;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  // Бюджет вызова исчерпан — продлеваем цепочку новым вызовом. Если сам
  // вызов не удался, эта попытка ничего больше сделать не может — ручная
  // подстраховка на этот случай будет в /status.
  try {
    await triggerTick(jobId);
  } catch (error) {
    console.error("triggerTick failed", jobId, error);
  }
}
