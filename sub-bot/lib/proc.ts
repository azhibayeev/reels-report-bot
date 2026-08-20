import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export interface RunResult {
  code: number | null;
  stderr: string;
  stdout: string;
}

export type Runner = (bin: string, args: string[]) => Promise<RunResult>;

// Хвост stderr режем, а не копим целиком: ffmpeg на ошибке может насыпать
// мегабайты диагностики построчно на каждый кадр — ни в тексте исключения,
// ни в памяти процесса это не нужно.
const STDERR_CAP = 8000;

export interface Collector {
  /** Скормить очередной чанк из потока данных процесса. */
  push(chunk: Buffer): void;
  /** Отдать накопленную строку после закрытия потока. */
  finish(): string;
}

// Поток `data` рвёт вывод процесса на чанки границами буфера, а не границами
// символа: многобайтовая UTF-8 последовательность (кириллица, например) может
// оказаться разрезана ровно между байтами на стыке двух чанков. Наивное
// `String(chunk)` на каждом чанке декодирует половинки независимо и превращает
// разрезанный символ в замену "�" — испорченный текст уходит дальше, вплоть до
// сообщения об ошибке в чате бота, если это stderr. StringDecoder держит
// незавершённый хвост UTF-8-последовательности между вызовами write() и
// не отдаёт его наружу, пока следующий чанк не докомплектует символ.
export function createCollector(cap: number | null = null): Collector {
  const decoder = new StringDecoder("utf8");
  let acc = "";
  return {
    push(chunk) {
      acc += decoder.write(chunk);
      // Обрезка — уже по декодированным символам (JS string), а не по байтам:
      // резать после декодирования означает никогда не резать посередине
      // многобайтовой последовательности.
      if (cap !== null) acc = acc.slice(-cap);
    },
    finish() {
      acc += decoder.end();
      if (cap !== null) acc = acc.slice(-cap);
      return acc;
    },
  };
}

// Общий низкоуровневый раннер процесса: он нужен и lib/probe.ts (самопроверка
// окружения), и lib/render.ts / lib/media.ts (запуск ffmpeg и ffprobe) —
// логика запуска и накопления вывода у них была дословно одинаковой, поэтому
// вынесена сюда одним модулем вместо нескольких копий одного и того же spawn.
// Сам spawn — тонкая обёртка; разбор потоков (createCollector) — отдельная
// чистая функция и тестируется без реального процесса.
export const spawnRunner: Runner = (bin, args) =>
  new Promise((resolve) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = createCollector();
    const stderr = createCollector(STDERR_CAP);
    p.stdout.on("data", (d) => stdout.push(d as Buffer));
    p.stderr.on("data", (d) => stderr.push(d as Buffer));
    p.on("close", (code) => resolve({ code, stderr: stderr.finish(), stdout: stdout.finish() }));
    p.on("error", (e) => resolve({ code: null, stderr: String(e), stdout: "" }));
  });
