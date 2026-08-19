import { HookPosition, DEFAULT_POSITION } from "./types";

export interface RenderSpec {
  sourcePath: string;
  textPaths: string[];
  outPath: string;
  fontPath: string;
  hookLines: string[];
  hasAudio: boolean;
  position?: HookPosition;
  /** Дорожка на весь ролик; задана — заменяет звук подложки, зациклившись. */
  musicPath?: string | null;
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
const STYLE = `fontsize=${FONT_SIZE}:fontcolor=white:borderw=3:bordercolor=black:shadowcolor=black@0.5:shadowx=2:shadowy=3:line_spacing=${LINE_SPACING}:expansion=none`;

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
  const multiplier = POSITION_Y[spec.position ?? DEFAULT_POSITION];
  // drawtext центрирует блок текста целиком, поэтому вторая строка хука начинала
  // бы там же, где первая — по одному drawtext на строку, у каждого свой x/y.
  // text_align появился только в ffmpeg 7.0, у нас 6.0 (ffmpeg-static).
  const drawtexts = spec.hookLines.map((_, i) => {
    const offset = i * (FONT_SIZE + LINE_SPACING);
    const y = offset === 0 ? `h*${multiplier}` : `h*${multiplier}+${offset}`;
    // Текст отдаём файлом, чтобы уберечься от разборщика строки фильтра: символы
    // : ' , ломают его, а апострофы в индонезийском (Qur'an) встречаются постоянно.
    // От раскрытия %{...} и от съедания \ файл сам по себе не спасает — за это
    // отвечает expansion=none в STYLE.
    return `drawtext=fontfile=${spec.fontPath}:textfile=${spec.textPaths[i]}:${STYLE}:x=(w-text_w)/2:y=${y}`;
  });

  const filter = ["scale=1080:1920:force_original_aspect_ratio=increase", "crop=1080:1920", ...drawtexts].join(",");

  // Видео зацикливаем на входе: подложка короче семи секунд иначе оборвала бы
  // ролик раньше времени, а -t ниже всё равно режет по нужной длине.
  const videoIn = ["-stream_loop", "-1", "-i", spec.sourcePath];
  const fadeStart = Math.max(0, REEL_SECONDS - FADE_SECONDS);

  if (spec.musicPath) {
    // Музыку зацикливаем фильтром aloop, а НЕ вторым -stream_loop: на аудиовходе
    // -stream_loop с конечным -t уводит ffmpeg в бесконечный цикл (проверено:
    // процесс не завершается вовсе). aloop отрабатывает и на треке короче ролика.
    const audioChain = [
      "aloop=loop=-1:size=2147483647",
      `atrim=duration=${REEL_SECONDS}`,
      `volume=${MUSIC_VOLUME}`,
      `afade=t=out:st=${fadeStart}:d=${FADE_SECONDS}`,
    ].join(",");

    return [
      "-y",
      ...videoIn,
      "-i",
      spec.musicPath,
      "-filter_complex",
      `[0:v]${filter}[v];[1:a]${audioChain}[a]`,
      "-map",
      "[v]",
      "-map",
      "[a]",
      ...ENCODE,
      "-t",
      String(REEL_SECONDS),
      spec.outPath,
    ];
  }

  // Без своей дорожки: звук подложки, а если его нет — тишина, иначе Instagram
  // получает ролик без аудиопотока.
  return [
    "-y",
    ...videoIn,
    ...(spec.hasAudio ? [] : ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"]),
    "-vf",
    filter,
    ...(spec.hasAudio ? [] : ["-map", "0:v:0", "-map", "1:a:0"]),
    ...ENCODE,
    "-t",
    String(REEL_SECONDS),
    spec.outPath,
  ];
}

export async function renderHook(spec: RenderSpec, deps: RenderDeps): Promise<void> {
  if (spec.hookLines.length !== spec.textPaths.length) {
    throw new Error(`строк хука ${spec.hookLines.length}, а файлов для текста ${spec.textPaths.length}`);
  }
  if (!(await deps.fontReadable(spec.fontPath))) {
    throw new Error(`шрифт не читается: ${spec.fontPath}`);
  }
  await Promise.all(spec.hookLines.map((line, i) => deps.writeText(spec.textPaths[i], line)));
  const { code, stderr } = await deps.runner(deps.ffmpegPath, ffmpegArgs(spec));
  if (code !== 0) throw new Error(`ffmpeg вышел с кодом ${code}: ${stderr.slice(-600)}`);
}
