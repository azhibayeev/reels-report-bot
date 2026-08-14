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
// Доставке нужен собственный бюджет, а не хвост чужого: скачать результат из
// ElevenLabs, перелить его в Blob и выгрузить 50 МБ в Telegram за остаток
// вызова нереально, а оборванная на середине доставка оставляет задачу
// помеченной «delivering». Поэтому начинаем её только с таким запасом.
export const DELIVERY_RESERVE_MS = 120_000;
// Ни один вызов функции не живёт дольше 300 с (maxDuration роута), значит
// доставка с более старой отметкой точно мертва — её можно перехватить, а
// живую этот порог перехватить не даст никогда.
export const DELIVERY_TAKEOVER_MS = 300_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Роут возвращает 202 сразу, поэтому вызов дешёвый: он лишь запускает
// следующее звено цепочки опроса.
export async function triggerTick(jobId: string): Promise<void> {
  const key = tickKey(jobId, requireEnv("DUB_TOKEN_SECRET"));
  const url = `${baseUrl()}/api/dub/tick?job=${encodeURIComponent(jobId)}&key=${key}`;
  const res = await fetch(url, { method: "POST", cache: "no-store" });
  // fetch не падает на 4xx/5xx: кривой DUB_BASE_URL (404), чужой ключ (403) или
  // защита деплоя (401) без этой проверки выглядели бы как успех, а цепочка
  // опроса при этом молча умирала бы.
  if (!res.ok) throw new Error(`Не удалось запустить опрос: /api/dub/tick вернул ${res.status}`);
}

async function failJob(job: Job, message: string): Promise<void> {
  await sendMessage(requireEnv("TELEGRAM_DUB_BOT_TOKEN"), job.chatId, message);
  await saveJob({ ...job, status: "failed", error: message });
}

// Отметки может не быть вовсе — у задач, сохранённых до появления поля, или
// если запись «delivering» прошла старым кодом. Такую доставку считаем начатой
// неизвестно когда, то есть брошенной: иначе задача застряла бы в «delivering»
// навсегда, потому что выхода вперёд у этого статуса нет.
export function isAbandonedDelivery(job: Job, nowMs: number): boolean {
  if (!job.deliveringAt) return true;
  const startedAt = Date.parse(job.deliveringAt);
  if (Number.isNaN(startedAt)) return true;
  return nowMs - startedAt > DELIVERY_TAKEOVER_MS;
}

async function deliver(job: Job): Promise<void> {
  const apiKey = requireEnv("ELEVENLABS_API_KEY");
  const botToken = requireEnv("TELEGRAM_DUB_BOT_TOKEN");

  // Это НЕ блокировка: в Blob нет compare-and-set, две цепочки всё ещё могут
  // проскочить обе. Но /status пинает tick по каждой активной задаче, и без
  // перечитывания статуса окно двойной отправки равнялось бы шагу опроса (~10 с);
  // с ранней отметкой «delivering» оно сжимается до ~1 с — времени между этим
  // чтением и записью ниже. Вторая половина правила — перехват: доставка,
  // начатая дольше DELIVERY_TAKEOVER_MS назад, не могла пережить свой вызов,
  // и отдать ролик заново лучше, чем не отдать вовсе. На «done» и «failed»
  // выходим сразу: там результат уже решён.
  const fresh = await loadJob(job.jobId);
  if (!fresh) return;
  const takeover = fresh.status === "delivering" && isAbandonedDelivery(fresh, Date.now());
  if (fresh.status !== "dubbing" && !takeover) return;
  await saveJob({ ...fresh, status: "delivering", deliveringAt: new Date().toISOString() });

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
      await sendVideoByUrl(botToken, fresh.chatId, result.url, caption);
      break;
    case "upload": {
      const res = await fetch(result.url, { cache: "no-store" });
      const bytes = new Uint8Array(await res.arrayBuffer());
      await sendVideoUpload(botToken, fresh.chatId, bytes, `${fresh.jobId}.mp4`, caption);
      break;
    }
    case "link": {
      const mb = Math.round(size / 1024 / 1024);
      await sendMessage(
        botToken,
        fresh.chatId,
        `${caption}. Файл ${mb} МБ — это больше лимита Telegram, забирай по ссылке:\n${result.url}`
      );
      break;
    }
  }

  await deleteBlob(fresh.sourceUrl);
  await saveJob({ ...fresh, status: "done", resultUrl: result.url, deliveringAt: null });
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
      // Доставку начинаем только с полным запасом времени. Иначе она упрётся в
      // лимит функции уже с записанной отметкой «delivering» — а раньше такой
      // обрыв лечился сам собой, следующим тиком.
      if (INVOCATION_BUDGET_MS - (Date.now() - startedAt) < DELIVERY_RESERVE_MS) {
        try {
          await triggerTick(jobId);
        } catch (error) {
          console.error("triggerTick failed", jobId, error);
        }
        return;
      }
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
