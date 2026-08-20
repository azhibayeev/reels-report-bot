import { HookPosition, DEFAULT_POSITION } from "./types";

export interface RenderSpec {
  sourcePath: string;
  /** PNG во весь кадр с уже нарисованным хуком: накладывается фильтром overlay. */
  overlayPath?: string;
  textPaths: string[];
  outPath: string;
  fontPath: string;
  hookLines: string[];
  hasAudio: boolean;
  position?: HookPosition;
  /** Дорожка на весь ролик; задана — заменяет звук подложки, зациклившись. */
  musicPath?: string | null;
  /** Длина ролика в секундах; не задана — REEL_SECONDS. */
  seconds?: number;
  /** Кегль хука: подбирается под длину, не задан — базовый. */
  fontSize?: number;
}

export type Runner = (bin: string, args: string[]) => Promise<{ code: number; stderr: string }>;

export interface RenderDeps {
  runner: Runner;
  writeText: (path: string, text: string) => Promise<void>;
  ffmpegPath: string;
  // Проверяем ДО запуска ffmpeg: при нечитаемом файле шрифта drawtext ругается
  // "Either text, a valid file, a timecode or text source must be provided" —
  // жалуется на текст, хотя виноват шрифт, и такая диагностика стоила часов.
  fontReadable: (path: string) => Promise<boolean>;
}

// line_spacing на однострочный drawtext не влияет — держим его в стиле, чтобы
// строка стиля совпадала с задокументированной, а число берём и в арифметике y.
const LINE_SPACING = 10;
const FONT_SIZE = 54;
// expansion=none обязателен: по умолчанию drawtext раскрывает %{...} и в тексте
// из textfile — «100% gratis» роняет ffmpeg ошибкой "Stray % near ' gratis'".
function style(fontSize: number): string {
  return `fontsize=${fontSize}:fontcolor=white:borderw=3:bordercolor=black:shadowcolor=black@0.5:shadowx=2:shadowy=3:line_spacing=${LINE_SPACING}:expansion=none`;
}

const POSITION_Y: Record<HookPosition, number> = { top: 0.18, center: 0.42, bottom: 0.62 };

// Все ролики одной длины: формат из эталона заказчика, короткий ролик успевает
// прокрутиться несколько раз, пока человек читает описание.
export const REEL_SECONDS = 7;
// Музыку приглушаем: дорожка из ролика-эталона на полной громкости перекрывает всё.
const MUSIC_VOLUME = 0.5;
const FADE_SECONDS = 0.6;

const ENCODE = [
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "23",
  "-pix_fmt",
  "yuv420p",
  "-r",
  "30",
  "-c:a",
  "aac",
  "-b:a",
  "128k",
  "-movflags",
  "+faststart",
];

export function ffmpegArgs(spec: RenderSpec): string[] {
  const seconds = spec.seconds ?? REEL_SECONDS;
  const fadeStart = Math.max(0, seconds - FADE_SECONDS);

  // Видео зацикливаем на входе: подложка короче нужной длины иначе оборвала бы
  // ролик, а -t ниже всё равно режет по выбранной длительности.
  const inputs = ["-stream_loop", "-1", "-i", spec.sourcePath];
  const chains: string[] = [`[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[bg]`];
  let videoLabel = "[bg]";
  let nextInput = 1;

  // Хук — это PNG поверх кадра, а не drawtext: в линуксовой сборке
  // ffmpeg-static drawtext отсутствует (диагностика на проде: drawtext=false),
  // а overlay есть в любой сборке.
  if (spec.overlayPath) {
    inputs.push("-i", spec.overlayPath);
    chains.push(`[bg][${nextInput}:v]overlay=0:0[v]`);
    videoLabel = "[v]";
    nextInput += 1;
  }

  const maps = ["-map", videoLabel];
  const audioArgs: string[] = [];

  if (spec.musicPath) {
    inputs.push("-i", spec.musicPath);
    // Музыку зацикливаем фильтром aloop, а НЕ вторым -stream_loop: на аудиовходе
    // -stream_loop с конечным -t уводит ffmpeg в бесконечный цикл — проверено.
    chains.push(
      `[${nextInput}:a]aloop=loop=-1:size=2147483647,atrim=duration=${seconds},volume=${MUSIC_VOLUME},afade=t=out:st=${fadeStart}:d=${FADE_SECONDS}[a]`
    );
    maps.push("-map", "[a]");
    nextInput += 1;
  } else if (spec.hasAudio) {
    maps.push("-map", "0:a:0?");
  } else {
    inputs.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
    maps.push("-map", `${nextInput}:a`);
    nextInput += 1;
  }

  return [
    "-y",
    ...inputs,
    "-filter_complex",
    chains.join(";"),
    ...maps,
    ...ENCODE,
    "-t",
    String(seconds),
    spec.outPath,
  ];
}

export async function renderHook(spec: RenderSpec, deps: RenderDeps): Promise<void> {
  if (!spec.overlayPath) {
    if (spec.hookLines.length !== spec.textPaths.length) {
      throw new Error(`строк хука ${spec.hookLines.length}, а файлов для текста ${spec.textPaths.length}`);
    }
    if (!(await deps.fontReadable(spec.fontPath))) {
      throw new Error(`шрифт не читается: ${spec.fontPath}`);
    }
    await Promise.all(spec.hookLines.map((line, i) => deps.writeText(spec.textPaths[i], line)));
  }
  const { code, stderr } = await deps.runner(deps.ffmpegPath, ffmpegArgs(spec));
  if (code !== 0) throw new Error(`ffmpeg вышел с кодом ${code}: ${stderr.slice(-600)}`);
}
