import { Job } from "./jobs";
import { Cue, Word, buildCues } from "./cues";
import { MAX_DURATION_SEC } from "./media";

// Зависимости идут параметром, а не импортом внутри функции: оркестрация
// здесь чистая и тестируется без сети и без спавна ffprobe/ffmpeg. Связывание
// с настоящими lib/media.ts, lib/scribe.ts, lib/translate.ts и lib/storage.ts
// живёт в app/api/sub/start/route.ts.
export interface PipelineDeps {
  probe: (path: string) => Promise<{ durationSec: number; hasAudio: boolean }>;
  download: (url: string) => Promise<string>;
  transcribe: (sourceUrl: string) => Promise<Word[]>;
  translate: (cues: Cue[]) => Promise<Cue[]>;
  save: (job: Job) => Promise<void>;
}

async function fail(deps: PipelineDeps, job: Job, error: string): Promise<Job> {
  const out: Job = { ...job, status: "failed", error };
  await deps.save(out);
  return out;
}

// Ведёт задачу от загруженного в Blob исходника до статуса "awaiting" —
// текста, готового на утверждение человеком в чате. Любая ошибка внутри
// (сеть, распознавание, перевод) превращается в статус "failed" с понятным
// русским текстом, а не роняет вызов — конвейер запускается фоново из
// after(), и уронить его здесь означает потерять уведомление в чате.
export async function runPipeline(deps: PipelineDeps, job: Job): Promise<Job> {
  // current — последнее успешно сохранённое состояние задачи. Если исключение
  // прилетит уже после сохранения статуса "translating" (например, упал
  // переводчик), catch должен пометить failed именно его — с уже нарезанными
  // репликами и настоящей длительностью, — а не исходную пустую задачу:
  // иначе отказ стирал бы из финальной записи то, докуда дошёл конвейер.
  let current = job;
  try {
    const localPath = await deps.download(current.sourceUrl);
    const info = await deps.probe(localPath);

    // Порядок важен: длительность и звук проверяются ДО распознавания речи —
    // отказ здесь стоит одного локального вызова ffprobe, а не оплаченного
    // обращения к Scribe. Потолок MAX_DURATION_SEC = 61.0, не 60.0: см.
    // комментарий в lib/media.ts — телефонные экспорты «минутного» ролика
    // сплошь дают 60.03–60.5 с.
    if (info.durationSec > MAX_DURATION_SEC) {
      return fail(
        deps,
        current,
        `ролик ${info.durationSec.toFixed(1)} с, а потолок ${MAX_DURATION_SEC} с`
      );
    }
    if (!info.hasAudio) {
      return fail(deps, current, "в ролике нет звуковой дорожки — нечего распознавать");
    }

    const words = await deps.transcribe(current.sourceUrl);
    if (words.length === 0) {
      return fail(deps, current, "речь не распозналась — возможно, в ролике только музыка");
    }

    const cues = buildCues(words);
    if (cues.length === 0) {
      return fail(deps, current, "речь не распозналась — реплик не получилось");
    }

    current = { ...current, status: "translating", durationSec: info.durationSec, cues };
    await deps.save(current);

    const translated = await deps.translate(cues);
    current = { ...current, status: "awaiting", cues: translated };
    await deps.save(current);
    return current;
  } catch (e) {
    return fail(deps, current, e instanceof Error ? e.message : String(e));
  }
}
