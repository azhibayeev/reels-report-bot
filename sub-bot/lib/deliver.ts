import { buildAss } from "./ass";
import { blockingWarnings } from "./commands";
import { Job } from "./jobs";

const MB = 1024 * 1024;

// Telegram скачивает по ссылке до 20 МБ и принимает загрузку до 50 МБ.
// Три ветки, а не две, именно поэтому.
export function pickDelivery(sizeBytes: number): "link" | "multipart" | "blob" {
  if (sizeBytes <= 20 * MB) return "link";
  if (sizeBytes <= 50 * MB) return "multipart";
  return "blob";
}

export interface RenderDeps {
  /** Качает исходник во временный каталог, отдаёт путь к локальной копии. */
  download: (url: string) => Promise<string>;
  /** Вшивает субтитры (ffmpeg), возвращает путь к готовому файлу. */
  render: (srcPath: string, ass: string, fontFamily: string) => Promise<string>;
  /** Заливает готовый файл в постоянное хранилище, отдаёт публичную ссылку. */
  upload: (path: string, jobId: string) => Promise<string>;
  /** Размер файла на диске в байтах — решает, какой веткой доставки идти. */
  size: (path: string) => Promise<number>;
  /** Доставляет результат в чат: ссылкой, файлом или ссылкой на Blob. */
  deliver: (job: Job, url: string, mode: "link" | "multipart" | "blob") => Promise<void>;
  save: (job: Job) => Promise<void>;
  /** Убирает временный каталог. Вызывается в finally на любом исходе. */
  cleanup: () => Promise<void>;
  /**
   * Имя семейства шрифта — берётся во время выполнения из name-таблицы TTF
   * (lib/probe.ts, fontFamily()), а не зашивается строкой: оно обязано
   * совпасть с тем, что libass найдёт в fontsdir, иначе кадр выйдет без
   * текста при успешном коде возврата ffmpeg.
   */
  fontFamily: string;
}

// Сохраняет задачу со статусом "failed" и возвращает её вызывающему коду —
// не бросая, даже если само сохранение отказа тоже не удалось (тот же
// приём, что fail() в lib/pipeline.ts: конвейер запускается фоново из
// after(), и уронить его здесь означает не только потерять запись в Blob,
// но и не дать роуту отправить пользователю сообщение об ошибке).
async function fail(deps: RenderDeps, job: Job, error: string): Promise<Job> {
  const out: Job = { ...job, status: "failed", error };
  try {
    await deps.save(out);
  } catch (saveError) {
    console.error("deliver: не удалось сохранить статус failed", job.jobId, saveError);
  }
  return out;
}

// Ведёт утверждённую задачу от "awaiting" до "done" (или "failed"):
// собирает .ass, вшивает субтитры через ffmpeg, заливает результат и
// доставляет его в чат подходящей веткой. Зависимости идут параметром —
// оркестрация тестируется без сети и без спавна ffmpeg; связывание с
// настоящими lib/render.ts, lib/storage.ts, lib/telegram.ts и Blob живёт в
// app/api/sub/render/route.ts.
export async function runRender(deps: RenderDeps, job: Job): Promise<Job> {
  // Задача уже не ждёт рендера (или уже рендерится/доставляется/готова) —
  // повторный /ok не должен запустить обработку второй раз.
  if (job.status !== "awaiting") return job;

  // Аяты и дуа ждут ручного текста: реплика с блокирующим предупреждением
  // не должна попасть в вшитое видео машинным переводом. Рендер не
  // запускается вообще, задача остаётся в "awaiting".
  const blocking = blockingWarnings(job.cues);
  if (blocking.length > 0) return job;

  // current — последнее успешно собранное (не обязательно успешно
  // сохранённое) состояние задачи. Переход в "rendering" — ПЕРВОЕ
  // сохранение — нарочно внутри общего try/catch, а не перед ним: сбой
  // записи здесь (Blob моргнул ровно на /ok) раньше вылетал из runRender
  // необработанным исключением, роут в after() ловил его только в
  // console.error и не отправлял в чат ничего — пользователь получал 202 и
  // тишину до суточного дедлайна "awaiting".
  let current: Job = job;
  try {
    current = { ...current, status: "rendering" };
    await deps.save(current);

    const src = await deps.download(current.sourceUrl);
    const ass = buildAss(current.cues, deps.fontFamily);
    const outPath = await deps.render(src, ass, deps.fontFamily);
    const size = await deps.size(outPath);
    const url = await deps.upload(outPath, current.jobId);

    current = {
      ...current,
      status: "delivering",
      deliveringAt: new Date().toISOString(),
      resultUrl: url,
    };
    await deps.save(current);

    await deps.deliver(current, url, pickDelivery(size));

    current = { ...current, status: "done", deliveringAt: null };
    await deps.save(current);
    return current;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Результат уже залит (resultUrl проставлен), а упало что-то после —
    // скорее всего сама доставка в Telegram. Заставлять пользователя гонять
    // минуту рендера заново из-за чисто сетевого сбоя отправки не за чем:
    // ссылка на готовый файл идёт в текст ошибки с тем же сроком жизни, что
    // уже обещан ветке "больше 50 МБ" (сутки, до плановой уборки).
    const withHint = current.resultUrl
      ? `${message}\n\nРолик уже готов, забери по ссылке (живёт сутки): ${current.resultUrl}`
      : message;
    return await fail(deps, current, withHint);
  } finally {
    // /tmp на функции — 500 МБ на всё. Каталог убирается на любом исходе, а
    // не только на успехе.
    await deps.cleanup();
  }
}
