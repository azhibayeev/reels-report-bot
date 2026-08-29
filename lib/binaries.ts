import { existsSync } from "node:fs";
import { join } from "node:path";
import ffmpegStatic from "ffmpeg-static";

// Общее для фермы и бота дубляжа: оба вжигают текст в видео одним и тем же
// ffmpeg из node_modules, и расходиться в том, где его искать, им незачем.

// ffmpeg-static отдаёт путь, посчитанный на сборке (в проде это /ROOT/...), а в
// собранной функции файл лежит относительно process.cwd(). Поэтому перебираем
// кандидатов и берём существующий; в сообщении об ошибке — весь список, иначе
// ENOENT не говорит вообще ничего.
export function firstExisting(candidates: (string | undefined | null)[], what: string): string {
  const tried: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    tried.push(candidate);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`${what} не найден. Проверены пути: ${tried.join(", ")}`);
}

export function ffmpegPath(): string {
  return firstExisting(
    [process.env.FARM_FFMPEG_PATH, join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"), ffmpegStatic],
    "бинарник ffmpeg"
  );
}

// ffprobe-static не типизирован (нет .d.ts и @types), поэтому путь до бинарника
// собираем сами, а не через `import ffprobeStatic from "ffprobe-static"` — иначе
// tsc падает на самом импорте. Каталог включён в трассировку в next.config.ts.
export function ffprobePath(): string {
  return firstExisting(
    [
      process.env.FARM_FFPROBE_PATH,
      join(process.cwd(), "node_modules", "ffprobe-static", "bin", process.platform, process.arch, "ffprobe"),
    ],
    "бинарник ffprobe"
  );
}

export function fontPath(): string {
  return firstExisting([process.env.FARM_FONT_PATH, join(process.cwd(), "assets", "hook.ttf")], "шрифт хука");
}
