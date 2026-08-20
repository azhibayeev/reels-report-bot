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

  const rendering: Job = { ...job, status: "rendering" };
  await deps.save(rendering);

  try {
    const src = await deps.download(job.sourceUrl);
    const ass = buildAss(job.cues, deps.fontFamily);
    const outPath = await deps.render(src, ass, deps.fontFamily);
    const size = await deps.size(outPath);
    const url = await deps.upload(outPath, job.jobId);

    const delivering: Job = {
      ...rendering,
      status: "delivering",
      deliveringAt: new Date().toISOString(),
      resultUrl: url,
    };
    await deps.save(delivering);

    await deps.deliver(delivering, url, pickDelivery(size));

    const done: Job = { ...delivering, status: "done", deliveringAt: null };
    await deps.save(done);
    return done;
  } catch (e) {
    const failed: Job = {
      ...rendering,
      status: "failed",
      error: e instanceof Error ? e.message : String(e),
    };
    await deps.save(failed);
    return failed;
  } finally {
    // /tmp на функции — 500 МБ на всё. Каталог убирается на любом исходе, а
    // не только на успехе.
    await deps.cleanup();
  }
}
