import { ffmpegPath } from "./binaries";
import { assEscape } from "./escape";
import { spawnRunner, type Runner, type RunResult } from "./proc";

// Раннер и его тип живут в lib/proc.ts (общий с lib/probe.ts) — здесь их
// только реэкспортируем, чтобы остальной код (lib/media.ts, Task 7) мог
// брать Runner прямо отсюда, как задумано интерфейсом модуля.
export type { Runner, RunResult };
export { spawnRunner };

export interface RenderOpts {
  srcPath: string;
  assPath: string;
  fontsDir: string;
  outPath: string;
  preset: "veryfast" | "ultrafast";
}

// Хвост stderr в тексте исключения — чтобы причина падения ffmpeg была видна
// в сообщении боту, а не только в логах.
const STDERR_TAIL = 600;

export function renderArgs(o: RenderOpts): string[] {
  // Внутри subtitles= двоеточие разделяет опции фильтра, а обратный слэш
  // экранирует — оба пути (.ass и папка со шрифтами) обязаны пройти
  // assEscape, иначе путь вроде /tmp/x:y/cues.ass разъедет фильтр на два
  // аргумента и ffmpeg упадёт с невнятной ошибкой парсинга.
  const vf = `subtitles=${assEscape(o.assPath)}:fontsdir=${assEscape(o.fontsDir)}`;
  return [
    "-y",
    "-i", o.srcPath,
    "-vf", vf,
    "-c:v", "libx264",
    "-preset", o.preset,
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    // Звук не трогаем вовсе: перекодирование аудио стоит времени и ничего не
    // даёт — дорожка остаётся русской и без изменений.
    "-c:a", "copy",
    o.outPath,
  ];
}

export async function renderSubs(run: Runner, o: RenderOpts): Promise<void> {
  // Переопределение пути к бинарнику уже живёт в ffmpegPath() (lib/binaries.ts)
  // и читает SUB_FFMPEG_PATH — второй развилки здесь быть не должно, иначе
  // переменных станет две.
  const { code, stderr } = await run(ffmpegPath(), renderArgs(o));
  if (code !== 0) {
    throw new Error(`ffmpeg вышел с кодом ${code}: ${stderr.slice(-STDERR_TAIL)}`);
  }
}
